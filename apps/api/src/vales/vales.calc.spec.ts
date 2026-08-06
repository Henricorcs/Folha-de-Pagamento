import { montarParcelas } from './vales.calc';

describe('montarParcelas', () => {
  it('vale avulso: uma parcela na competência escolhida', () => {
    const v = montarParcelas({
      valorParcela: 300,
      quantidadeParcelas: 1,
      competenciaInicio: '2026-08',
    });
    expect(v.valorTotal).toBe(300);
    expect(v.parcelas).toEqual([
      { numero: 1, competencia: '2026-08', valor: 300 },
    ]);
  });

  it('valor da parcela informado manda no total', () => {
    const v = montarParcelas({
      valorParcela: 100,
      quantidadeParcelas: 6,
      competenciaInicio: '2026-08',
    });
    expect(v.valorTotal).toBe(600);
    expect(v.parcelas).toHaveLength(6);
    expect(v.parcelas.every((p) => p.valor === 100)).toBe(true);
  });

  it('só o total: divide em centavos redondos e a última fecha a conta', () => {
    const v = montarParcelas({
      valorTotal: 1000,
      quantidadeParcelas: 3,
      competenciaInicio: '2026-08',
    });
    expect(v.valorParcela).toBe(333.33);
    expect(v.parcelas.map((p) => p.valor)).toEqual([333.33, 333.33, 333.34]);
    expect(v.parcelas.reduce((s, p) => s + p.valor, 0)).toBeCloseTo(1000, 2);
  });

  it('uma parcela por mês, virando o ano', () => {
    const v = montarParcelas({
      valorParcela: 50,
      quantidadeParcelas: 3,
      competenciaInicio: '2026-11',
    });
    expect(v.parcelas.map((p) => p.competencia)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });
});
