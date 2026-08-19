import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OrigemConciliacao } from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import { parseIxcId } from '../ixc/ixc.parse';
import { PrismaService } from '../prisma/prisma.service';
import { ContasAbertasService } from './contas-abertas.service';
import { casar, type LinhaParaCasar } from './conciliacao.casar';
import {
  ExtratoIlegivel,
  lerOfx,
  type ExtratoImportado,
  type TransacaoExtrato,
} from './conciliacao.ofx';
import { PagamentosService } from './pagamentos.service';

/**
 * Conciliação bancária: o extrato do banco de um lado, a movimentação do IXC do
 * outro, e a diferença entre os dois na cara de quem confere.
 *
 * ## Onde o dinheiro de uma conta aparece no IXC
 *
 * Em `fn_movim_finan`, filtrando pela **conta do razão** — `contas.id_planejamento`,
 * não `contas.id`. É o mesmo lugar de onde a tela de movimentação do IXC lê, e
 * é por isso que uma baixa lançada na conta errada some da conciliação sem
 * sumir do título.
 *
 * O sinal segue a partida dobrada, e não o nome da coluna: numa conta de banco
 * o **débito é dinheiro entrando** e o **crédito é dinheiro saindo**. Um
 * pagamento de R$ 3.242,37 pelo Sicoob aparece ali como `credito = 3242.37`.
 *
 * Uma armadilha some sozinha aqui: um título lançado por competência tem dois
 * grupos de linhas — a provisão da despesa e o pagamento. Só o pagamento passa
 * pela conta do banco; a provisão vive na conta de despesa e nunca entra nesta
 * lista. Quem lê por título precisa separar os dois (foi o que fez uma versão
 * antiga desta tela acusar 80 pagamentos certos); quem lê pela conta, não.
 *
 * ## A marca de conciliado: dá para ler, não dá para escrever
 *
 * O IXC guarda a marca em `fn_movim_finan.conciliado` ('S'/'N') — 154 mil
 * linhas conciliadas nesta base. Ela **não vem na listagem**, mas dá para
 * filtrar por ela, e é assim que esta tela sabe o que o IXC já conciliou.
 *
 * Escrever é que não dá, e isso foi testado numa linha de teste criada e
 * apagada em seguida:
 *
 * ```
 * PUT /fn_movim_finan/{id}  { conciliado: 'S', id_conta, data, historico }
 *   → "Registro atualizado com sucesso!"
 *   → conciliado:  N → N          (o campo é ignorado)
 *   → documento:   "TESTEAPI" → ""
 *   → debito:      0.01 → 0.00
 *   → tipo_lanc:   "M" → ""
 * ```
 *
 * Ou seja: o PUT ignora justamente o campo que interessa **e** apaga toda
 * coluna que não for no corpo — e a listagem não devolve `id_pagar`,
 * `id_receber` nem `data2` para poder devolvê-las. Escrever ali arrancaria a
 * ligação entre a linha do dinheiro e o título, que é o estrago que o commit
 * b3d9780 já pagou uma vez.
 *
 * Por isso a conferência feita aqui é gravada aqui (`conciliacao_linhas`), e a
 * tela mostra as duas origens separadas. Não existe endpoint de conciliação no
 * webservice: `fn_conciliacao`, `fn_arquivo_importado`, `fn_extrato` e mais
 * dezesseis nomes prováveis respondem "não está disponível".
 */

/** Uma conta de banco ou caixa, do jeito que a conciliação precisa dela. */
export interface ContaConciliavel {
  /** `contas.id` — o número que a pessoa escolhe. */
  id: number;
  nome: string;
  /** 'B' = banco, 'C' = caixa. */
  tipo: string | null;
  /** `contas.id_planejamento`: a conta do razão, por onde o dinheiro passa. */
  razao: number;
  ativa: boolean;
  /** Uma das que costumam pagar as contas da empresa — vem no topo. */
  usual: boolean;
  codigoBanco: string | null;
}

/** O título de contas a pagar por trás de uma linha do banco. */
export interface TituloDaLinha {
  idFnApagar: number;
  /** Nome de quem recebeu, quando o título nasceu neste app. */
  beneficiario: string | null;
  /** Este app criou o título — dá para abrir a ficha dele aqui. */
  nossa: boolean;
}

/** A transação do extrato que bateu com uma linha do IXC. */
export interface ParDoExtrato {
  fitId: string;
  data: string;
  valor: number;
  descricao: string;
  como: 'documento' | 'exato' | 'proximo';
  diasDeDiferenca: number;
}

