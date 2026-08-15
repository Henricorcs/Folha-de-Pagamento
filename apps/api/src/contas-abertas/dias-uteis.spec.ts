import { domingoDePascoa, ehDiaUtil, proximoDiaUtil } from './dias-uteis';

/**
 * Boleto que vence em dia sem banco só é liquidado depois. O que este arquivo
 * protege:
 *
 *  - fim de semana e feriado nacional empurram o vencimento para frente;
 *  - os feriados móveis saem do cálculo da Páscoa e não de uma tabela que
 *    alguém teria de atualizar todo dezembro;
 *  - o Carnaval e o Corpus Christi contam, porque banco não abre neles;
 *  - o ajuste nunca antecipa — adiar é o que o banco faz de qualquer jeito.
 */

const dia = (ano: number, mes: number, d: number) =>
  new Date(Date.UTC(ano, mes - 1, d));

describe('domingoDePascoa', () => {
  // Conferidos com o calendário: são as datas oficiais desses anos.
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
  ])('Páscoa de %i', (ano, esperado) => {
    expect(domingoDePascoa(ano).toISOString().slice(0, 10)).toBe(esperado);
  });
});

describe('ehDiaUtil', () => {
  it('sábado e domingo não são', () => {
    expect(ehDiaUtil(dia(2026, 8, 15))).toBe(false); // sábado
    expect(ehDiaUtil(dia(2026, 8, 16))).toBe(false); // domingo
    expect(ehDiaUtil(dia(2026, 8, 17))).toBe(true); // segunda
  });

  it('feriados de data fixa não são', () => {
    expect(ehDiaUtil(dia(2026, 1, 1))).toBe(false); // Confraternização
    expect(ehDiaUtil(dia(2026, 4, 21))).toBe(false); // Tiradentes
    expect(ehDiaUtil(dia(2026, 9, 7))).toBe(false); // Independência
    expect(ehDiaUtil(dia(2026, 12, 25))).toBe(false); // Natal
  });

  it('Consciência Negra conta — é feriado nacional desde 2024', () => {
    expect(ehDiaUtil(dia(2026, 11, 20))).toBe(false);
  });

  it('Carnaval e Corpus Christi contam: banco não abre', () => {
    // Páscoa 2026 = 05/04. Carnaval 16 e 17/02, Sexta-feira Santa 03/04,
    // Corpus Christi 04/06.
    expect(ehDiaUtil(dia(2026, 2, 16))).toBe(false);
    expect(ehDiaUtil(dia(2026, 2, 17))).toBe(false);
    expect(ehDiaUtil(dia(2026, 4, 3))).toBe(false);
    expect(ehDiaUtil(dia(2026, 6, 4))).toBe(false);
  });

  it('dia comum é dia útil', () => {
    expect(ehDiaUtil(dia(2026, 8, 20))).toBe(true); // quinta
  });
});

describe('proximoDiaUtil', () => {
  it('dia útil não se mexe', () => {
    expect(proximoDiaUtil(dia(2026, 8, 20))).toEqual(dia(2026, 8, 20));
  });

  it('sábado vai para segunda', () => {
    expect(proximoDiaUtil(dia(2026, 8, 15))).toEqual(dia(2026, 8, 17));
  });

  it('domingo vai para segunda', () => {
    expect(proximoDiaUtil(dia(2026, 8, 16))).toEqual(dia(2026, 8, 17));
  });

  it('atravessa a emenda: sexta-feira santa cai numa sexta, então vai para segunda', () => {
    // 03/04/2026 é Sexta-feira Santa; 4 e 5 são fim de semana.
    expect(proximoDiaUtil(dia(2026, 4, 3))).toEqual(dia(2026, 4, 6));
  });

  it('vira o mês quando precisa', () => {
    // 31/05/2026 é domingo — o próximo útil é 1º de junho.
    expect(proximoDiaUtil(dia(2026, 5, 31))).toEqual(dia(2026, 6, 1));
  });

  it('vira o ano: 01/01 é feriado e 2027 começa numa sexta', () => {
    expect(proximoDiaUtil(dia(2027, 1, 1))).toEqual(dia(2027, 1, 4));
  });

  it('nunca antecipa', () => {
    const ajustado = proximoDiaUtil(dia(2026, 12, 25));
    expect(ajustado.getTime()).toBeGreaterThan(dia(2026, 12, 25).getTime());
  });
});
