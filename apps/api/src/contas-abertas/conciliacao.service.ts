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
 * Cuidado ao ler essas linhas: um título lançado por competência tem **dois**
 * grupos, e só um é o pagamento. Ver `pernasDoPagamento`.
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
  /**
   * Dá para consertar daqui? `false` quando o dinheiro saiu de uma conta
   * diferente da que o título aponta — ali o conserto seria mudar de banco um
   * pagamento que já aconteceu, e isso não é decisão de um serviço.
   */
  corrigivel: boolean;
  /** Por que não dá, quando não dá. */
  motivo: string | null;
  /**
   * De onde o dinheiro **realmente** saiu, quando a linha do pagamento aponta
   * uma conta que não é a do título. O "de onde saiu" da tela vinha do título,
   * e o título pode estar errado — foi o caso de um pagamento de R$ 50.000 que
   * saiu do Bradesco com o título dizendo ModoBank.
   */
  contaRealNome: string | null;
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
   * DESLIGADO — não conserta, e chegou a estragar.
   *
   * O plano era estornar a baixa e refazê-la na conta certa. Mas
   * `DELETE fn_apagar_baixas/{id}` **apaga a linha do dinheiro sem desfazer o
   * pagamento**: o título continua `status = F`, com valor aberto zero. As duas
   * conferências que este serviço fazia liam "ainda pago" e tiravam a
   * conclusão errada — uma abortava achando que o estorno não tinha pegado, a
   * outra dava sucesso por um pagamento que não foi refeito. Nos dois caminhos
   * a perna do dinheiro já tinha ido embora.
   *
   * Três títulos ficaram com o grupo de movimentação pela metade:
   *
   *   37015  R$ 160,00   sobrou só a linha D
   *   36992  R$ 519,00   sobrou só a linha P
   *   37010  R$ 375,00   sobrou só a linha P
   *
   * Todos seguem pagos e com valor aberto zero — o dinheiro está certo. O que
   * ficou torto é o lançamento, e agora de um jeito pior que o original: antes
   * havia um par completo na conta errada, hoje falta uma perna.
   *
   * A listagem (`pendentes`) continua valendo: ela só lê, e é ela que mostra o
   * que precisa de conserto. O conserto volta quando alguém souber, com prova
   * numa base de teste, como estornar de fato uma baixa por aqui. Até lá é na
   * tela do IXC.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async corrigir(ids: number[]): Promise<ResultadoDaCorrecao> {
    throw new BadRequestException(
      'O conserto automático está desligado: o estorno pelo webservice apaga a ' +
        'linha do dinheiro sem desfazer o pagamento, e deixa o lançamento pela ' +
        'metade. Os títulos desta lista precisam ser refeitos na tela do IXC.',
    );
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

    const pernas = await this.pernasDoPagamento(idFnApagar);
    // Mais de um pagamento no mesmo título: não dá para dizer qual é o que
    // vale, e estornar o errado não conserta nada. Fica para alguém olhar.
    if (pernas.length > 1) return null;
    const linhaM = pernas[0];
    if (!linhaM) return null;

    const contaAtual = parseIxcId(linhaM.id_conta);
    if (contaAtual === null || contaAtual === conta.razao) return null;

    /*
     * A perna do pagamento já está no razão de **outra** conta de pagamento.
     *
     * Isso não é o defeito daqui. O defeito escreve a perna numa conta de
     * despesa (324, 2420) — conta que não é razão de banco nenhum. Cair no
     * razão da conta 15 quer dizer que o dinheiro saiu mesmo por ali, e que o
     * título é que aponta outra: alguém trocou a conta de pagamento depois de
     * pagar, ou pagou por uma conta e lançou por outra.
     *
     * Reescrever moveria de banco um pagamento que já aconteceu — num caso
     * destes eram R$ 50.000, saídos do Bradesco com o título dizendo ModoBank.
     * Quem decide de qual conta saiu o dinheiro é o extrato.
     *
     * Mas some da tela seria pior: continua sendo um pagamento fora da
     * conciliação, e agora ninguém o veria. Ele entra na lista dizendo de onde
     * o dinheiro saiu de verdade, sem caixa de marcar.
     */
    const outraConta = [...razoes.entries()].find(
      ([, c]) => c.razao === contaAtual,
    );

    const idMovimFinan = parseIxcId(linhaM.id_movim_finan);
    if (!idMovimFinan) return null;

    return {
      idFnApagar,
      valor: Number(linhaM.credito || linhaM.debito || 0),
      data: String(linhaM.data ?? ''),
      contaPagamento,
      contaPagamentoNome: conta.nome,
      corrigivel: !outraConta,
      motivo: outraConta
        ? `O dinheiro saiu de "${outraConta[1].nome ?? `conta ${outraConta[0]}`}", ` +
          `e o título aponta "${conta.nome ?? `conta ${contaPagamento}`}". ` +
          'Refazer a baixa daqui mudaria o pagamento de conta. Acerte no IXC, ' +
          'conferindo antes no extrato de qual conta o dinheiro saiu.'
        : null,
      contaRealNome: outraConta?.[1].nome ?? null,
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

  /**
   * A perna do dinheiro de cada **pagamento** do título.
   *
   * Um título pago tem dois grupos de linhas em `fn_movim_finan`, e eles são
   * coisas diferentes:
   *
   * - `M` + `D` ("Cap 36911 - Fulano") — o título **nascendo**, a provisão da
   *   despesa. Aparece em quem foi lançado por competência, e a conta dela não
   *   tem nada a ver com o banco;
   * - `M` + `P` ("Pag. Fulano - doc.: 36911") — o **pagamento**. É esta que a
   *   conciliação lê, e é a única que interessa aqui.
   *
   * Os dois grupos começam com uma linha `M`, e ler a primeira que aparecer
   * pega a provisão — foi o que fez esta tela listar 80 pagamentos que estavam
   * certos. O que separa um grupo do outro é a segunda linha: só o do pagamento
   * tem a `P`.
   */
  private async pernasDoPagamento(
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
    // Os grupos que têm uma linha `P` são os pagamentos; de cada um interessa
    // a `M`, que é o dinheiro saindo da conta.
    const grupoDePagamento = new Set(
      linhas.registros
        .filter((l) => String(l.tipo_lanc) === 'P')
        .map((l) => String(l.id_movim_finan)),
    );
    return linhas.registros.filter(
      (l) =>
        String(l.tipo_lanc) === 'M' &&
        grupoDePagamento.has(String(l.id_movim_finan)),
    );
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