/** Uma linha da movimentação da conta, com tudo o que se sabe sobre ela. */
export interface LinhaDaConciliacao {
  /** `fn_movim_finan.id` */
  id: number;
  /** "AAAA-MM-DD" */
  data: string;
  historico: string;
  documento: string | null;
  /** Positivo = entrou na conta; negativo = saiu. */
  valor: number;
  /** Já está marcada como conciliada no próprio IXC. */
  conciliadoNoIxc: boolean;
  /** Conferida por esta tela. */
  conferida: {
    em: string;
    por: string | null;
    origem: OrigemConciliacao;
    fitId: string | null;
  } | null;
  titulo: TituloDaLinha | null;
  /** Preenchida quando um extrato foi importado e esta linha bateu com ele. */
  extrato: ParDoExtrato | null;
}

/** O extrato importado, resumido para a tela. */
export interface ResumoDoExtrato {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  de: string | null;
  ate: string | null;
  saldo: number | null;
  saldoEm: string | null;
  transacoes: number;
  entradas: number;
  saidas: number;
  /** As transações do banco que não acharam par no IXC. */
  soNoBanco: TransacaoExtrato[];
}

/** O que a tela recebe de uma vez. */
export interface ConciliacaoDaConta {
  conta: ContaConciliavel;
  periodo: { de: string; ate: string };
  linhas: LinhaDaConciliacao[];
  resumo: {
    linhas: number;
    /** Conciliadas no IXC ou conferidas aqui. */
    fechadas: number;
    pendentes: number;
    entradas: number;
    saidas: number;
  };
  extrato: ResumoDoExtrato | null;
  lidoEm: Date;
  avisos: string[];
}

/** Uma linha que a tela mandou conferir. */
export interface LinhaConferida {
  id: number;
  data: string;
  valor: number;
  fitId?: string | null;
}

/**
 * Teto de linhas lidas de uma vez.
 *
 * A conta do PIX passa de três mil linhas num mês — quase todas recebimento de
 * cliente — e há contas com anos de histórico. O teto existe para a tela dizer
 * "veio até aqui" em vez de ficar dez minutos pendurada numa leitura que o
 * navegador não daria conta de desenhar.
 */
const TETO_DE_LINHAS = 12_000;
const LINHAS_POR_PAGINA = 1_000;

/**
 * As contas por onde os débitos da empresa costumam sair — as mesmas quatro que
 * a tela de pagamento oferece no topo. Aqui elas servem para a conta certa já
 * vir escolhida em vez de exigir uma caçada entre dezessete.
 */
const CONTAS_USUAIS = [14, 15, 18, 23];

@Injectable()
export class ConciliacaoService {
  private readonly logger = new Logger(ConciliacaoService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
    private readonly pagamentos: PagamentosService,
    private readonly contasAbertas: ContasAbertasService,
  ) {}

  /** As contas de banco e caixa do IXC que têm razão — as conciliáveis. */
  async contas(): Promise<ContaConciliavel[]> {
    const registros = await this.ixc.listAll<Record<string, unknown>>(
      'contas',
      { qtype: 'contas.id', query: '0', oper: '>' },
      { pageSize: 200, maxPages: 3 },
    );

    return registros
      .map((r): ContaConciliavel | null => {
        const id = parseIxcId(r.id);
        const razao = parseIxcId(r.id_planejamento);
        // Sem razão não há por onde ler o movimento: a conta existe no
        // cadastro e não tem lugar no livro.
        if (!id || !razao) return null;
        return {
          id,
          nome: String(r.conta ?? r.descricao ?? `Conta ${id}`).trim(),
          tipo: texto(r.tipo_conta),
          razao,
          ativa: String(r.ativo ?? 'S').toUpperCase() !== 'N',
          usual: CONTAS_USUAIS.includes(id),
          codigoBanco: texto(r.cod_banco),
        };
      })
      .filter((c): c is ContaConciliavel => c !== null)
      .sort((a, b) => {
        if (a.usual !== b.usual) return a.usual ? -1 : 1;
        if (a.ativa !== b.ativa) return a.ativa ? -1 : 1;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      });
  }

