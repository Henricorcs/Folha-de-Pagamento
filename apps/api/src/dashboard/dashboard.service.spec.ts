import {
  FormaPagamentoDiaria,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { DashboardService } from './dashboard.service';

/**
 * A dashboard responde "quanto custa a operação". Errar a conta aqui é pior do
 * que não mostrar nada, porque o número parece confiável. O que este arquivo
 * protege:
 *
 *  - diária entra pelo mês em que foi trabalhada (a conta a pagar dela nasce
 *    sem competência, e as pagas em mãos nem viram conta);
 *  - conta reprovada ou cancelada não é gasto — nunca virou dinheiro;
 *  - o INSS retido do trabalhador não entra no custo da empresa.
 */

const COMP = '2026-07';

function montarServico(dados: {
  contas?: Array<{
    competencia: string | null;
    tipo: TipoLancamento;
    status: StatusContaPagar;
    valor: number;
  }>;
  diarias?: Array<{
    data: Date;
    valor: number;
    quantidade: number;
    forma: FormaPagamentoDiaria;
    diaristaId: string;
    contaPagar: { status: StatusContaPagar } | null;
  }>;
  impostos?: {
    serie: Array<{
      competencia: string;
      folhaPatronal: number;
      folhaRetido: number;
      faturamento: number;
    }>;
  };
}) {
  const prisma = {
    funcionario: { count: jest.fn().mockResolvedValue(0) },
    contaPagar: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue(dados.contas ?? []),
    },
    diaria: { findMany: jest.fn().mockResolvedValue(dados.diarias ?? []) },
    syncLog: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;

  const funcionarios = {
    resumo: jest.fn().mockResolvedValue({
      total: 0,
      ativos: 0,
      inativos: 0,
      salarioBaseMensal: 0,
      bonusFixoMensal: 0,
      folhaBaseMensal: 0,
    }),
  } as any;

  const vales = { resumo: jest.fn().mockResolvedValue({}) } as any;

  const impostos = {
    resumo: jest.fn().mockResolvedValue(
      dados.impostos ?? {
        serie: [],
        total: { folhaPatronal: 0, folhaRetido: 0, faturamento: 0 },
        guias: [],
      },
    ),
  } as any;

  return {
    service: new DashboardService(prisma, funcionarios, vales, impostos),
    prisma,
    impostos,
  };
}

describe('período das séries', () => {
  it('cobre os meses pedidos, do mais antigo ao mês escolhido', async () => {
    const { service } = montarServico({});
    const r = await service.resumo(COMP, 3);
    expect(r.serie.map((s) => s.competencia)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(r.meses).toBe(3);
  });

  it('um mês só devolve só a competência escolhida', async () => {
    const { service } = montarServico({});
    const r = await service.resumo(COMP, 1);
    expect(r.serie).toHaveLength(1);
    expect(r.serie[0].competencia).toBe(COMP);
  });
});

describe('o que conta como gasto', () => {
  it('soma por tipo o que ainda pode virar dinheiro', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: COMP,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 5000,
        },
        {
          competencia: COMP,
          tipo: TipoLancamento.BONUS,
          status: StatusContaPagar.AGUARDANDO_PAGAMENTO,
          valor: 400,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.serieTipos[0]).toMatchObject({ salario: 5000, bonus: 400 });
    expect(r.serie[0]).toMatchObject({ total: 5400, pago: 5000 });
  });

  /** Reprovada, cancelada e com erro não saíram do caixa — não são custo. */
  it('conta reprovada, cancelada ou com erro fica fora do custo', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: COMP,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.REPROVADO,
          valor: 1000,
        },
        {
          competencia: COMP,
          tipo: TipoLancamento.BONUS,
          status: StatusContaPagar.CANCELADO,
          valor: 200,
        },
        {
          competencia: COMP,
          tipo: TipoLancamento.AVULSO,
          status: StatusContaPagar.ERRO,
          valor: 300,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.serieTipos[0]).toMatchObject({ salario: 0, bonus: 0, avulso: 0 });
    expect(r.custoPessoal[0].total).toBe(0);
  });
});

