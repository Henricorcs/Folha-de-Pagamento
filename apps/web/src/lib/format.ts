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

/*
 * Aqui vivia o `parseValorBR`, que adivinhava o que a pessoa quis dizer ao
 * escrever "2.107,03", "2107.03" ou "1.234" — e a adivinhação existia porque o
 * campo de dinheiro aceitava texto livre. Com a máscara do `CampoDinheiro` o
 * campo só recebe dígitos, e a vírgula é sempre a mesma: não há mais o que
 * desempatar. Está no histórico, se um dia voltar a fazer falta.
 */

export function formatData(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