  /**
   * A conciliação de uma conta num período — com ou sem extrato importado.
   *
   * É a única leitura da tela: sem `ofx` ela mostra o que o IXC tem e o que já
   * foi conferido; com `ofx` ela cruza os dois lados e diz o que sobrou de
   * cada um.
   */
  async ver(input: {
    conta: number;
    de: string;
    ate: string;
    ofx?: string | null;
  }): Promise<ConciliacaoDaConta> {
    const avisos: string[] = [];
    const conta = await this.acharConta(input.conta);
    const { de, ate } = periodoValido(input.de, input.ate);

    const brutas = await this.ixc.listAll<Record<string, unknown>>(
      'fn_movim_finan',
      {
        qtype: 'fn_movim_finan.id_conta',
        query: String(conta.razao),
        oper: '=',
        sortname: 'fn_movim_finan.data',
        sortorder: 'asc',
        gridParam: filtroDePeriodo(de, ate),
      },
      { pageSize: LINHAS_POR_PAGINA, maxPages: TETO_DE_LINHAS / LINHAS_POR_PAGINA },
    );

    if (brutas.length >= TETO_DE_LINHAS) {
      avisos.push(
        `A leitura parou em ${TETO_DE_LINHAS.toLocaleString('pt-BR')} linhas. ` +
          'Escolha um período menor para ver o resto.',
      );
    }

    const linhas = brutas
      .map((r) => mapLinha(r))
      .filter((l): l is LinhaCrua => l !== null);

    const [conciliadasNoIxc, conferidas, titulos] = await Promise.all([
      this.idsConciliadosNoIxc(conta.razao, de, ate, avisos),
      this.conferidasNoPeriodo(conta.id, de, ate),
      this.titulosDasLinhas(linhas),
    ]);

    const montadas: LinhaDaConciliacao[] = linhas.map((l) => {
      const conferida = conferidas.get(l.id);
      return {
        id: l.id,
        data: l.data,
        historico: l.historico,
        documento: l.documento,
        valor: l.valor,
        conciliadoNoIxc: conciliadasNoIxc.has(l.id),
        conferida: conferida
          ? {
              em: conferida.conferidoEm.toISOString(),
              por: conferida.conferidoPor,
              origem: conferida.origem,
              fitId: conferida.fitId,
            }
          : null,
        titulo: l.idTitulo ? (titulos.get(l.idTitulo) ?? null) : null,
        extrato: null,
      };
    });

    const extrato = input.ofx?.trim()
      ? this.cruzarComExtrato(montadas, linhas, input.ofx, { de, ate }, avisos)
      : null;

    const entradas = soma(montadas.filter((l) => l.valor > 0).map((l) => l.valor));
    const saidas = soma(montadas.filter((l) => l.valor < 0).map((l) => -l.valor));
    const fechadas = montadas.filter(
      (l) => l.conciliadoNoIxc || l.conferida !== null,
    ).length;

    return {
      conta,
      periodo: { de, ate },
      linhas: montadas,
      resumo: {
        linhas: montadas.length,
        fechadas,
        pendentes: montadas.length - fechadas,
        entradas,
        saidas,
      },
      extrato,
      lidoEm: new Date(),
      avisos,
    };
  }

