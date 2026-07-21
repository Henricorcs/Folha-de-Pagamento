import { TipoLancamento } from '@prisma/client';
import {
  calcularSaldoSalarial,
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

  it('não gera itens com valor zero/negativo', () => {
    const l = montarLancamentosFolha(
      base({ salarioBase: 800, descontosFixos: 0, adiantamentoFixo: 900 }),
      params,
    );
    // saldo = 800 - 900 = -100 (não gera salário); adiantamento 900 gera
    expect(l.map((x) => x.tipo)).toEqual([TipoLancamento.ADIANTAMENTO]);
  });
});
