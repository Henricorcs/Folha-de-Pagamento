import { Injectable } from '@nestjs/common';
import {
  FormaPagamento,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { competenciaAnterior } from '../financeiro/folha.calc';
import { FuncionariosService } from '../funcionarios/funcionarios.service';
import { ImpostosService } from '../impostos/impostos.service';
import { PrismaService } from '../prisma/prisma.service';
import { ValesService } from '../vales/vales.service';

/** Status que ainda vão virar dinheiro saindo do caixa. */
const EM_ABERTO: StatusContaPagar[] = [
  StatusContaPagar.RASCUNHO,
  StatusContaPagar.AGUARDANDO_APROVACAO,
  StatusContaPagar.APROVADO,
  StatusContaPagar.AGUARDANDO_PAGAMENTO,
];

/** O contrário: nunca virou dinheiro, então nunca foi gasto. */
const SEM_SAIDA: StatusContaPagar[] = [
  StatusContaPagar.REPROVADO,
  StatusContaPagar.CANCELADO,
  StatusContaPagar.ERRO,
];

/** Quantos meses a série histórica mostra, contando a competência atual. */
const MESES_NA_SERIE = 12;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funcionarios: FuncionariosService,
    private readonly vales: ValesService,
    private readonly impostos: ImpostosService,
  ) {}

  async resumo(competencia?: string, mesesPedidos?: number) {
    const comp = competencia ?? competenciaAtual();
    const quantidade = Math.min(Math.max(mesesPedidos ?? MESES_NA_SERIE, 1), 24);
    const meses = ultimosMeses(comp, quantidade);
    const inicio = primeiroDia(meses[0]);
    const fim = depoisDoUltimoDia(comp);

    // Diária e pagamento avulso não têm competência na conta a pagar (ela nasce
    // sem, e o pago em mãos nem vira conta). Os dois entram pela data do
    // pagamento — mas a situação do mês lê a conta, e sem esta janela o avulso
    // pago sumia da tela inteira.
    const doMes = {
      OR: [
        { competencia: comp },
        { competencia: null, dataEmissao: { gte: primeiroDia(comp), lt: fim } },
      ],
    };

    const [
      funcionarios,
      valesResumo,
      semPix,
      porStatus,
      porTipo,
      serieContas,
      diarias,
      avulsos,
      impostos,
      ultimasContas,
      ultimoSync,
    ] = await Promise.all([
      this.funcionarios.resumo(),
      this.vales.resumo(comp),
      this.prisma.funcionario.count({
        where: {
          isentoIcms: true,
          ativo: true,
          OR: [{ chavePix: null }, { chavePix: '' }],
        },
      }),
      this.prisma.contaPagar.groupBy({
        by: ['status'],
        where: doMes,
        _count: { _all: true },
        _sum: { valor: true },
      }),
      this.prisma.contaPagar.groupBy({
        by: ['tipo'],
        where: doMes,
        _count: { _all: true },
        _sum: { valor: true },
      }),
      // Uma leitura só para todas as séries: tipo, status e mês por conta.
      this.prisma.contaPagar.findMany({
        where: { competencia: { in: meses } },
        select: {
          competencia: true,
          tipo: true,
          status: true,
          valor: true,
          comissaoVendas: true,
          vendas: true,
        },
      }),
      this.prisma.diaria.findMany({
        where: { data: { gte: inicio, lt: fim } },
        select: {
          data: true,
          valor: true,
          quantidade: true,
          comissaoVendas: true,
          vendas: true,
          forma: true,
          diaristaId: true,
          contaPagar: { select: { status: true } },
        },
      }),
      this.prisma.pagamentoAvulso.findMany({
        where: { data: { gte: inicio, lt: fim } },
        select: {
          data: true,
          valor: true,
          comissaoVendas: true,
          vendas: true,
          forma: true,
          beneficiarioId: true,
          contaPagar: { select: { status: true } },
        },
      }),
      this.impostos.resumo(meses),
      this.prisma.contaPagar.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
      this.prisma.syncLog.findFirst({ orderBy: { iniciadoEm: 'desc' } }),
    ]);

    const somaStatus = (...alvos: StatusContaPagar[]) =>
      porStatus
        .filter((s) => alvos.includes(s.status))
        .reduce((soma, s) => soma + Number(s._sum.valor ?? 0), 0);

    const serie = montarSerieContas(meses, serieContas);
    const diaristas = montarPagamentosPorData(meses, diarias, (d) => d.diaristaId);
    const avulsosSerie = montarPagamentosPorData(
      meses,
      avulsos,
      (p) => p.beneficiarioId,
    );
    const diariasDoMes = diaristas.serie.find((d) => d.competencia === comp);
    const avulsosDoMes = avulsosSerie.serie.find((a) => a.competencia === comp);
    const serieTipos = comDiariaEAvulso(serie.porTipo, diaristas, avulsosSerie);
    const vendas = montarVendas(meses, [...diarias, ...avulsos], serieContas);

    return {
      competencia: comp,
      meses: quantidade,
      funcionarios: {
        total: funcionarios.total,
        ativos: funcionarios.ativos,
        inativos: funcionarios.inativos,
        salarioBaseMensal: Number(funcionarios.salarioBaseMensal),
        bonusFixoMensal: Number(funcionarios.bonusFixoMensal),
        folhaBaseMensal: Number(funcionarios.folhaBaseMensal),
        semPix,
      },
      folha: {
        total: porStatus.reduce((s, i) => s + Number(i._sum.valor ?? 0), 0),
        pago: somaStatus(StatusContaPagar.PAGO),
        emAberto: somaStatus(...EM_ABERTO),
        comErro: somaStatus(StatusContaPagar.ERRO),
        quantidade: porStatus.reduce((s, i) => s + i._count._all, 0),
        porStatus: porStatus
          .map((s) => ({
            status: s.status,
            quantidade: s._count._all,
            valor: Number(s._sum.valor ?? 0),
          }))
          .sort((a, b) => b.valor - a.valor),
        porTipo: ordenarTipos(
          porTipo
            .map((t) => ({
              tipo: t.tipo,
              quantidade: t._count._all,
              valor: Number(t._sum.valor ?? 0),
            }))
            // Diária e avulso não têm competência na conta a pagar; entram pela
            // data do pagamento, que é o que a série ao lado já sabe contar.
            .filter(
              (t) =>
                t.tipo !== TipoLancamento.DIARIA &&
                t.tipo !== TipoLancamento.AVULSO,
            )
            .concat(
              linhaDoTipo(TipoLancamento.DIARIA, diariasDoMes),
              linhaDoTipo(TipoLancamento.AVULSO, avulsosDoMes),
            ),
        ),
      },
      vales: valesResumo,
      serie: serie.total,
      serieTipos,
      diaristas,
      avulsos: avulsosSerie,
      vendas,
      impostos,
      custoPessoal: montarCustoPessoal(meses, serieTipos, diaristas, impostos),
      ultimasContas,
      ultimoSync,
    };
  }
}