  /**
   * Marca linhas como conferidas.
   *
   * Data e valor vêm da tela junto com o id. Não é confiar no cliente com
   * dinheiro: eles são cópia, usada só para a tela seguinte saber o que já foi
   * conferido num período sem reler o IXC inteiro. Quanto entrou e quanto saiu
   * é sempre recontado do IXC em `ver()`, e o id é a única chave que liga uma
   * coisa à outra.
   */
  async conferir(
    conta: number,
    linhas: LinhaConferida[],
    usuario?: string,
  ): Promise<{ conferidas: number[] }> {
    if (linhas.length === 0) return { conferidas: [] };

    const conferidas: number[] = [];
    for (const linha of linhas) {
      const data = new Date(`${linha.data.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(data.getTime())) {
        throw new BadRequestException(
          `A linha ${linha.id} veio com uma data que não dá para ler.`,
        );
      }
      const origem = linha.fitId ? OrigemConciliacao.EXTRATO : OrigemConciliacao.MANUAL;
      const dados = {
        contaIxc: conta,
        data,
        valor: linha.valor,
        origem,
        fitId: linha.fitId ?? null,
        conferidoPor: usuario ?? null,
      };
      await this.prisma.conciliacaoLinha.upsert({
        where: { idMovimFinan: linha.id },
        // Reconferir é reconferir: o registro fica com quem conferiu por
        // último, e não com quem passou por ali primeiro.
        update: dados,
        create: { idMovimFinan: linha.id, ...dados },
      });
      conferidas.push(linha.id);
    }

    this.logger.log(
      `${conferidas.length} linha(s) da conta ${conta} conferidas por ${usuario ?? 'alguém'}.`,
    );
    return { conferidas };
  }

  /** Desfaz a conferência — quem marcou errado precisa poder desmarcar. */
  async desconferir(ids: number[]): Promise<{ desconferidas: number }> {
    if (ids.length === 0) return { desconferidas: 0 };
    const { count } = await this.prisma.conciliacaoLinha.deleteMany({
      where: { idMovimFinan: { in: ids } },
    });
    return { desconferidas: count };
  }

  /**
   * Títulos em aberto que podem ser a saída que apareceu no extrato.
   *
   * O valor manda: uma saída de R$ 756,57 procura títulos de R$ 756,57. Quando
   * não vier valor nenhum (ou ninguém achar nada por ele), o texto procura pelo
   * nome do fornecedor — que é como se acha o que foi pago com desconto ou
   * juros, onde o valor do extrato nunca vai bater com o do título.
   */
  async titulosEmAberto(input: {
    valor?: number;
    data?: string;
    busca?: string;
  }): Promise<
    Array<{
      idFnApagar: number;
      fornecedor: string;
      documento: string | null;
      valorAberto: number;
      vencimento: string | null;
      diasDoExtrato: number | null;
    }>
  > {
    const { contas } = await this.contasAbertas.listar();
    const busca = normalizar(input.busca ?? '');
    const alvo = input.valor ? Math.round(input.valor * 100) : null;
    const dataExtrato = input.data ? Date.parse(`${input.data}T00:00:00Z`) : null;

    return contas
      .filter((c) => {
        if (busca) return normalizar(c.fornecedor.nome).includes(busca);
        if (alvo === null) return true;
        return Math.round(c.valorAberto * 100) === alvo;
      })
      .map((c) => {
        const vencimento = c.vencimento ? c.vencimento.toISOString().slice(0, 10) : null;
        const dias =
          dataExtrato !== null && c.vencimento
            ? Math.round(
                (c.vencimento.getTime() - dataExtrato) / (24 * 60 * 60 * 1000),
              )
            : null;
        return {
          idFnApagar: c.idFnApagar,
          fornecedor: c.fornecedor.nome,
          documento: c.documento,
          valorAberto: c.valorAberto,
          vencimento,
          diasDoExtrato: dias,
        };
      })
      // Quem vence mais perto do dia em que o dinheiro saiu vem primeiro: é
      // quase sempre o título certo quando há vários do mesmo valor.
      .sort((a, b) => Math.abs(a.diasDoExtrato ?? 999) - Math.abs(b.diasDoExtrato ?? 999))
      .slice(0, 50);
  }

  /**
   * Dá baixa num título a partir da linha do extrato.
   *
   * O dinheiro já saiu — está no extrato, na frente de quem clicou. Por isso a
   * baixa vai com `jaSaiu`: a espera pelo banco existe para o pagamento que
   * ainda vai acontecer, e este já aconteceu. A conta é a da conciliação e a
   * data é a do extrato, que é o que faz o lançamento nascer já no lugar certo
   * do livro — e aparecer nesta tela na atualização seguinte.
   */
  async baixar(input: {
    idFnApagar: number;
    conta: number;
    data: string;
    usuario?: string;
  }) {
    const conta = await this.acharConta(input.conta);
    const resultado = await this.pagamentos.pagar(
      input.idFnApagar,
      { contaPagamento: conta.id, data: input.data, jaSaiu: true },
      input.usuario,
    );
    this.logger.log(
      `Título ${input.idFnApagar} baixado pela conciliação da conta ${conta.id} ` +
        `(${conta.nome}) na data ${input.data}.`,
    );
    return resultado;
  }

  // -------------------------------------------------------------------------

  /** Cruza as linhas do IXC com o extrato e devolve o resumo do lado do banco. */
  private cruzarComExtrato(
    montadas: LinhaDaConciliacao[],
    linhas: LinhaCrua[],
    ofx: string,
    periodo: { de: string; ate: string },
    avisos: string[],
  ): ResumoDoExtrato {
    let extrato: ExtratoImportado;
    try {
      extrato = lerOfx(ofx);
    } catch (err) {
      if (err instanceof ExtratoIlegivel) throw new BadRequestException(err.message);
      throw err;
    }

    const paraCasar: LinhaParaCasar[] = linhas.map((l) => ({
      id: l.id,
      data: l.data,
      valor: l.valor,
      historico: l.historico,
      documento: l.documento,
    }));

    const resultado = casar(paraCasar, extrato.transacoes);
    const porId = new Map(montadas.map((l) => [l.id, l]));
    for (const par of resultado.casados) {
      const linha = porId.get(par.linha.id);
      if (!linha) continue;
      linha.extrato = {
        fitId: par.transacao.fitId,
        data: par.transacao.data,
        valor: par.transacao.valor,
        descricao: par.transacao.descricao,
        como: par.como,
        diasDeDiferenca: par.diasDeDiferenca,
      };
    }

    /*
     * O arquivo quase nunca cobre exatamente o período da tela: baixa-se o
     * extrato do mês e olha-se uma quinzena. As transações de fora ficam de
     * lado, e não na lista de "só no banco" — ali só pode estar o que
     * realmente falta lançar, senão o pagamento esquecido some no meio de uma
     * dúzia de transações que estão certas, só que noutra semana.
     */
    const dentro: TransacaoExtrato[] = [];
    let fora = 0;
    for (const t of resultado.soNoBanco) {
      if (t.data >= periodo.de && t.data <= periodo.ate) dentro.push(t);
      else fora += 1;
    }
    if (fora > 0) {
      avisos.push(
        `${fora} transação(ões) do extrato estão fora de ${formatarDia(periodo.de)} ` +
          `a ${formatarDia(periodo.ate)} e ficaram de fora da conferência. ` +
          'Ajuste o período para vê-las.',
      );
    }

    return {
      banco: extrato.banco,
      agencia: extrato.agencia,
      conta: extrato.conta,
      de: extrato.de,
      ate: extrato.ate,
      saldo: extrato.saldo,
      saldoEm: extrato.saldoEm,
      transacoes: extrato.transacoes.length,
      entradas: soma(
        extrato.transacoes.filter((t) => t.valor > 0).map((t) => t.valor),
      ),
      saidas: soma(
        extrato.transacoes.filter((t) => t.valor < 0).map((t) => -t.valor),
      ),
      soNoBanco: dentro,
    };
  }

  /**
   * Os ids que o IXC já tem por conciliados no período.
   *
   * É a mesma consulta das linhas, com um filtro a mais. Tem de ser outra
   * chamada porque o `conciliado` não vem na listagem: dá para filtrar por ele,
   * não para lê-lo.
   *
   * Falhar aqui não derruba a tela — ela mostra tudo como pendente e avisa. É
   * melhor uma tela pessimista do que nenhuma.
   */
  private async idsConciliadosNoIxc(
    razao: number,
    de: string,
    ate: string,
    avisos: string[],
  ): Promise<Set<number>> {
    try {
      const registros = await this.ixc.listAll<Record<string, unknown>>(
        'fn_movim_finan',
        {
          qtype: 'fn_movim_finan.id_conta',
          query: String(razao),
          oper: '=',
          sortname: 'fn_movim_finan.data',
          sortorder: 'asc',
          gridParam: [
            ...filtroDePeriodo(de, ate),
            { TB: 'fn_movim_finan.conciliado', OP: '=', P: 'S' },
          ],
        },
        {
          pageSize: LINHAS_POR_PAGINA,
          maxPages: TETO_DE_LINHAS / LINHAS_POR_PAGINA,
        },
      );
      const ids = new Set<number>();
      for (const r of registros) {
        const id = parseIxcId(r.id);
        if (id) ids.add(id);
      }
      return ids;
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não deu para ler o conciliado do IXC: ${motivo}`);
      avisos.push(
        'Não consegui ler do IXC o que já está conciliado por lá — as linhas ' +
          'aparecem como pendentes até a próxima tentativa.',
      );
      return new Set();
    }
  }

