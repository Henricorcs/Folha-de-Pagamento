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

/** Por onde o dinheiro sai. */
export type FormaDePagar = 'BANCO' | 'EM_MAOS';

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
