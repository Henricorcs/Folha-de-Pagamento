import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { StatusContaPagar } from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import {
  buildBaixaContaPagarPayload,
  codigoTipoPagamentoBaixa,
  lerSituacaoContaPagar,
  montarHistoricoBaixa,
} from '../ixc/ixc.financeiro';
import { parseIxcId } from '../ixc/ixc.parse';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Conserto dos pagamentos que este app deu por pagos antes de 18/08/2026 e que
 * não chegaram à conciliação bancária.
 *
 * A baixa do IXC cria um par de linhas em `fn_movim_finan`: uma `M`, que é o
 * dinheiro saindo da conta de onde se pagou, e uma `P`, que é a despesa. A tela
 * de conciliação lê a `M`, e ela só existe na conta do **razão** daquela conta
 * de pagamento. O app mandava ali a conta contábil do título, e o IXC escrevia
 * as duas linhas nela: o título constava pago, o par existia, e não havia
 * movimento nenhum na conta que a conciliação lê.
 *
 * Não há como reescrever a linha errada — a movimentação financeira não tem
 * endpoint de edição no webservice. O conserto é o que se faria à mão: estornar
 * a baixa e refazê-la com a conta certa.
 *
 * **Por isso este serviço é medroso de propósito.** Entre o estorno e a nova
 * baixa o título fica em aberto, e título em aberto é título que alguém paga de
 * novo. Se a segunda parte falhar, a fila inteira para ali mesmo, com o número
 * do título no erro: melhor um conserto pela metade que alguém termina à mão do
 * que vinte títulos abertos sem ninguém saber quais.
 */

/**
 * O estorno passou e o título continuou pago: sobrou outra baixa cobrindo o
 * valor. Nada foi perdido e nada foi consertado — só não há o que refazer.
 */
class EstornoSemEfeito extends Error {}

/** Um pagamento que ficou fora da conciliação, e o que seria feito com ele. */
export interface PagamentoTorto {
  idFnApagar: number;
  beneficiario: string;
  valor: number;
  /** Dia em que o dinheiro saiu, como está na linha da baixa. */
  data: string;
  /** Conta de pagamento do título (18, 23…). */
  contaPagamento: number;
  contaPagamentoNome: string | null;
  /** Onde a perna `M` está hoje. */
  contaAtual: number;
  /** Onde ela deveria estar: o razão da conta de pagamento. */
  contaCerta: number;
  /** `fn_movim_finan.id_movim_finan` — é por ele que se estorna. */
  idMovimFinan: number;
  historico: string;
  documento: string | null;
}

/** O que aconteceu com cada título na correção. */
export interface ResultadoDaCorrecao {
  corrigidos: number[];
  /** Ficou como estava; nada foi tocado. */
  pulados: Array<{ idFnApagar: number; motivo: string }>;
  /**
   * O título ficou **em aberto** no IXC: o estorno saiu e a nova baixa não.
   * Precisa de alguém agora — enquanto estiver assim, ele parece não pago.
   */
  emAberto: Array<{ idFnApagar: number; erro: string }>;
  /** A fila parou por causa de um `emAberto`; estes nem foram tentados. */
  naoTentados: number[];
}

