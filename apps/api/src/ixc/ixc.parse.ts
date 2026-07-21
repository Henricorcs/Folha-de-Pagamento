/**
 * Utilitários de conversão dos valores crus do IXC (sempre strings) para
 * tipos do domínio. Tolerantes a formatos vazios/zerados e a pt-BR.
 */

/**
 * Converte string monetária do IXC em número.
 * Aceita "1412.00", "1.412,00", "1412,50", "", null, undefined.
 * Retorna 0 quando não há valor válido.
 */
export function parseIxcDecimal(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let s = String(value).trim();
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Formato pt-BR "1.412,00" -> remove pontos de milhar, vírgula vira ponto
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Só vírgula -> vírgula decimal
    s = s.replace(',', '.');
  }
  // Só ponto (ou nenhum) -> já está no formato correto

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Converte datas do IXC em Date (UTC, meia-noite) ou null.
 * Aceita "YYYY-MM-DD", "DD/MM/YYYY" e ignora "0000-00-00"/vazio.
 */
export function parseIxcDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s.startsWith('0000')) return null;

  // ISO: 2024-06-21 (com ou sem hora)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    return safeDate(+y, +m, +d);
  }

  // pt-BR: 21/06/2024
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) {
    const [, d, m, y] = br;
    return safeDate(+y, +m, +d);
  }

  return null;
}

function safeDate(year: number, month: number, day: number): Date | null {
  if (!year || !month || !day) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "S" -> true, qualquer outra coisa -> false. */
export function parseIxcBool(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === 'S';
}

/** Converte string de id do IXC em number, ou null se vazio/zero. */
export function parseIxcId(value: unknown): number | null {
  const n = Number(String(value ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}