  /** O que já foi conferido nesta tela, no período. */
  private async conferidasNoPeriodo(conta: number, de: string, ate: string) {
    const registros = await this.prisma.conciliacaoLinha.findMany({
      where: {
        contaIxc: conta,
        data: {
          gte: new Date(`${de}T00:00:00Z`),
          lte: new Date(`${ate}T23:59:59Z`),
        },
      },
    });
    return new Map(registros.map((r) => [r.idMovimFinan, r]));
  }

  /**
   * Os títulos por trás das linhas de pagamento, quando eles nasceram aqui.
   *
   * O número do título vem do próprio histórico do IXC ("- doc.: 36508"). Ele
   * serve para duas coisas na tela: dizer que aquela saída é de uma conta que
   * este app lançou, e abrir a ficha dela sem ter de procurar.
   */
  private async titulosDasLinhas(
    linhas: LinhaCrua[],
  ): Promise<Map<number, TituloDaLinha>> {
    const ids = [...new Set(linhas.map((l) => l.idTitulo).filter((id): id is number => id !== null))];
    if (ids.length === 0) return new Map();

    const nossas = await this.prisma.contaPagar.findMany({
      where: { idFnApagarIxc: { in: ids } },
      select: { idFnApagarIxc: true, beneficiarioNome: true },
    });
    const porTitulo = new Map(
      nossas.map((c) => [c.idFnApagarIxc!, c.beneficiarioNome] as const),
    );

    return new Map(
      ids.map((id) => [
        id,
        {
          idFnApagar: id,
          beneficiario: porTitulo.get(id) ?? null,
          nossa: porTitulo.has(id),
        },
      ]),
    );
  }