/** A linha daquele tipo na repartição do mês — omitida quando não houve nada. */
function linhaDoTipo(
  tipo: TipoLancamento,
  mes: { quantidade: number; valor: number } | undefined,
): Array<{ tipo: TipoLancamento; quantidade: number; valor: number }> {
  return mes && mes.valor > 0
    ? [{ tipo, quantidade: mes.quantidade, valor: mes.valor }]
    : [];
}

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------

interface ContaDaSerie {
  competencia: string | null;
  tipo: TipoLancamento;
  status: StatusContaPagar;
  valor: unknown;
  /** Quanto do valor era comissão de venda, gravado ao gerar a folha. */
  comissaoVendas: unknown;
  vendas: number;
}

/**
 * Duas leituras da mesma lista de contas: o total × pago de cada mês (a barra
 * do topo) e a repartição por tipo (de onde saem os gráficos de bônus,
 * salário e adiantamento).
 */
function montarSerieContas(meses: string[], contas: ContaDaSerie[]) {
  const total = new Map(meses.map((m) => [m, { total: 0, pago: 0 }]));
  const porTipo = new Map(meses.map((m) => [m, zeroPorTipo()]));

  for (const conta of contas) {
    if (!conta.competencia) continue;
    const mes = total.get(conta.competencia);
    const tipos = porTipo.get(conta.competencia);
    if (!mes || !tipos) continue;

    const valor = Number(conta.valor ?? 0);
    mes.total += valor;
    if (conta.status === StatusContaPagar.PAGO) mes.pago += valor;

    // Reprovada e cancelada não são gasto: nunca viraram dinheiro.
    if (!SEM_SAIDA.includes(conta.status)) {
      tipos[CHAVE_DO_TIPO[conta.tipo]] += valor;
    }
  }

  return {
    total: meses.map((competencia) => {
      const m = total.get(competencia) ?? { total: 0, pago: 0 };
      return {
        competencia,
        total: arredondar(m.total),
        pago: arredondar(m.pago),
      };
    }),
    porTipo: meses.map((competencia) => ({
      competencia,
      ...arredondarTipos(porTipo.get(competencia) ?? zeroPorTipo()),
    })),
  };
}

