/** Conversión y formato de medidas. Internamente todo va en mm y mm² enteros; la interfaz muestra cm, m y m². */

const nf = (max: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: max });

/** Acepta "1,5" o "1.5". Devuelve NaN si no es un número. */
export function parseDecimal(v: string): number {
  const t = v.trim().replace(/\s/g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
}

/** Convierte un texto en cm / m / m² a mm o mm² enteros; null si está vacío o es inválido. */
export const cmToMm = (v: string) => toInt(parseDecimal(v) * 10);
export const mToMm = (v: string) => toInt(parseDecimal(v) * 1000);
export const m2ToMm2 = (v: string) => toInt(parseDecimal(v) * 1_000_000);
function toInt(n: number): number | null {
  return Number.isFinite(n) ? Math.round(n) : null;
}

export const fmtM2 = (mm2: number, digits = 2) => `${nf(digits).format(mm2 / 1_000_000)} m²`;
export const fmtM = (mm: number, digits = 2) => `${nf(digits).format(mm / 1000)} m`;
export const fmtCm = (mm: number) => `${nf(1).format(mm / 10)} cm`;
export const fmtMoney = (pesos: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(pesos);
export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

/** "152 × 80 cm" */
export const fmtDims = (wMm: number, lMm: number) => `${nf(1).format(wMm / 10)} × ${nf(1).format(lMm / 10)} cm`;
