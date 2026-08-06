import { Injectable } from '@nestjs/common';
import { StatusContaPagar, TipoLancamento } from '@prisma/client';
import { competenciaAnterior } from '../financeiro/folha.calc';
import { FuncionariosService } from '../funcionarios/funcionarios.service';
import { PrismaService } from '../prisma/prisma.service';
import { ValesService } from '../vales/vales.service';

/** Status que ainda vão virar dinheiro saindo do caixa. */
const EM_ABERTO: StatusContaPagar[] = [
  StatusContaPagar.RASCUNHO,
  StatusContaPagar.AGUARDANDO_APROVACAO,
  StatusContaPagar.APROVADO,
  StatusContaPagar.AGUARDANDO_PAGAMENTO,
];

/** Quantos meses a série histórica mostra (incluindo a competência atual). */
const MESES_NA_SERIE = 6;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funcionarios: FuncionariosService,
    private readonly vales: ValesService,
  ) {}

  async resumo(competencia?: string) {
    const comp = competencia ?? competenciaAtual();
    const meses = ultimosMeses(comp, MESES_NA_SERIE);

    const [
      funcionarios,
      valesResumo,
      semPix,
      porStatus,
      porTipo,
      serieTotal,
      seriePago,
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
        where: { competencia: comp },
        _count: { _all: true },
        _sum: { valor: true },
      }),
      this.prisma.contaPagar.groupBy({
        by: ['tipo'],
        where: { competencia: comp },
        _count: { _all: true },
        _sum: { valor: true },
      }),
      this.prisma.contaPagar.groupBy({
        by: ['competencia'],
        where: { competencia: { in: meses } },
        _sum: { valor: true },
      }),
      this.prisma.contaPagar.groupBy({
        by: ['competencia'],
        where: { competencia: { in: meses }, status: StatusContaPagar.PAGO },
        _sum: { valor: true },
      }),
      this.prisma.contaPagar.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.syncLog.findFirst({ orderBy: { iniciadoEm: 'desc' } }),
    ]);

    const somaStatus = (...alvos: StatusContaPagar[]) =>
      porStatus
        .filter((s) => alvos.includes(s.status))
        .reduce((soma, s) => soma + Number(s._sum.valor ?? 0), 0);

    const totalPorCompetencia = new Map(
      serieTotal.map((s) => [s.competencia, Number(s._sum.valor ?? 0)]),
    );
    const pagoPorCompetencia = new Map(
      seriePago.map((s) => [s.competencia, Number(s._sum.valor ?? 0)]),
    );

    return {
      competencia: comp,
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
          porTipo.map((t) => ({
            tipo: t.tipo,
            quantidade: t._count._all,
            valor: Number(t._sum.valor ?? 0),
          })),
        ),
      },
      vales: valesResumo,
      serie: meses.map((m) => ({
        competencia: m,
        total: totalPorCompetencia.get(m) ?? 0,
        pago: pagoPorCompetencia.get(m) ?? 0,
      })),
      ultimasContas,
      ultimoSync,
    };
  }
}

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

/** Ordem de leitura da folha: salário, adiantamento, bônus, o resto. */
const ORDEM_TIPO: TipoLancamento[] = [
  TipoLancamento.SALARIO,
  TipoLancamento.ADIANTAMENTO,
  TipoLancamento.BONUS,
  TipoLancamento.AVULSO,
  TipoLancamento.DESCONTO,
];

function ordenarTipos<T extends { tipo: TipoLancamento }>(itens: T[]): T[] {
  return [...itens].sort(
    (a, b) => ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo),
  );
}
