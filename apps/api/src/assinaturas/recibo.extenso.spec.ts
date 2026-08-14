import { valorPorExtenso } from './recibo.extenso';

/**
 * O extenso é o que trava o valor no papel depois de assinado. Um erro aqui
 * sai impresso num recibo de quitação, então cada degrau da regra tem um caso.
 */
describe('valorPorExtenso', () => {
  it('escreve os valores de uma diária comum', () => {
    expect(valorPorExtenso(120)).toBe('cento e vinte reais');
    expect(valorPorExtenso(150)).toBe('cento e cinquenta reais');
    expect(valorPorExtenso(80)).toBe('oitenta reais');
  });

  it('usa "cem" só no valor redondo', () => {
    expect(valorPorExtenso(100)).toBe('cem reais');
    expect(valorPorExtenso(101)).toBe('cento e um reais');
  });

  it('não diz "um mil"', () => {
    expect(valorPorExtenso(1000)).toBe('mil reais');
    expect(valorPorExtenso(1200)).toBe('mil e duzentos reais');
    expect(valorPorExtenso(2500)).toBe('dois mil e quinhentos reais');
  });

  it('põe o singular no real e no centavo sozinhos', () => {
    expect(valorPorExtenso(1)).toBe('um real');
    expect(valorPorExtenso(0.01)).toBe('um centavo');
  });

  it('junta reais e centavos', () => {
    expect(valorPorExtenso(120.5)).toBe('cento e vinte reais e cinquenta centavos');
    expect(valorPorExtenso(1234.56)).toBe(
      'mil, duzentos e trinta e quatro reais e cinquenta e seis centavos',
    );
  });

  /**
   * `0.29 * 100` dá 28,999… em ponto flutuante. Sem arredondar antes de
   * separar, o recibo sairia com um centavo a menos que o pagamento.
   */
  it('não perde centavo por causa do ponto flutuante', () => {
    expect(valorPorExtenso(0.29)).toBe('vinte e nove centavos');
    expect(valorPorExtenso(1.07)).toBe('um real e sete centavos');
    expect(valorPorExtenso(70.29)).toBe('setenta reais e vinte e nove centavos');
  });

  it('escreve as dezenas quebradas por inteiro', () => {
    expect(valorPorExtenso(16)).toBe('dezesseis reais');
    expect(valorPorExtenso(47)).toBe('quarenta e sete reais');
    expect(valorPorExtenso(999)).toBe('novecentos e noventa e nove reais');
  });

  it('aguenta valor zerado sem quebrar', () => {
    expect(valorPorExtenso(0)).toBe('zero reais');
  });
});
