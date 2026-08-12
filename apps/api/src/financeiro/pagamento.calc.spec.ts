import {
  calcularComissaoVendas,
  calcularServico,
  calcularTotalPagamento,
  descreverDiarias,
  montarHistoricoCaixa,
  montarObservacaoPagamento,
} from './pagamento.calc';

/**
 * Diarista e beneficiário avulso recebem as três partes num pagamento só. O que
 * este arquivo protege: a soma, e o texto que explica o pagamento nos dois
 * lugares onde ele aparece fora daqui — a observação da conta a pagar no IXC e
 * o histórico da saída no caixa. Quem confere o dinheiro lê esses dois.
 */

describe('calcularTotalPagamento', () => {
  it('multiplica os dias pelo valor do dia', () => {
    expect(calcularTotalPagamento({ quantidade: 2, valorDiaria: 120 })).toBe(240);
    expect(calcularTotalPagamento({ quantidade: 1, valorDiaria: 150 })).toBe(150);
  });

  it('aceita meio dia', () => {
    expect(calcularTotalPagamento({ quantidade: 2.5, valorDiaria: 100 })).toBe(
      250,
    );
  });

  it('soma serviço, comissão de venda e o extra do trabalho por fora', () => {
    expect(
      calcularTotalPagamento({
        quantidade: 2,
        valorDiaria: 140,
        vendas: 3,
        valorPorVenda: 50,
        valorExtra: 80,
      }),
    ).toBe(510);
  });

  /** É assim que o beneficiário avulso entra: serviço pontual, sem dias. */
  it('o serviço pontual soma junto das vendas', () => {
    expect(
      calcularTotalPagamento({
        valorServico: 400,
        vendas: 2,
        valorPorVenda: 50,
      }),
    ).toBe(500);
  });

  it('paga só as vendas quando não houve serviço', () => {
    expect(
      calcularTotalPagamento({ quantidade: 0, vendas: 4, valorPorVenda: 50 }),
    ).toBe(200);
  });

  it('arredonda para centavos', () => {
    expect(calcularTotalPagamento({ quantidade: 3, valorDiaria: 33.333 })).toBe(
      100,
    );
  });
});

describe('calcularComissaoVendas', () => {
  it('sem vendas ou sem valor combinado, não há comissão', () => {
    expect(calcularComissaoVendas({ vendas: 0, valorPorVenda: 50 })).toBe(0);
    expect(calcularComissaoVendas({ vendas: 3 })).toBe(0);
  });
});

describe('calcularServico', () => {
  it('não conta a comissão nem o extra', () => {
    expect(
      calcularServico({
        quantidade: 2,
        valorDiaria: 140,
        vendas: 3,
        valorPorVenda: 50,
        valorExtra: 80,
      }),
    ).toBe(280);
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

describe('montarObservacaoPagamento', () => {
  it('serviço primeiro, conta da diária depois', () => {
    expect(
      montarObservacaoPagamento({
        descricao: 'Pintura do galpão',
        quantidade: 2,
        valorDiaria: 120,
      }),
    ).toBe('Pintura do galpão (2 diárias de R$ 120,00)');
  });

  it('abre as três partes na ordem em que se confere', () => {
    expect(
      montarObservacaoPagamento({
        descricao: 'Acerto da semana',
        quantidade: 2,
        valorDiaria: 140,
        vendas: 3,
        valorPorVenda: 50,
        valorExtra: 80,
        descricaoExtra: 'instalação',
      }),
    ).toBe(
      'Acerto da semana (2 diárias de R$ 140,00 · 3 vendas de R$ 50,00 = ' +
        'R$ 150,00 · extra R$ 80,00: instalação)',
    );
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

  /** Pagamento sem dia trabalhado não é diária, e chamar de diária confunde. */
  it('pagamento só de vendas não se chama diária no caixa', () => {
    expect(
      montarHistoricoCaixa({
        nome: 'Ana',
        descricao: 'Comissão de agosto',
        vendas: 4,
        valorPorVenda: 50,
      }),
    ).toBe(
      'Pagamento Ana — 4 vendas de R$ 50,00 = R$ 200,00 — Comissão de agosto',
    );
  });
});
