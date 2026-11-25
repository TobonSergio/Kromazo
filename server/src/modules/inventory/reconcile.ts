/**
 * Conciliación de cortes a pulso en un conteo físico (docs/ARQUITECTURA.md §1.1). Funciones puras.
 */

/**
 * Reparte `total` (con signo) en proporción a `weights` (≥ 0) usando el método del resto mayor:
 * la suma del resultado es EXACTAMENTE `total` (no se pierde ni se inventa un mm² al redondear).
 * Usa BigInt porque total × peso puede superar 2^53 con rollos grandes.
 */
export function distributeProportionally(total: number, weights: number[]): number[] {
  const W = weights.reduce((a, b) => a + b, 0);
  if (W === 0 || total === 0) return weights.map(() => 0);
  const sign = total < 0 ? -1n : 1n;
  const T = BigInt(Math.abs(total));
  const bigW = BigInt(W);

  const parts = weights.map((w, i) => {
    const raw = T * BigInt(w);
    return { i, base: raw / bigW, rem: raw % bigW };
  });
  let left = T - parts.reduce((a, p) => a + p.base, 0n);
  // Los mm² que sobran del redondeo van a los de mayor resto (empate: el primero).
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const p of order) {
    if (left === 0n) break;
    p.base += 1n;
    left -= 1n;
  }
  return parts.map((p) => Number(p.base * sign));
}

export interface ReconcileResult {
  /** Parte de la diferencia atribuida a los cortes a pulso (con signo, mismo signo que la diferencia). */
  freehandAdjust: number;
  /** Resto: faltante (−) o sobrante (+) no explicado. */
  unexplained: number;
  /** Área real atribuida a cada corte, en el mismo orden de `estimates`. */
  reconciledAreas: number[];
}

/**
 * @param diff        área medida − saldo del sistema (negativa = falta material).
 * @param estimates   área estimada de cada corte a pulso pendiente.
 * @param tolerancePct límite (0–100) de lo que se puede atribuir a las estimaciones.
 *
 * Si falta material (diff < 0), los cortes gastaron MÁS de lo estimado: su área real crece.
 * Por eso Σ(reconciled − estimado) = −freehandAdjust.
 */
export function reconcile(diff: number, estimates: number[], tolerancePct: number): ReconcileResult {
  const E = estimates.reduce((a, b) => a + b, 0);
  const limit = Math.floor((E * tolerancePct) / 100);
  const freehandAdjust = E === 0 ? 0 : Math.max(-limit, Math.min(limit, diff));
  const shares = distributeProportionally(freehandAdjust, estimates);
  return {
    freehandAdjust,
    unexplained: diff - freehandAdjust,
    reconciledAreas: estimates.map((est, i) => est - shares[i]!),
  };
}