/**
 * Um pagamento a quem não é da folha — diária ou avulso. Os dois entram na
 * dashboard pela data em que o dinheiro saiu, e não pela competência, porque a
 * conta a pagar dos dois nasce sem competência (e a paga em mãos nem vira
 * conta). Era isso que fazia o avulso pago sumir de todos os números.
 */
interface PagamentoDaSerie {
  data: Date;
  valor: unknown;
  /** Diárias trabalhadas; ausente no avulso, que conta um por pagamento. */
  quantidade?: unknown;
  comissaoVendas: unknown;
  vendas: number;
  forma: FormaPagamento;
  contaPagar: { status: StatusContaPagar } | null;
}

/** Onde o pagamento está no caminho do dinheiro. */
type SituacaoDoPagamento = 'SAIU' | 'A_CAMINHO' | 'TRAVADO';

/**
 * A mesma régua das telas de diarista e avulso, para todas contarem a mesma
 * história: em mãos o dinheiro saiu da gaveta na hora (o lançamento no caixa do
 * IXC é escrituração, não pagamento); pelo IXC, só quando o banco confirmou.
 */
function situacaoDoPagamento(p: PagamentoDaSerie): SituacaoDoPagamento {
  if (p.forma === FormaPagamento.EM_MAOS) return 'SAIU';
  const status = p.contaPagar?.status;
  if (status === StatusContaPagar.PAGO) return 'SAIU';
  if (status && EM_ABERTO.includes(status)) return 'A_CAMINHO';
  // Reprovada, cancelada, recusada pelo IXC — ou sem conta nenhuma, que é como
  // fica o pagamento quando o fn_apagar dele é apagado lá. Nenhum deles vai
  // sair sozinho, e é o último que ficava para sempre em "ainda não saiu".
  return 'TRAVADO';
}

/**
 * Gasto com diaristas (ou com avulsos), mês a mês.
 *
 * Só entra o que virou dinheiro ou ainda vai virar. Pagamento travado fica de
 * fora do gasto — é a mesma regra da série da folha, onde conta reprovada e
 * cancelada nunca contaram — mas continua somado à parte, senão sumiria da tela
 * sem ninguém saber que existe algo para destravar.
 */
