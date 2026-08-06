import { TipoLancamento } from '@prisma/client';
import {
  calcularAdiantamento,
  calcularSaldoSalarial,
  competenciaAnterior,
  formatCompetencia,
  montarLancamentosFolha,
  renderObs,
  type DadosFolhaFuncionario,
  type ParametrosLancamento,
} from './folha.calc';

const params: ParametrosLancamento = {
  contaContabilSalario: 2420,
  contaContabilAdiantamento: 2662,
  contaContabilBonus: 13916,
  obsSalario: 'saldo salarial referente ao mês 07/2026',
  obsAdiantamento: 'adiantamento',
  obsBonus: 'bônus referente ao mês 07/2026',
};

function base(over: Partial<DadosFolhaFuncionario> = {}): DadosFolhaFuncionario {
  return {
    salarioBase: 2000,
    carteiraAssinada: false,
    recebeAdiantamento: true,
    adiantamentoFixo: 800,
    descontosFixos: 200,
    bonusFixo: 0,
    ...over,
  };
}

describe('formatCompetencia / renderObs', () => {
  it('formata AAAA-MM em MM/AAAA', () => {
    expect(formatCompetencia('2026-07')).toBe('07/2026');
  });
  it('substitui {competencia} no template', () => {
    expect(renderObs('saldo salarial referente ao mês {competencia}', '2026-07')).toBe(
      'saldo salarial referente ao mês 07/2026',
    );
  });
});

describe('competenciaAnterior', () => {
  it('volta um mês', () => {
    expect(competenciaAnterior('2026-08')).toBe('2026-07');
  });

  it('vira o ano em janeiro', () => {
    expect(competenciaAnterior('2026-01')).toBe('2025-12');
  });

  it('devolve como veio quando não é AAAA-MM', () => {
    expect(competenciaAnterior('')).toBe('');
  });
});

describe('calcularAdiantamento', () => {
  it('sem lançamento fixo, usa 40% do salário base', () => {
    expect(calcularAdiantamento(base({ adiantamentoFixo: 0 }))).toBe(800);
  });

  it('respeita outro percentual', () => {
    expect(calcularAdiantamento(base({ adiantamentoFixo: 0 }), 30)).toBe(600);
  });

  it('lançamento fixo cadastrado vence o percentual', () => {
    expect(calcularAdiantamento(base({ adiantamentoFixo: 500 }))).toBe(500);
  });

  it('valor do cadastro vence o lançamento e o percentual', () => {
    expect(
      calcularAdiantamento(base({ valorAdiantamento: 700, adiantamentoFixo: 500 })),
    ).toBe(700);
  });

  it('valor do cadastro zerado cai no percentual', () => {
    expect(
      calcularAdiantamento(base({ valorAdiantamento: 0, adiantamentoFixo: 0 })),
    ).toBe(800);
  });

  it('quem não recebe adiantamento fica em zero', () => {
    expect(
      calcularAdiantamento(base({ recebeAdiantamento: false, adiantamentoFixo: 0 })),
    ).toBe(0);
  });
});

describe('calcularSaldoSalarial', () => {
  it('NÃO carteira assinada: desconta adiantamento do saldo', () => {
    // 2000 - 200 desconto - 800 adiantamento = 1000
    expect(calcularSaldoSalarial(base())).toBe(1000);
  });

  it('carteira assinada (CLT): NÃO desconta adiantamento (contabilidade já fez)', () => {
    // 2000 - 200 desconto = 1800
    expect(calcularSaldoSalarial(base({ carteiraAssinada: true }))).toBe(1800);
  });

  it('sem receber adiantamento: não subtrai mesmo sem carteira', () => {
    expect(
      calcularSaldoSalarial(base({ recebeAdiantamento: false })),
    ).toBe(1800);
  });

  it('sem valor cadastrado: desconta os 40% do dia 25', () => {
    // 2000 - 200 desconto - 800 (40% de 2000) = 1000
    expect(calcularSaldoSalarial(base({ adiantamentoFixo: 0 }))).toBe(1000);
  });

  it('com valor do cadastro: desconta exatamente esse valor', () => {
    // 2000 - 200 desconto - 700 = 1100
    expect(
      calcularSaldoSalarial(base({ adiantamentoFixo: 0, valorAdiantamento: 700 })),
    ).toBe(1100);
  });
});

describe('montarLancamentosFolha', () => {
  it('gera adiantamento (2662) + salário (2420) para não-CLT', () => {
    const l = montarLancamentosFolha(base(), params);
    expect(l).toHaveLength(2);
    const ad = l.find((x) => x.tipo === TipoLancamento.ADIANTAMENTO)!;
    const sal = l.find((x) => x.tipo === TipoLancamento.SALARIO)!;
    expect(ad.valor).toBe(800);
    expect(ad.contaContabil).toBe(2662);
    expect(ad.observacao).toBe('adiantamento');
    expect(sal.valor).toBe(1000);
    expect(sal.contaContabil).toBe(2420);
  });

  it('CLT: gera adiantamento + salário sem dupla dedução', () => {
    const l = montarLancamentosFolha(base({ carteiraAssinada: true }), params);
    expect(l.find((x) => x.tipo === TipoLancamento.SALARIO)!.valor).toBe(1800);
    expect(l.find((x) => x.tipo === TipoLancamento.ADIANTAMENTO)!.valor).toBe(800);
  });

  it('inclui bônus (13916) quando houver', () => {
    const l = montarLancamentosFolha(base({ bonusFixo: 500 }), params);
    const bonus = l.find((x) => x.tipo === TipoLancamento.BONUS)!;
    expect(bonus.valor).toBe(500);
    expect(bonus.contaContabil).toBe(13916);
  });

  it('respeita opções (só adiantamento)', () => {
    const l = montarLancamentosFolha(base(), params, {
      incluirSalario: false,
      incluirBonus: false,
    });
    expect(l).toHaveLength(1);
    expect(l[0].tipo).toBe(TipoLancamento.ADIANTAMENTO);
  });

  it('gera o adiantamento de 40% mesmo sem lançamento cadastrado', () => {
    const l = montarLancamentosFolha(base({ adiantamentoFixo: 0 }), params);
    const ad = l.find((x) => x.tipo === TipoLancamento.ADIANTAMENTO)!;
    const sal = l.find((x) => x.tipo === TipoLancamento.SALARIO)!;
    expect(ad.valor).toBe(800); // 40% de 2000
    expect(sal.valor).toBe(1000); // 2000 - 200 desconto - 800
  });

  it('usa o percentual configurado', () => {
    const l = montarLancamentosFolha(base({ adiantamentoFixo: 0 }), {
      ...params,
      percentualAdiantamento: 50,
    });
    expect(l.find((x) => x.tipo === TipoLancamento.ADIANTAMENTO)!.valor).toBe(
      1000,
    );
  });

  it('não gera itens com valor zero/negativo', () => {
    const l = montarLancamentosFolha(
      base({ salarioBase: 800, descontosFixos: 0, adiantamentoFixo: 900 }),
      params,
    );
    // saldo = 800 - 900 = -100 (não gera salário); adiantamento 900 gera
    expect(l.map((x) => x.tipo)).toEqual([TipoLancamento.ADIANTAMENTO]);
  });
});