@Injectable()
export class ConciliacaoService {
  private readonly logger = new Logger(ConciliacaoService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Os pagamentos deste app que não chegaram à conciliação.
   *
   * Só entra título que **este app criou** e que consta pago aqui: é o alcance
   * em que se sabe o que se está tocando. A base tem outros títulos com a perna
   * `M` fora do razão — lançados por outros caminhos, em contas que este app
   * nem usa — e mexer neles seria estornar pagamento que ninguém pediu.
   */
  async pendentes(): Promise<PagamentoTorto[]> {
    const nossas = await this.prisma.contaPagar.findMany({
      where: { idFnApagarIxc: { not: null }, status: StatusContaPagar.PAGO },
      select: { idFnApagarIxc: true, beneficiarioNome: true },
      orderBy: { createdAt: 'desc' },
    });
    if (nossas.length === 0) return [];

    const razoes = await this.razaoPorConta();
    const tortos: PagamentoTorto[] = [];

    for (const conta of nossas) {
      const id = conta.idFnApagarIxc!;
      try {
        const torto = await this.conferir(id, razoes);
        if (torto) {
          tortos.push({ ...torto, beneficiario: conta.beneficiarioNome });
        }
      } catch (err) {
        // Uma conferência que não respondeu não some com a lista inteira.
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Não deu para conferir o título ${id}: ${motivo}`);
      }
    }
    return tortos;
  }

  /**
   * Estorna e refaz a baixa dos títulos indicados, um de cada vez.
   *
   * Cada um é reconferido na hora: o que já estiver certo, ou não estiver mais
   * pago, é pulado sem ser tocado. A lista de entrada é uma intenção, não uma
   * ordem — entre ver a tela e clicar o botão o IXC pode ter mudado.
   */
  async corrigir(ids: number[]): Promise<ResultadoDaCorrecao> {
    if (ids.length === 0) {
      throw new BadRequestException('Nenhum pagamento indicado.');
    }

    const razoes = await this.razaoPorConta();
    const resultado: ResultadoDaCorrecao = {
      corrigidos: [],
      pulados: [],
      emAberto: [],
      naoTentados: [],
    };

    const fila = [...new Set(ids)];
    for (const [i, id] of fila.entries()) {
      let torto: Omit<PagamentoTorto, 'beneficiario'> | null;
      try {
        torto = await this.conferir(id, razoes);
      } catch (err) {
        resultado.pulados.push({
          idFnApagar: id,
          motivo: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (!torto) {
        resultado.pulados.push({
          idFnApagar: id,
          motivo: 'Já está na conta certa, ou não está mais pago no IXC.',
        });
        continue;
      }

      try {
        await this.refazer(torto);
        resultado.corrigidos.push(id);
        this.logger.log(
          `Título ${id}: baixa refeita na conta ${torto.contaCerta} ` +
            `(estava em ${torto.contaAtual}).`,
        );
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        resultado.naoTentados = fila.slice(i + 1);

        if (err instanceof EstornoSemEfeito) {
          /*
           * O título continua pago: não há perigo nenhum aqui. Mas a fila para
           * do mesmo jeito — se este tem mais de uma baixa, os outros também
           * devem ter, e seguir adiante só espalharia estornos que não
           * consertam nada.
           */
          resultado.pulados.push({ idFnApagar: id, motivo: erro });
          this.logger.warn(
            `Título ${id}: estorno sem efeito (${erro}). A fila parou aqui; ` +
              `${resultado.naoTentados.length} título(s) não foram tentados.`,
          );
          break;
        }

        resultado.emAberto.push({ idFnApagar: id, erro });
        this.logger.error(
          `Título ${id} ficou EM ABERTO no IXC: o estorno saiu e a nova baixa ` +
            `não (${erro}). A fila parou aqui; ${resultado.naoTentados.length} ` +
            'título(s) não foram tentados.',
        );
        break;
      }
    }

    return resultado;
  }

  /**
   * Estorna a baixa e refaz na conta certa.
   *
   * Lança se a nova baixa não sair — e quem chama trata isso como o que é: o
   * título ficou em aberto no IXC.
   */
  private async refazer(
    torto: Omit<PagamentoTorto, 'beneficiario'>,
  ): Promise<void> {
    await this.ixc.remove('fn_apagar_baixas', torto.idMovimFinan);

    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      torto.idFnApagar,
    );
    if (!raw) throw new Error('O título sumiu do IXC depois do estorno.');

    const situacao = lerSituacaoContaPagar(raw);
    if (situacao.pago) {
      /*
       * O IXC aceitou o estorno e o título continua pago — quase sempre porque
       * ele tem mais de uma baixa e sobrou outra cobrindo o valor.
       *
       * Não é perigo: nada foi perdido e o título segue quitado. Mas também não
       * é conserto, e refazer a baixa agora pagaria duas vezes. Sai por aqui,
       * sem tocar em mais nada — e quem chama trata isto como o que é: um
       * título que ficou como estava, não um título aberto.
       */
      throw new EstornoSemEfeito(
        'O IXC aceitou o estorno e o título continua pago — ele deve ter mais ' +
          'de uma baixa. Nada foi refeito, e o pagamento segue lá do jeito ' +
          'que estava.',
      );
    }

    await this.ixc.action(
      'botao_pagar_26409',
      buildBaixaContaPagarPayload({
        idFnApagar: torto.idFnApagar,
        contaPagamentoId: torto.contaPagamento,
        contaPagamentoNome: torto.contaPagamentoNome,
        contaPlanejamentoId: torto.contaCerta,
        filialId: parseIxcId(raw.filial_id) ?? 1,
        valor: torto.valor,
        data: dataDoIxc(torto.data),
        documento: torto.documento,
        tipoPagamento: codigoTipoPagamentoBaixa(
          typeof raw.tipo_pagamento === 'string' ? raw.tipo_pagamento : null,
          false,
        ),
        historico: torto.historico,
      }),
    );

    // Quem diz se saiu é o IXC, não a resposta da chamada: a baixa já respondeu
    // erro tendo gravado, e já respondeu bem sem gravar.
    const depois = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      torto.idFnApagar,
    );
    if (!depois || !lerSituacaoContaPagar(depois).pago) {
      throw new Error(
        'A nova baixa não quitou o título — ele está em aberto no IXC agora.',
      );
    }
  }

  /**
   * O título está pago e com a perna `M` na conta errada? Devolve o que seria
   * preciso para refazê-lo; null quando não há o que consertar.
   */
  private async conferir(
    idFnApagar: number,
    razoes: Map<number, { razao: number; nome: string | null }>,
  ): Promise<Omit<PagamentoTorto, 'beneficiario'> | null> {
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) return null;

    const situacao = lerSituacaoContaPagar(raw);
    // Só se mexe no que está pago: em aberto não há baixa para estornar, e
    // cancelado não é para voltar a existir.
    if (!situacao.pago || situacao.cancelada) return null;

    const contaPagamento = parseIxcId(raw.id_contas);
    if (!contaPagamento) return null;
    const conta = razoes.get(contaPagamento);
    if (!conta) return null;

    const pernas = await this.pernasDoBanco(idFnApagar);
    /*
     * Mais de uma linha `M` = mais de uma baixa no título, e aí não dá para
     * dizer qual é a que vale. Estornar a errada não abre o título (a outra
     * cobre o valor) mas deixa um estorno registrado que não consertou nada —
     * foi o que aconteceu no primeiro título em que isto rodou.
     *
     * Quase metade dos títulos pagos desta base está assim. Enquanto não se
     * souber ler qual baixa manda, eles ficam de fora: um conserto que erra o
     * alvo é pior que nenhum.
     */
    if (pernas.length > 1) return null;
    const linhaM = pernas[0];
    if (!linhaM) return null;

    const contaAtual = parseIxcId(linhaM.id_conta);
    if (contaAtual === null || contaAtual === conta.razao) return null;

    const idMovimFinan = parseIxcId(linhaM.id_movim_finan);
    if (!idMovimFinan) return null;

    return {
      idFnApagar,
      valor: Number(linhaM.credito || linhaM.debito || 0),
      data: String(linhaM.data ?? ''),
      contaPagamento,
      contaPagamentoNome: conta.nome,
      contaAtual,
      contaCerta: conta.razao,
      idMovimFinan,
      historico:
        typeof linhaM.historico === 'string' && linhaM.historico.trim()
          ? linhaM.historico
          : montarHistoricoBaixa({ documento: String(linhaM.documento ?? '') }),
      documento: linhaM.documento ? String(linhaM.documento) : null,
    };
  }

  /** As linhas `M` do título — uma por baixa feita nele. */
  private async pernasDoBanco(
    idFnApagar: number,
  ): Promise<Array<Record<string, unknown>>> {
    const linhas = await this.ixc.list<Record<string, unknown>>(
      'fn_movim_finan',
      {
        qtype: 'fn_movim_finan.id_pagar',
        query: String(idFnApagar),
        oper: '=',
        page: 1,
        rp: 10,
        sortname: 'fn_movim_finan.id',
        sortorder: 'asc',
      },
    );
    return linhas.registros.filter((l) => String(l.tipo_lanc) === 'M');
  }

  /** O razão de cada conta de pagamento, lido uma vez por execução. */
  private async razaoPorConta(): Promise<
    Map<number, { razao: number; nome: string | null }>
  > {
    const contas = await this.ixc.listAll<Record<string, unknown>>(
      'contas',
      { qtype: 'contas.id', query: '0', oper: '>' },
      { pageSize: 200, maxPages: 3 },
    );

    const mapa = new Map<number, { razao: number; nome: string | null }>();
    for (const c of contas) {
      const id = parseIxcId(c.id);
      const razao = parseIxcId(c.id_planejamento);
      if (id && razao) {
        mapa.set(id, {
          razao,
          nome: typeof c.conta === 'string' ? c.conta : null,
        });
      }
    }
    return mapa;
  }
}

/** "2026-08-08" (como o `fn_movim_finan` guarda) vira Date em UTC. */
function dataDoIxc(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return new Date();
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