function montarPagamentosPorData<T extends PagamentoDaSerie>(
  meses: string[],
  pagamentos: T[],
  quemRecebeu: (p: T) => string,
) {
  const porMes = new Map(
    meses.map((m) => [
      m,
      {
        pago: 0,
        aCaminho: 0,
        travado: 0,
        travadas: 0,
        quantidade: 0,
        pessoas: new Set<string>(),
      },
    ]),
  );

  for (const p of pagamentos) {
    const mes = porMes.get(mesDaData(p.data));
    if (!mes) continue;

    const valor = Number(p.valor ?? 0);
    const situacao = situacaoDoPagamento(p);
    if (situacao === 'TRAVADO') {
      mes.travado += valor;
      mes.travadas++;
      continue;
    }

    if (situacao === 'SAIU') mes.pago += valor;
    else mes.aCaminho += valor;
    // Quantos pagamentos e quantas pessoas o número do topo está resumindo — só
    // os que ele conta, para o detalhe não contradizer o valor.
    mes.quantidade += p.quantidade === undefined ? 1 : Number(p.quantidade ?? 0);
    mes.pessoas.add(quemRecebeu(p));
  }

  const serie = meses.map((competencia) => {
    const m = porMes.get(competencia);
    const pago = arredondar(m?.pago ?? 0);
    const aCaminho = arredondar(m?.aCaminho ?? 0);
    return {
      competencia,
      valor: arredondar(pago + aCaminho),
      pago,
      aCaminho,
      travado: arredondar(m?.travado ?? 0),
      travadas: m?.travadas ?? 0,
      quantidade: arredondar(m?.quantidade ?? 0),
      pessoas: m?.pessoas.size ?? 0,
    };
  });

  return {
    serie,
    total: arredondar(serie.reduce((s, m) => s + m.valor, 0)),
    totalPago: arredondar(serie.reduce((s, m) => s + m.pago, 0)),
    totalACaminho: arredondar(serie.reduce((s, m) => s + m.aCaminho, 0)),
    totalTravado: arredondar(serie.reduce((s, m) => s + m.travado, 0)),
    quantidade: arredondar(serie.reduce((s, m) => s + m.quantidade, 0)),
  };
}

/** Uma série de gasto mês a mês, como as de diarista e avulso devolvem. */
type SerieDeGasto = { serie: Array<{ competencia: string; valor: number }> };

/**
 * Preenche na repartição por tipo o que a conta a pagar não alcança. Diária e
 * avulso nascem sem competência, então a série montada por competência as
 * mostrava sempre em zero — e o custo com pessoal saía menor do que foi.
 */
function comDiariaEAvulso(
  porTipo: Array<{ competencia: string } & PorTipo>,
  diaristas: SerieDeGasto,
  avulsos: SerieDeGasto,
): Array<{ competencia: string } & PorTipo> {
  const valorEm = (s: SerieDeGasto, competencia: string) =>
    s.serie.find((m) => m.competencia === competencia)?.valor ?? 0;

  return porTipo.map((mes) => ({
    ...mes,
    diaria: valorEm(diaristas, mes.competencia),
    avulso: valorEm(avulsos, mes.competencia),
  }));
}

/**
 * Quanto o mês custou em comissão de venda.
 *
 * Só entra o que está **escrito** no pagamento. Diarista e avulso recebem a
 * comissão junto do próprio pagamento; funcionário recebe dentro do salário, e
 * a folha grava na conta a pagar quanto dela era comissão.
 *
 * Refazer essa conta pelas vendas lançadas seria mais fácil e daria um número
 * que ninguém pagou: venda lançada depois da folha (ou corrigida depois)
 * reescreveria um mês fechado, e o que foi lançado antes de a empresa passar a
 * pagar comissão por aqui viraria gasto que nunca saiu. Por isso as contas
 * antigas contam zero — a comissão delas não foi registrada.
 */
function montarVendas(
  meses: string[],
  pagamentos: PagamentoDaSerie[],
  contas: ContaDaSerie[],
) {
  const porMes = new Map(
    meses.map((m) => [m, { fora: 0, folha: 0, vendas: 0 }]),
  );

  for (const p of pagamentos) {
    const mes = porMes.get(mesDaData(p.data));
    // Comissão de pagamento travado não saiu nem vai sair, como o resto dele.
    if (!mes || situacaoDoPagamento(p) === 'TRAVADO') continue;
    mes.fora += Number(p.comissaoVendas ?? 0);
    mes.vendas += p.vendas;
  }

  for (const c of contas) {
    const mes = c.competencia ? porMes.get(c.competencia) : undefined;
    if (!mes || SEM_SAIDA.includes(c.status)) continue;
    mes.folha += Number(c.comissaoVendas ?? 0);
    mes.vendas += c.vendas;
  }

  const serie = meses.map((competencia) => {
    const m = porMes.get(competencia) ?? { fora: 0, folha: 0, vendas: 0 };
    return {
      competencia,
      funcionarios: arredondar(m.folha),
      foraDaFolha: arredondar(m.fora),
      total: arredondar(m.folha + m.fora),
      vendas: m.vendas,
    };
  });

  return {
    serie,
    total: arredondar(serie.reduce((s, m) => s + m.total, 0)),
    vendas: serie.reduce((s, m) => s + m.vendas, 0),
  };
}