describe('diaristas', () => {
  const diaria = (
    dia: string,
    valor: number,
    forma: FormaPagamentoDiaria,
    status?: StatusContaPagar,
  ) => ({
    data: new Date(`${dia}T00:00:00.000Z`),
    valor,
    quantidade: 1,
    forma,
    diaristaId: 'd1',
    contaPagar: status ? { status } : null,
  });

  /**
   * A conta a pagar da diária nasce sem competência, então agregar por
   * competência perderia todas elas. O mês vem da data do trabalho.
   */
  it('entram pelo mês em que a diária foi trabalhada', async () => {
    const { service } = montarServico({
      diarias: [
        diaria('2026-06-30', 100, FormaPagamentoDiaria.EM_MAOS),
        diaria('2026-07-01', 200, FormaPagamentoDiaria.EM_MAOS),
      ],
    });

    const r = await service.resumo(COMP, 2);
    expect(r.diaristas.serie).toEqual([
      expect.objectContaining({ competencia: '2026-06', valor: 100 }),
      expect.objectContaining({ competencia: '2026-07', valor: 200 }),
    ]);
  });

  /** Em mãos o dinheiro já saiu; pelo IXC, só quando o banco confirmou. */
  it('separa o que já saiu do que ainda está a caminho', async () => {
    const { service } = montarServico({
      diarias: [
        diaria('2026-07-05', 150, FormaPagamentoDiaria.EM_MAOS),
        diaria(
          '2026-07-06',
          770,
          FormaPagamentoDiaria.IXC,
          StatusContaPagar.AGUARDANDO_PAGAMENTO,
        ),
        diaria('2026-07-07', 300, FormaPagamentoDiaria.IXC, StatusContaPagar.PAGO),
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.diaristas.serie[0]).toMatchObject({
      valor: 1220,
      pago: 450,
      aCaminho: 770,
      travado: 0,
      pessoas: 1,
      quantidade: 3,
    });
  });

  /**
   * Conta reprovada ou recusada pelo IXC nunca virou dinheiro — a série da
   * folha já as deixava de fora, e a das diárias contava. Ficavam inflando o
   * custo com pessoal e acendendo "ainda não saiu" por algo que não vai sair.
   */
  it('diária reprovada, cancelada ou com erro sai do gasto', async () => {
    const { service } = montarServico({
      diarias: [
        diaria('2026-07-05', 100, FormaPagamentoDiaria.IXC, StatusContaPagar.PAGO),
        diaria('2026-07-06', 200, FormaPagamentoDiaria.IXC, StatusContaPagar.REPROVADO),
        diaria('2026-07-07', 300, FormaPagamentoDiaria.IXC, StatusContaPagar.CANCELADO),
        diaria('2026-07-08', 400, FormaPagamentoDiaria.IXC, StatusContaPagar.ERRO),
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.diaristas.serie[0]).toMatchObject({
      valor: 100,
      pago: 100,
      aCaminho: 0,
      travado: 900,
      travadas: 3,
      quantidade: 1,
    });
    expect(r.custoPessoal[0].diaristas).toBe(100);
  });

  /**
   * Conta a pagar apagada no IXC deixa a diária sem conta nenhuma. Contá-la
   * como gasto pendente prendia a tela num "ainda não saiu" que nunca ia
   * embora: não havia pagamento pendente algum para acertar.
   */
  it('diária cuja conta a pagar sumiu do IXC não fica pendente para sempre', async () => {
    const { service } = montarServico({
      diarias: [diaria('2026-07-05', 1590, FormaPagamentoDiaria.IXC)],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.diaristas.serie[0]).toMatchObject({
      valor: 0,
      pago: 0,
      aCaminho: 0,
      travado: 1590,
    });
  });

  it('aparecem na repartição do mês, que a conta a pagar não alcança', async () => {
    const { service } = montarServico({
      diarias: [diaria('2026-07-05', 770, FormaPagamentoDiaria.EM_MAOS)],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.folha.porTipo).toContainEqual({
      tipo: TipoLancamento.DIARIA,
      quantidade: 1,
      valor: 770,
    });
  });
});

describe('custo com pessoal', () => {
  /**
   * O ponto mais importante da tela: o INSS retido do trabalhador passa pela
   * conta da empresa mas é dinheiro dele. Somar aqui contaria o mesmo salário
   * duas vezes — e o número inflado é o que a pessoa levaria para a reunião.
   */
  it('soma folha, diaristas e patronal — nunca o retido do trabalhador', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: COMP,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 10000,
        },
      ],
      diarias: [
        {
          data: new Date('2026-07-10T00:00:00.000Z'),
          valor: 770,
          quantidade: 5.5,
          forma: FormaPagamentoDiaria.EM_MAOS,
          diaristaId: 'd1',
          contaPagar: null,
        },
      ],
      impostos: {
        serie: [
          {
            competencia: COMP,
            folhaPatronal: 15062.16,
            folhaRetido: 5294.94,
            faturamento: 11556.5,
          },
        ],
      },
    });

    const r = await service.resumo(COMP, 1);
    expect(r.custoPessoal[0]).toEqual({
      competencia: COMP,
      folha: 10000,
      diaristas: 770,
      encargos: 15062.16,
      total: 25832.16,
    });
  });

  it('sem guia lançada, o custo é só folha e diaristas', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: COMP,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 1000,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.custoPessoal[0]).toMatchObject({ encargos: 0, total: 1000 });
  });
});
