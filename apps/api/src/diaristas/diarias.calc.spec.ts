import {
  calcularTotalDiaria,
  descreverDiarias,
  montarHistoricoCaixa,
  montarObservacaoDiaria,
} from './diarias.calc';

describe('calcularTotalDiaria', () => {
  it('multiplica os dias pelo valor do dia', () => {
    expect(calcularTotalDiaria({ quantidade: 2, valorDiaria: 120 })).toBe(240);
    expect(calcularTotalDiaria({ quantidade: 1, valorDiaria: 150 })).toBe(150);
  });

  it('aceita meio dia', () => {
    expect(calcularTotalDiaria({ quantidade: 2.5, valorDiaria: 100 })).toBe(250);
  });

  it('valor combinado na hora vence a multiplicação', () => {
    expect(
      calcularTotalDiaria({ quantidade: 2.5, valorDiaria: 100, valor: 300 }),
    ).toBe(300);
  });

  it('arredonda para centavos', () => {
    expect(calcularTotalDiaria({ quantidade: 3, valorDiaria: 33.333 })).toBe(100);
  });
});

describe('descreverDiarias', () => {
  it('usa singular e plural', () => {
    expect(descreverDiarias(1, 150)).toBe('1 diária de R$ 150,00');
    expect(descreverDiarias(2, 120)).toBe('2 diárias de R$ 120,00');
  });

  it('mostra fração com vírgula e milhar com ponto', () => {
    expect(descreverDiarias(2.5, 1200)).toBe('2,50 diárias de R$ 1.200,00');
  });
});

describe('montarObservacaoDiaria', () => {
  it('serviço primeiro, conta da diária depois', () => {
    expect(
      montarObservacaoDiaria({
        descricao: 'Pintura do galpão',
        quantidade: 2,
        valorDiaria: 120,
      }),
    ).toBe('Pintura do galpão (2 diárias de R$ 120,00)');
  });
});

describe('montarHistoricoCaixa', () => {
  it('leva o nome de quem recebeu: no caixa é o que sobra para conferir', () => {
    expect(
      montarHistoricoCaixa({
        nome: 'João da Silva',
        descricao: 'Pintura do galpão',
        quantidade: 2,
        valorDiaria: 120,
      }),
    ).toBe('Diária João da Silva — 2 diárias de R$ 120,00 — Pintura do galpão');
  });

  it('sem descrição, ainda diz de quem e de quanto', () => {
    expect(
      montarHistoricoCaixa({
        nome: 'Ana',
        descricao: '  ',
        quantidade: 1,
        valorDiaria: 150,
      }),
    ).toBe('Diária Ana — 1 diária de R$ 150,00');
  });
});
