import {
  parseIxcBool,
  parseIxcDate,
  parseIxcDecimal,
  parseIxcId,
} from './ixc.parse';

describe('parseIxcDecimal', () => {
  it.each([
    ['1412.00', 1412],
    ['1.412,00', 1412],
    ['1412,50', 1412.5],
    ['9000', 9000],
    ['847.2', 847.2],
    ['', 0],
    [null, 0],
    [undefined, 0],
    ['abc', 0],
    [2118, 2118],
  ])('%s -> %s', (input, expected) => {
    expect(parseIxcDecimal(input)).toBeCloseTo(expected as number, 2);
  });
});

describe('parseIxcDate', () => {
  it('lê ISO YYYY-MM-DD', () => {
    expect(parseIxcDate('2024-06-21')?.toISOString()).toBe(
      '2024-06-21T00:00:00.000Z',
    );
  });
  it('lê pt-BR DD/MM/YYYY', () => {
    expect(parseIxcDate('21/06/2024')?.toISOString()).toBe(
      '2024-06-21T00:00:00.000Z',
    );
  });
  it('ignora 0000-00-00 e vazio', () => {
    expect(parseIxcDate('0000-00-00')).toBeNull();
    expect(parseIxcDate('')).toBeNull();
    expect(parseIxcDate(null)).toBeNull();
  });
});

describe('parseIxcBool', () => {
  it('S -> true; resto -> false', () => {
    expect(parseIxcBool('S')).toBe(true);
    expect(parseIxcBool('s')).toBe(true);
    expect(parseIxcBool('N')).toBe(false);
    expect(parseIxcBool('')).toBe(false);
    expect(parseIxcBool(null)).toBe(false);
  });
});

describe('parseIxcId', () => {
  it('converte ids válidos e rejeita zero/vazio', () => {
    expect(parseIxcId('41')).toBe(41);
    expect(parseIxcId('0')).toBeNull();
    expect(parseIxcId('')).toBeNull();
    expect(parseIxcId('abc')).toBeNull();
  });
});