/**
 * O que a empresa gasta com gente, mês a mês: o que a folha pagou, o que os
 * diaristas custaram e a parte patronal do imposto (FGTS e CPP).
 *
 * O INSS retido do trabalhador fica **fora** de propósito — é dinheiro dele
 * passando pela conta da empresa, e somar aqui contaria o mesmo salário duas
 * vezes.
 */
function montarCustoPessoal(
  meses: string[],
  porTipo: Array<{ competencia: string } & PorTipo>,
  diaristas: { serie: Array<{ competencia: string; valor: number }> },
  impostos: { serie: Array<{ competencia: string; folhaPatronal: number }> },
) {
  return meses.map((competencia) => {
    const t = porTipo.find((p) => p.competencia === competencia);
    const folha = t
      ? t.salario + t.adiantamento + t.bonus + t.avulso
      : 0;
    const diaria =
      diaristas.serie.find((d) => d.competencia === competencia)?.valor ?? 0;
    const encargo =
      impostos.serie.find((i) => i.competencia === competencia)?.folhaPatronal ??
      0;
    return {
      competencia,
      folha: arredondar(folha),
      diaristas: arredondar(diaria),
      encargos: arredondar(encargo),
      total: arredondar(folha + diaria + encargo),
    };
  });
}

// ---------------------------------------------------------------------------
// Utilidades de competência
// ---------------------------------------------------------------------------

/** "AAAA-MM" do mês corrente. */
function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

/** Os N meses até `competencia`, do mais antigo para o mais novo. */
function ultimosMeses(competencia: string, quantidade: number): string[] {
  const meses = [competencia];
  for (let i = 1; i < quantidade; i++) {
    meses.unshift(competenciaAnterior(meses[0]));
  }
  return meses;
}

/** "AAAA-MM" do dia, em UTC — é como as datas são gravadas. */
function mesDaData(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

function primeiroDia(competencia: string): Date {
  const [ano, mes] = competencia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, 1));
}

/** Primeiro instante do mês seguinte — o limite superior aberto da busca. */
function depoisDoUltimoDia(competencia: string): Date {
  const [ano, mes] = competencia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes, 1));
}

// ---------------------------------------------------------------------------
// Tipos de lançamento
// ---------------------------------------------------------------------------

export interface PorTipo {
  salario: number;
  adiantamento: number;
  bonus: number;
  avulso: number;
  diaria: number;
  desconto: number;
}

const CHAVE_DO_TIPO: Record<TipoLancamento, keyof PorTipo> = {
  SALARIO: 'salario',
  ADIANTAMENTO: 'adiantamento',
  BONUS: 'bonus',
  AVULSO: 'avulso',
  DIARIA: 'diaria',
  DESCONTO: 'desconto',
};

function zeroPorTipo(): PorTipo {
  return {
    salario: 0,
    adiantamento: 0,
    bonus: 0,
    avulso: 0,
    diaria: 0,
    desconto: 0,
  };
}

function arredondarTipos(p: PorTipo): PorTipo {
  return {
    salario: arredondar(p.salario),
    adiantamento: arredondar(p.adiantamento),
    bonus: arredondar(p.bonus),
    avulso: arredondar(p.avulso),
    diaria: arredondar(p.diaria),
    desconto: arredondar(p.desconto),
  };
}

/** Ordem de leitura da folha: salário, adiantamento, bônus, o resto. */
const ORDEM_TIPO: TipoLancamento[] = [
  TipoLancamento.SALARIO,
  TipoLancamento.ADIANTAMENTO,
  TipoLancamento.BONUS,
  TipoLancamento.DIARIA,
  TipoLancamento.AVULSO,
  TipoLancamento.DESCONTO,
];

function ordenarTipos<T extends { tipo: TipoLancamento }>(itens: T[]): T[] {
  return [...itens].sort(
    (a, b) => ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo),
  );
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
