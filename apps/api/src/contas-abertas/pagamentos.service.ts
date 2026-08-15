import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { IxcClient } from '../ixc/ixc.client';
import {
  buildAuditoriaPayload,
  buildBaixaContaPagarPayload,
  lerSituacaoContaPagar,
  lerStatusAuditoria,
} from '../ixc/ixc.financeiro';
import { parseIxcId } from '../ixc/ixc.parse';
import { PrismaService } from '../prisma/prisma.service';

/** Por onde o dinheiro sai. */
export type FormaDePagar = 'BANCO' | 'EM_MAOS';

/** O que dá para mudar num título que ainda está em aberto. */
export interface EdicaoDoTitulo {
  valor?: number;
  dataVencimento?: string;
  observacao?: string;
  tipoPagamento?: string;
  contaPagamento?: number;
  contaContabil?: number;
  chavePix?: string;
  codigoBarras?: string;
  documento?: string;
}

/** O que aconteceu com o título no IXC. */
export interface ResultadoDoPagamento {
  idFnApagar: number;
  /** Passou pela auditoria agora, ou já estava aprovado antes. */
  aprovada: boolean;
  /** Deu baixa: o IXC passa a considerar a conta quitada. */
  paga: boolean;
  valor: number;
  /** O que não impediu o pagamento, mas quem clicou precisa saber. */
  avisos: string[];
}

/**
 * Pagar uma conta do IXC daqui.
 *
 * São dois caminhos, e a diferença é de onde sai o dinheiro:
 *
 * - **pelo banco**: o título é aprovado na auditoria e fica pronto para o
 *   pagamento sair por lá, no fluxo do banco. Nenhum dinheiro se move agora —
 *   quem paga é o banco, depois.
 * - **em mãos**: aprova e dá a baixa na conta do caixa configurado. Aqui a
 *   conta fica paga no IXC no ato, porque o dinheiro já saiu da gaveta.
 *
 * As duas escritas são no financeiro de verdade da empresa. O serviço confere
 * a situação do título antes de tocar em qualquer coisa: pagar de novo o que
 * já está pago tiraria o dinheiro duas vezes do caixa, e é o erro mais caro
 * que esta tela pode cometer.
 */
@Injectable()
export class PagamentosService {
  private readonly logger = new Logger(PagamentosService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly config: ConfigFinanceiraService,
    private readonly prisma: PrismaService,
  ) {}

  async pagar(
    idFnApagar: number,
    opcoes: { forma: FormaDePagar; data?: string; historico?: string },
    usuarioNome?: string,
  ): Promise<ResultadoDoPagamento> {
    const avisos: string[] = [];
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      throw new BadRequestException(
        `O título ${idFnApagar} não existe mais no IXC.`,
      );
    }

    const situacao = lerSituacaoContaPagar(raw);
    if (situacao.pago) {
      throw new BadRequestException(
        `O título ${idFnApagar} já consta pago no IXC` +
          (situacao.dataPagamento
            ? ` (em ${situacao.dataPagamento.toLocaleDateString('pt-BR')})`
            : '') +
          '. Pagar de novo tiraria o dinheiro duas vezes.',
      );
    }
    if (situacao.cancelada) {
      throw new BadRequestException(
        `O título ${idFnApagar} está cancelado no IXC e não deve ser pago.`,
      );
    }

    const valor = situacao.valorAberto;
    if (valor < 0.01) {
      throw new BadRequestException(
        `O título ${idFnApagar} está sem saldo a pagar.`,
      );
    }

    // --- 1. Auditoria ---
    // Reprovado é decisão de alguém: destravar isso daqui por baixo seria
    // passar por cima de quem reprovou.
    const auditoriaAtual = lerStatusAuditoria(raw);
    if (auditoriaAtual === 'R') {
      throw new BadRequestException(
        `O título ${idFnApagar} foi reprovado na auditoria do IXC. Resolva por ` +
          'lá antes de pagar.',
      );
    }

    let aprovada = auditoriaAtual === 'A';
    if (!aprovada) {
      await this.ixc.create(
        'fn_apagar_auditoria',
        buildAuditoriaPayload({
          idFnApagar,
          status: 'A',
          motivo: 'Aprovado pelo ILNET FINANCE',
          operador: usuarioNome ?? '',
        }),
      );
      aprovada = true;
      this.logger.log(`Título ${idFnApagar} aprovado na auditoria do IXC.`);
    }

