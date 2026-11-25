/**
 * Dinero en pesos enteros (COP). Cantidades en milésimas (1500 = 1,5). IVA en centésimas de %: 1900 = 19 %.
 * Toda división redondea "mitad hacia arriba" con BigInt, para que los totales no dependan de errores de coma flotante.
 */

/** round(a × b / c) con a, b, c ≥ 0. */
export function mulDivRound(a: number, b: number, c: number): number {
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  return Number((num * 2n + den) / (den * 2n));
}

export interface LineInput {
  quantityMilli: number;
  unitPrice: number;
  discount: number;
  taxRateBp: number;
}

export interface LineAmounts {
  /** Cantidad × precio, antes del descuento. */
  gross: number;
  /** Sin IVA, ya con el descuento. */
  lineTotal: number;
  taxAmount: number;
}

export function computeLine(l: LineInput): LineAmounts {
  const gross = mulDivRound(l.quantityMilli, l.unitPrice, 1000);
  const lineTotal = gross - l.discount;
  return { gross, lineTotal, taxAmount: mulDivRound(lineTotal, l.taxRateBp, 10_000) };
}

export interface Totals {
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
}

/** El IVA se calcula por línea (sobre la base ya descontada) y se suma: así lo exige la factura electrónica. */
export function computeTotals(lines: (LineInput & LineAmounts)[]): Totals {
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  const discount = lines.reduce((a, l) => a + l.discount, 0);
  const taxTotal = lines.reduce((a, l) => a + l.taxAmount, 0);
  return { subtotal, discount, taxTotal, total: subtotal + taxTotal };
}