  private async acharConta(id: number): Promise<ContaConciliavel> {
    const conta = (await this.contas()).find((c) => c.id === id);
    if (!conta) {
      throw new BadRequestException(
        `A conta ${id} não existe no IXC, ou não tem conta do razão — sem ela ` +
          'não há movimentação para conciliar.',
      );
    }
    return conta;
  }
}

/** Uma linha do IXC já traduzida, antes de ganhar os estados da tela. */
interface LinhaCrua {
  id: number;
  data: string;
  historico: string;
  documento: string | null;
  valor: number;
  /** Número do título lido do histórico, quando há. */
  idTitulo: number | null;
}

/**
 * Uma linha crua de `fn_movim_finan` traduzida para o que a tela precisa.
 *
 * O sinal do valor é a parte que importa: em conta de banco o **débito entra** e
 * o **crédito sai**, e é assim que ele fica comparável com o extrato, onde o
 * banco já manda negativo o que saiu.
 */
export function mapLinha(raw: Record<string, unknown>): LinhaCrua | null {
  const id = parseIxcId(raw.id);
  const data = String(raw.data ?? '').slice(0, 10);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;

  const debito = Number(raw.debito ?? 0) || 0;
  const credito = Number(raw.credito ?? 0) || 0;
  const historico = String(raw.historico ?? '').trim();

  return {
    id,
    data,
    historico,
    documento: texto(raw.documento),
    valor: arredondar(debito - credito),
    idTitulo: numeroDoTitulo(historico, texto(raw.documento)),
  };
}

/**
 * O número do título escondido no histórico da baixa.
 *
 * O IXC escreve "Pag. Comercial Rofe Ltda - doc.: 36508" no pagamento e
 * "Rec. Títulos 769465 Fulano" no recebimento. O primeiro é conta a pagar, que
 * é o que esta tela sabe abrir; o segundo é do lado de receber e fica de fora.
 */
export function numeroDoTitulo(
  historico: string,
  documento: string | null,
): number | null {
  const doHistorico = /doc\.?:\s*(\d{2,})/i.exec(historico ?? '');
  if (doHistorico && /^pag/i.test(historico.trim())) {
    return Number(doHistorico[1]);
  }
  // Sem "doc.:" no histórico, a coluna documento serve — mas só quando a linha
  // é de pagamento, senão o número do recibo do cliente viraria um título.
  if (documento && /^\d+$/.test(documento) && /^pag/i.test((historico ?? '').trim())) {
    return Number(documento);
  }
  return null;
}

/** O filtro de datas do IXC, que vai em `grid_param`. */
function filtroDePeriodo(de: string, ate: string) {
  return [
    { TB: 'fn_movim_finan.data', OP: '>=', P: de },
    { TB: 'fn_movim_finan.data', OP: '<=', P: ate },
  ];
}

/** Período aceitável: datas legíveis, na ordem certa e de no máximo um ano. */
function periodoValido(de: string, ate: string): { de: string; ate: string } {
  const inicio = (de ?? '').slice(0, 10);
  const fim = (ate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    throw new BadRequestException('As datas do período precisam ser AAAA-MM-DD.');
  }
  if (inicio > fim) {
    throw new BadRequestException('O período começa depois de terminar.');
  }
  const dias =
    (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) /
    (24 * 60 * 60 * 1000);
  if (dias > 366) {
    throw new BadRequestException(
      'O período não pode passar de um ano — a leitura do IXC não voltaria.',
    );
  }
  return { de: inicio, ate: fim };
}

/** "2026-08-01" → "01/08/2026", para caber numa frase. */
function formatarDia(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function soma(valores: number[]): number {
  return arredondar(valores.reduce((s, v) => s + v, 0));
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function texto(valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  return s || null;
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}
