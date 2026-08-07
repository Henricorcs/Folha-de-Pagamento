const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Formata número/decimal (inclui strings vindas do Prisma) como moeda. */
export function formatBRL(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return brl.format(Number.isFinite(n) ? n : 0);
}

const numeroBR = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Número com vírgula decimal e ponto de milhar, sem o "R$": "2.107,03". */
export function formatNumeroBR(valor: number): string {
  return numeroBR.format(valor);
}

/**
 * Lê um valor em dinheiro do jeito que gente de verdade digita e cola:
 * "2.107,03", "2107,03", "R$ 1.234,56" ou "2107.03". Devolve null quando não
 * há número ali (campo vazio, texto solto).
 *
 * O caso ambíguo é o ponto sozinho. "2107.03" é decimal — é assim que a API
 * devolve —, mas "1.234" é milhar, que é como o IXC e a planilha escrevem. O
 * desempate são as três casas depois do ponto.
 */
export function parseValorBR(
  texto: string | number | null | undefined,
): number | null {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;

  const limpo = String(texto ?? '')
    .replace(/[R$\s ]/gi, '')
    .trim();
  if (!limpo || !/\d/.test(limpo)) return null;

  const virgula = limpo.lastIndexOf(',');
  const ponto = limpo.lastIndexOf('.');

  let normalizado: string;
  if (virgula >= 0 && ponto >= 0) {
    // Os dois aparecem: o último manda no decimal, o outro é milhar.
    normalizado =
      virgula > ponto
        ? limpo.replace(/\./g, '').replace(',', '.')
        : limpo.replace(/,/g, '');
  } else if (virgula >= 0) {
    normalizado = limpo.replace(/,/g, '.');
  } else if (ponto >= 0 && pontoEhMilhar(limpo)) {
    normalizado = limpo.replace(/\./g, '');
  } else {
    normalizado = limpo;
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Ponto que separa milhar, não decimal: mais de um, ou seguido de 3 casas. */
function pontoEhMilhar(texto: string): boolean {
  if (texto.split('.').length - 1 > 1) return true;
  return /^\d{1,3}\.\d{3}$/.test(texto.replace(/^[+-]/, ''));
}

export function formatData(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
