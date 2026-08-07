import { TipoLancamento } from '@prisma/client';
import {
  baseDaFolha,
  calcularAdiantamento,
  calcularComissao,
  calcularHorasExtras,
  calcularSaldoSalarial,
  competenciaAnterior,
  competenciaSeguinte,
  detalharSalario,
  formatCompetencia,
  formatValorBR,
  montarLancamentosFolha,
  renderObs,
  sufixoObservacaoSalario,
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

describe('competenciaSeguinte', () => {
  it('avança um mês', () => {
    expect(competenciaSeguinte('2026-08')).toBe('2026-09');
  });

  it('vira o ano em dezembro', () => {
    expect(competenciaSeguinte('2026-12')).toBe('2027-01');
  });

  it('devolve como veio quando não é AAAA-MM', () => {
    expect(competenciaSeguinte('x')).toBe('x');
  });
});

describe('formatValorBR', () => {
  it('formata com milhar e centavos', () => {
    expect(formatValorBR(1234.5)).toBe('R$ 1.234,50');
    expect(formatValorBR(50)).toBe('R$ 50,00');
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

describe('a receber na folha (carteira assinada)', () => {
  const comCarteira = (over: Partial<DadosFolhaFuncionario> = {}) =>
    base({ carteiraAssinada: true, valorAReceberFolha: 1200, ...over });

  it('substitui o salário base como base do cálculo', () => {
    expect(baseDaFolha(comCarteira())).toBe(1200);
    // 1200 - 200 desconto (carteira não abate o adiantamento)
    expect(calcularSaldoSalarial(comCarteira())).toBe(1000);
  });

  it('a composição mostra que a base veio do "a receber"', () => {
    const c = detalharSalario(comCarteira());
    expect(c.salarioBase).toBe(1200);
    expect(c.usouValorAReceber).toBe(true);
  });

  it('vazio ou zero: continua valendo o salário base', () => {
    expect(baseDaFolha(comCarteira({ valorAReceberFolha: null }))).toBe(2000);
    expect(baseDaFolha(comCarteira({ valorAReceberFolha: 0 }))).toBe(2000);
    expect(detalharSalario(base()).usouValorAReceber).toBe(false);
  });

  it('sem carteira assinada o campo é ignorado', () => {
    const d = base({ carteiraAssinada: false, valorAReceberFolha: 1200 });
    expect(baseDaFolha(d)).toBe(2000);
    expect(detalharSalario(d).usouValorAReceber).toBe(false);
  });

  it('o adiantamento por percentual também sai da nova base', () => {
    // 40% de 1200, e não de 2000
    expect(
      calcularAdiantamento(comCarteira({ adiantamentoFixo: 0 })),
    ).toBe(480);
  });

  it('proventos e descontos do mês continuam entrando', () => {
    // 1200 + 300 comissão + 150 horas extras (ignoradas: tem carteira)
    //      - 200 desconto - 100 vale = 1200
    expect(
      calcularSaldoSalarial(
        comCarteira({
          vendas: 6,
          valorPorVenda: 50,
          horasExtras: 150,
          descontoVales: 100,
        }),
      ),
    ).toBe(1200);
  });
});

describe('comissão de vendas', () => {
  it('comissão = vendas × valor por venda', () => {
    expect(calcularComissao(base({ vendas: 12, valorPorVenda: 50 }))).toBe(600);
    expect(calcularComissao(base({ vendas: 12, valorPorVenda: 5 }))).toBe(60);
  });

  it('sem vendas ou sem valor por venda, não há comissão', () => {
    expect(calcularComissao(base({ vendas: 0, valorPorVenda: 50 }))).toBe(0);
    expect(calcularComissao(base({ vendas: 10 }))).toBe(0);
  });

  it('entra como provento no saldo salarial', () => {
    // 2000 + 600 comissão - 200 desconto - 800 adiantamento = 1600
    expect(
      calcularSaldoSalarial(base({ vendas: 12, valorPorVenda: 50 })),
    ).toBe(1600);
  });
});

describe('horas extras', () => {
  it('sem carteira assinada: entram no saldo', () => {
    expect(calcularHorasExtras(base({ horasExtras: 320 }))).toBe(320);
    // 2000 + 320 - 200 desconto - 800 adiantamento = 1320
    expect(calcularSaldoSalarial(base({ horasExtras: 320 }))).toBe(1320);
  });

  it('com carteira assinada: ignoradas (a contabilidade paga)', () => {
    const d = base({ horasExtras: 320, carteiraAssinada: true });
    expect(calcularHorasExtras(d)).toBe(0);
    // 2000 - 200 desconto (sem adiantamento, sem horas extras)
    expect(calcularSaldoSalarial(d)).toBe(1800);
  });
});

describe('vales e acertos', () => {
  it('funcionário deve à empresa: sai do saldo salarial', () => {
    // 2000 - 200 desconto - 150 vale - 800 adiantamento = 850
    expect(calcularSaldoSalarial(base({ descontoVales: 150 }))).toBe(850);
  });

  it('empresa deve ao funcionário: entra no saldo salarial', () => {
    // 2000 + 250 acerto - 200 desconto - 800 adiantamento = 1250
    expect(calcularSaldoSalarial(base({ creditoVales: 250 }))).toBe(1250);
  });

  it('os dois sentidos no mesmo mês se compensam', () => {
    // 2000 + 250 - 150 - 200 - 800 = 1100
    expect(
      calcularSaldoSalarial(base({ creditoVales: 250, descontoVales: 150 })),
    ).toBe(1100);
  });
});

describe('detalharSalario', () => {
  it('abre o saldo em proventos e descontos', () => {
    const c = detalharSalario(
      base({
        vendas: 4,
        valorPorVenda: 50,
        horasExtras: 100,
        descontoVales: 150,
      }),
    );
    expect(c).toMatchObject({
      salarioBase: 2000,
      comissao: 200,
      horasExtras: 100,
      descontos: 200,
      vales: 150,
      adiantamento: 800,
      adiantamentoDescontado: 800,
    });
    // 2000 + 200 + 100 - 200 - 150 - 800
    expect(c.saldo).toBe(1150);
  });

  it('carteira assinada: adiantamento apurado, mas não descontado', () => {
    const c = detalharSalario(base({ carteiraAssinada: true }));
    expect(c.adiantamento).toBe(800);
    expect(c.adiantamentoDescontado).toBe(0);
  });
});

describe('sufixoObservacaoSalario', () => {
  it('detalha horas extras, comissão e vale', () => {
    expect(
      sufixoObservacaoSalario(
        base({
          horasExtras: 500,
          vendas: 12,
          valorPorVenda: 50,
          descontoVales: 100,
        }),
      ),
    ).toBe(
      ' (HORAS EXTRAS: R$ 500,00 · COMISSÃO: 12 x R$ 50,00 = R$ 600,00 · VALE: -R$ 100,00)',
    );
  });

  it('mostra o que a empresa está pagando a mais', () => {
    expect(sufixoObservacaoSalario(base({ creditoVales: 250 }))).toBe(
      ' (REEMBOLSO: +R$ 250,00)',
    );
  });

  it('sem nada disso, não muda a observação', () => {
    expect(sufixoObservacaoSalario(base())).toBe('');
  });

  it('carteira assinada não mostra horas extras', () => {
    expect(
      sufixoObservacaoSalario(base({ horasExtras: 500, carteiraAssinada: true })),
    ).toBe('');
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

  it('salário sai com a observação detalhando horas extras e comissão', () => {
    const l = montarLancamentosFolha(
      base({ horasExtras: 500, vendas: 12, valorPorVenda: 50 }),
      params,
    );
    const sal = l.find((x) => x.tipo === TipoLancamento.SALARIO)!;
    // 2000 + 500 + 600 - 200 - 800
    expect(sal.valor).toBe(2100);
    expect(sal.observacao).toBe(
      'saldo salarial referente ao mês 07/2026' +
        ' (HORAS EXTRAS: R$ 500,00 · COMISSÃO: 12 x R$ 50,00 = R$ 600,00)',
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
