import { StatusContaPagar, TipoLancamento } from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';

/* A folha sem falta nenhuma: cada arquivo destes prova outra coisa. */
const semFaltas = {
  descontoDaCompetencia: jest.fn().mockResolvedValue(new Map<string, number>()),
} as never;


/**
 * A prévia da folha precisa dizer, lançamento por lançamento, o que já saiu
 * nesta competência — é isso que faz a tela marcar só quem ainda não recebeu.
 * O bônus é um pagamento como qualquer outro: sem o aviso dele, quem já tinha
 * recebido aparecia marcado de novo.
 */
const FUNCIONARIOS = [
  {
    id: 'f1',
    nome: 'Henrico Santos',
    salarioBase: 2000,
    carteiraAssinada: false,
    valorAReceberFolha: null,
    recebeAdiantamento: false,
    valorAdiantamento: null,
    valorPorVenda: null,
    lancamentos: [
      { tipo: TipoLancamento.BONUS, valor: 400, competencia: null },
    ],
    variaveisMes: [],
  },
  {
    id: 'f2',
    nome: 'Maria Souza',
    salarioBase: 1500,
    carteiraAssinada: false,
    valorAReceberFolha: null,
    recebeAdiantamento: false,
    valorAdiantamento: null,
    valorPorVenda: null,
    lancamentos: [
      { tipo: TipoLancamento.BONUS, valor: 300, competencia: null },
    ],
    variaveisMes: [],
  },
];

/** Contas que já existem na competência da prévia. */
type ContaFake = {
  funcionarioId: string;
  tipo: TipoLancamento;
  status: StatusContaPagar;
  pagoEm: Date | null;
};

function montarServico(contas: ContaFake[]) {
  const prisma = {
    funcionario: { findMany: jest.fn().mockResolvedValue(FUNCIONARIOS) },
    contaPagar: {
      findMany: jest.fn(
        async ({ where }: { where: { tipo: TipoLancamento } }) =>
          contas.filter((c) => c.tipo === where.tipo),
      ),
    },
    // Ninguém de férias: quem responde por elas é o spec de férias na folha.
    feriasMarcada: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;

  const config = {
    obter: jest.fn().mockResolvedValue({
      contaContabilSalario: 2420,
      contaContabilAdiantamento: 2662,
      contaContabilBonus: 13916,
      contaContabilFerias: 2420,
      percentualAdiantamento: 40,
      obsSalarioTemplate: 'saldo salarial referente ao mês {competencia}',
      obsAdiantamentoTemplate: 'adiantamento',
      obsBonusTemplate: 'bônus referente ao mês {competencia}',
      obsFeriasTemplate: 'férias referentes ao mês {competencia}',
    }),
  } as any;

  const vales = {
    acertosDaCompetencia: jest.fn().mockResolvedValue(new Map()),
  } as any;

  return new ContasPagarService(
    prisma,
    {} as any,
    config,
    {} as any,
    vales,
    semFaltas,
  );
}

const PAGO_EM = new Date('2026-08-05T12:00:00Z');

describe('prepararFolha: o que já saiu nesta competência', () => {
  it('avisa do bônus já pago sem confundir com o salário', async () => {
    const service = montarServico([
      {
        funcionarioId: 'f1',
        tipo: TipoLancamento.BONUS,
        status: StatusContaPagar.PAGO,
        pagoEm: PAGO_EM,
      },
    ]);

    const previa = await service.prepararFolha({ competencia: '2026-08' });
    const henrico = previa.find((p) => p.funcionarioId === 'f1')!;
    const maria = previa.find((p) => p.funcionarioId === 'f2')!;

    expect(henrico.bonusJaGerado).toEqual({
      situacao: 'PAGO',
      status: StatusContaPagar.PAGO,
      pagoEm: PAGO_EM,
    });
    // O salário dele ainda não saiu: continua a pagar.
    expect(henrico.salarioJaGerado).toBeNull();
    // E ninguém mais herda o aviso.
    expect(maria.bonusJaGerado).toBeNull();
    expect(maria.salarioJaGerado).toBeNull();
  });

  it('bônus ainda não pago também conta: gerar de novo duplicaria', async () => {
    const service = montarServico([
      {
        funcionarioId: 'f1',
        tipo: TipoLancamento.BONUS,
        status: StatusContaPagar.AGUARDANDO_PAGAMENTO,
        pagoEm: null,
      },
    ]);

    const [henrico] = await service.prepararFolha({ competencia: '2026-08' });
    expect(henrico.bonusJaGerado).toMatchObject({ situacao: 'PENDENTE' });
  });

  it('bônus cancelado ou reprovado não conta: aí é para gerar mesmo', async () => {
    for (const status of [
      StatusContaPagar.CANCELADO,
      StatusContaPagar.REPROVADO,
    ]) {
      const service = montarServico([
        { funcionarioId: 'f1', tipo: TipoLancamento.BONUS, status, pagoEm: null },
      ]);
      const [henrico] = await service.prepararFolha({ competencia: '2026-08' });
      expect(henrico.bonusJaGerado).toBeNull();
    }
  });

  it('sem nada gerado, a competência inteira nasce limpa', async () => {
    const service = montarServico([]);
    const previa = await service.prepararFolha({ competencia: '2026-08' });
    expect(previa).toHaveLength(2);
    for (const p of previa) {
      expect(p.bonusJaGerado).toBeNull();
      expect(p.salarioJaGerado).toBeNull();
      // Os dois lançamentos continuam sendo oferecidos.
      expect(p.lancamentos.map((l) => l.tipo)).toEqual([
        TipoLancamento.SALARIO,
        TipoLancamento.BONUS,
      ]);
    }
  });
});