    // --- 2. Baixa, só no pagamento em mãos ---
    if (opcoes.forma === 'BANCO') {
      return { idFnApagar, aprovada, paga: false, valor, avisos };
    }

    const cfg = await this.config.obter();
    const contaPagamentoId =
      parseIxcId(raw.id_contas) ?? cfg.contaPagamentoCaixaId;
    const contaContabilId = parseIxcId(raw.id_conta) ?? cfg.contaContabilAvulso;
    const filialId = parseIxcId(raw.filial_id) ?? cfg.filialId;

    await this.ixc.create(
      'fn_apagar_pagamentos_baixas',
      buildBaixaContaPagarPayload({
        idFnApagar,
        // Em mãos sai do caixa configurado, não da conta do banco que o título
        // trazia — é essa a diferença entre as duas formas.
        contaPagamentoId: cfg.contaPagamentoCaixaId || contaPagamentoId,
        contaContabilId,
        filialId,
        valor,
        data: opcoes.data ? dataUtc(opcoes.data) : new Date(),
        documento: textoOuNull(raw.documento),
        historico:
          opcoes.historico?.trim() ||
          `Pagamento em mãos pelo ILNET FINANCE${usuarioNome ? ` (${usuarioNome})` : ''}`,
      }),
    );

    this.logger.log(
      `Título ${idFnApagar} baixado no IXC: ${valor} pela conta ${cfg.contaPagamentoCaixaId}.`,
    );

    // O IXC aceita a baixa e devolve o id do movimento; conferir a situação de
    // volta custa uma leitura e responde a única pergunta que importa depois de
    // pagar — a conta ficou mesmo quitada lá?
    const depois = await this.ixc
      .getById<Record<string, unknown>>('fn_apagar', 'fn_apagar.id', idFnApagar)
      .catch(() => null);
    const paga = depois ? lerSituacaoContaPagar(depois).pago : true;
    if (depois && !paga) {
      avisos.push(
        'O IXC aceitou a baixa, mas o título continua aparecendo como aberto ' +
          'por lá. Confira no IXC antes de considerar essa conta paga.',
      );
    }

    return { idFnApagar, aprovada, paga, valor, avisos };
  }

  /**
   * Paga várias contas em mãos de uma vez.
   *
   * Uma a uma, e o que já saiu fica de pé se a seguinte falhar: são pagamentos
   * de verdade, e desfazer os que deram certo por causa do que não deu seria
   * tirar dinheiro do caixa duas vezes para depois devolver. Quem clicou vê
   * quais passaram e quais não.
   */
  async pagarEmLote(
    ids: number[],
    opcoes: { forma: FormaDePagar; data?: string },
    usuarioNome?: string,
  ): Promise<{
    pagas: ResultadoDoPagamento[];
    falhas: Array<{ idFnApagar: number; erro: string }>;
    total: number;
  }> {
    const pagas: ResultadoDoPagamento[] = [];
    const falhas: Array<{ idFnApagar: number; erro: string }> = [];

    for (const id of [...new Set(ids)]) {
      try {
        pagas.push(await this.pagar(id, opcoes, usuarioNome));
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Título ${id} não foi pago no lote: ${erro}`);
        falhas.push({ idFnApagar: id, erro });
      }
    }

    return {
      pagas,
      falhas,
      total: Math.round(pagas.reduce((s, p) => s + p.valor, 0) * 100) / 100,
    };
  }

  /**
   * Muda um título em aberto no IXC — o meio de pagamento, a data, o valor.
   *
   * Conta paga não se edita: o dinheiro já saiu, e mudar o valor de um
   * pagamento feito é reescrever o passado. O caminho é estornar no IXC.
   */
  async editar(
    idFnApagar: number,
    mudancas: EdicaoDoTitulo,
  ): Promise<{ idFnApagar: number; alterado: string[] }> {
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      throw new BadRequestException(
        `O título ${idFnApagar} não existe mais no IXC.`,
      );
    }

    const situacao = lerSituacaoContaPagar(raw);
    if (situacao.pago) {
      throw new BadRequestException(
        `O título ${idFnApagar} já está pago — estorne no IXC antes de mudar.`,
      );
    }
    if (situacao.cancelada) {
      throw new BadRequestException(
        `O título ${idFnApagar} está cancelado no IXC.`,
      );
    }

    const alterado = Object.entries(mudancas)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k]) => k);
    if (alterado.length === 0) {
      throw new BadRequestException('Nada foi alterado.');
    }

    await this.ixc.update(
      'fn_apagar',
      idFnApagar,
      await montarEdicao(raw, mudancas),
    );
    this.logger.log(
      `Título ${idFnApagar} alterado no IXC: ${alterado.join(', ')}.`,
    );

    return { idFnApagar, alterado };
  }

  /**
   * Apaga um título do IXC.
   *
   * Só o que ainda não foi pago: apagar uma conta paga sumiria com o registro
   * de uma saída de dinheiro que existiu. Se ela nasceu aqui, o registro deste
   * lado vai junto — deixá-lo apontando para um título que não existe mais
   * faria a conferência de pagamentos procurar um fantasma.
   */
  async excluir(idFnApagar: number): Promise<{ idFnApagar: number }> {
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      throw new BadRequestException(
        `O título ${idFnApagar} não existe mais no IXC.`,
      );
    }

    const situacao = lerSituacaoContaPagar(raw);
    if (situacao.pago) {
      throw new BadRequestException(
        `O título ${idFnApagar} já foi pago. Apagar sumiria com o registro de ` +
          'um dinheiro que saiu — estorne no IXC, se for o caso.',
      );
    }

    await this.ixc.remove('fn_apagar', idFnApagar);
    await this.prisma.contaPagar.deleteMany({
      where: { idFnApagarIxc: idFnApagar },
    });
    this.logger.log(`Título ${idFnApagar} apagado do IXC.`);

    return { idFnApagar };
  }
}

/**
 * Muda um título que ainda está em aberto no IXC.
 *
 * O registro é lido antes e devolvido inteiro, com as mudanças por cima: o
 * `PUT` do webservice reescreve a linha, e mandar só o campo alterado apaga o
 * resto — a conta perderia fornecedor, valor e vencimento de uma vez.
 */
export async function montarEdicao(
  atual: Record<string, unknown>,
  mudancas: EdicaoDoTitulo,
): Promise<Record<string, unknown>> {
  const texto = (v: unknown) => String(v ?? '').trim();

  return {
    id_fornecedor: texto(atual.id_fornecedor),
    data_emissao: formatDataIxcDeIso(texto(atual.data_emissao)),
    data_vencimento: mudancas.dataVencimento
      ? formatDataIxcDeIso(mudancas.dataVencimento)
      : formatDataIxcDeIso(texto(atual.data_vencimento)),
    valor:
      mudancas.valor !== undefined
        ? mudancas.valor.toFixed(2)
        : texto(atual.valor),
    id_contas: String(mudancas.contaPagamento ?? texto(atual.id_contas)),
    id_conta: String(mudancas.contaContabil ?? texto(atual.id_conta)),
    filial_id: texto(atual.filial_id) || '1',
    tipo_pagamento: mudancas.tipoPagamento ?? texto(atual.tipo_pagamento),
    chave_pix: mudancas.chavePix ?? texto(atual.chave_pix),
    codigo_barras:
      mudancas.codigoBarras !== undefined
        ? mudancas.codigoBarras.replace(/\D/g, '')
        : texto(atual.codigo_barras),
    documento: mudancas.documento ?? texto(atual.documento),
    numero_nota: texto(atual.numero_nota),
    obs: mudancas.observacao ?? texto(atual.obs),
    // O que decide se a conta existe para o financeiro do IXC não é mexido
    // aqui: uma edição de meio de pagamento não pode cancelar nem "desliberar"
    // o título.
    previsao: texto(atual.previsao) || 'N',
    liberado: texto(atual.liberado) || 'S',
  };
}

/** "AAAA-MM-DD" (como o IXC devolve na leitura) → "DD/MM/AAAA" (como ele aceita). */
function formatDataIxcDeIso(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // Já veio no formato brasileiro (ou vazio): devolve como está.
  return valor;
}

/** "AAAA-MM-DD" → meia-noite em UTC, como o resto das datas desta base. */
function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function textoOuNull(valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  return s || null;
}
