import type { Db } from '../../db/client.js';
import { getSettings } from '../../lib/settings.js';
import { mulDivRound } from '../../lib/money.js';
import { materialLabel } from '../materials/service.js';

/**
 * Reportes (ARQUITECTURA §4, «Métricas que salen de este modelo»). Solo admin.
 * Consultas agregadas en SQL con parámetros enlazados (nunca concatenados).
 * Rango de fechas: días calendario de Colombia (UTC−5), ambos inclusive.
 */

export interface Range {
  from: string; // AAAA-MM-DD
  to: string; // AAAA-MM-DD
}

/** Convierte el rango de Colombia a límites UTC [desde, hasta) comparables con created_at. */
export function utcBounds(r: Range) {
  const start = new Date(`${r.from}T05:00:00.000Z`).toISOString();
  const end = new Date(Date.parse(`${r.to}T05:00:00.000Z`) + 86_400_000).toISOString();
  return { start, end };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 10_000) / whole) / 100 : null);
const m2cost = (mm2: number, costPerM2: number | null) => (costPerM2 === null ? null : mulDivRound(Math.abs(mm2), costPerM2, 1_000_000) * Math.sign(mm2));

/** Área realmente consumida por un corte: la conciliada si existe, menos los retazos que vuelven al stock. */
const CONSUMED = `max(coalesce(c.reconciled_area_mm2, c.cut_area_mm2) - c.remnant_area_mm2, 0)`;

interface MaterialRow {
  id: number;
  sku: string;
  brand: string;
  line: string | null;
  color: string;
  finish: string;
  cost_per_m2: number | null;
  min_stock_mm2: number;
}
const label = (m: MaterialRow) => materialLabel({ brand: m.brand, line: m.line, color: m.color, finish: m.finish as never });

// ───────────────────────── Stock, consumo y días restantes ─────────────────────────

export function stockReport(db: Db, days: number, nowMs = Date.now()) {
  const since = new Date(nowMs - days * 86_400_000).toISOString();
  const alertDays = getSettings(db).stockAlertDays;
  const rows = db.$client
    .prepare(
      `SELECT m.id, m.sku, m.brand, m.line, m.color, m.finish, m.cost_per_m2, m.min_stock_mm2,
         (SELECT coalesce(sum(u.balance_mm2), 0) FROM inventory_units u WHERE u.material_id = m.id AND u.status = 'ACTIVE') AS stock,
         (SELECT coalesce(sum(${CONSUMED}), 0) FROM cuts c JOIN inventory_units u ON u.id = c.unit_id
            WHERE u.material_id = m.id AND c.created_at >= @since) AS consumed
       FROM materials m WHERE m.is_active = 1 ORDER BY m.brand, m.color`,
    )
    .all({ since }) as (MaterialRow & { stock: number; consumed: number })[];

  return rows.map((r) => {
    const avgDaily = Math.round(r.consumed / days);
    const daysLeft = avgDaily > 0 ? Math.floor(r.stock / avgDaily) : null;
    const lowStock = r.min_stock_mm2 > 0 && r.stock < r.min_stock_mm2;
    return {
      materialId: r.id,
      sku: r.sku,
      label: label(r),
      stockMm2: r.stock,
      minStockMm2: r.min_stock_mm2,
      consumedMm2: r.consumed,
      avgDailyMm2: avgDaily,
      daysLeft,
      costPerM2: r.cost_per_m2,
      stockValue: m2cost(r.stock, r.cost_per_m2),
      lowStock,
      /** Hay que comprar: stock bajo el mínimo, o se acaba en menos de `stockAlertDays` días al ritmo actual. */
      alert: lowStock || (daysLeft !== null && daysLeft < alertDays),
    };
  });
}

// ───────────────────────── Desperdicio (solo cortes medidos) ─────────────────────────

export function wasteReport(db: Db, range: Range) {
  const { start, end } = utcBounds(range);
  const q = (groupBy: 'material' | 'user') =>
    db.$client
      .prepare(
        `SELECT ${groupBy === 'material' ? "m.id AS id, m.sku, m.brand, m.line, m.color, m.finish" : 'us.id AS id, us.full_name AS name'},
           count(*) AS cuts, sum(c.cut_area_mm2) AS cut_area, sum(c.waste_area_mm2) AS waste
         FROM cuts c
         JOIN inventory_units u ON u.id = c.unit_id
         JOIN materials m ON m.id = u.material_id
         JOIN users us ON us.id = c.user_id
         WHERE c.method = 'MEASURED' AND c.created_at >= @start AND c.created_at < @end
         GROUP BY ${groupBy === 'material' ? 'm.id' : 'us.id'}
         ORDER BY waste DESC`,
      )
      .all({ start, end }) as Record<string, unknown>[];
  const shape = (r: Record<string, unknown>, name: string) => ({
    id: r.id as number,
    name,
    cuts: r.cuts as number,
    cutAreaMm2: r.cut_area as number,
    wasteMm2: r.waste as number,
    wastePct: pct(r.waste as number, r.cut_area as number),
  });
  const byMaterial = q('material').map((r) => shape(r, label(r as unknown as MaterialRow)));
  const byUser = q('user').map((r) => shape(r, r.name as string));
  const totalCut = byMaterial.reduce((a, r) => a + r.cutAreaMm2, 0);
  const totalWaste = byMaterial.reduce((a, r) => a + r.wasteMm2, 0);
  return { totalCutMm2: totalCut, totalWasteMm2: totalWaste, wastePct: pct(totalWaste, totalCut), byMaterial, byUser };
}

// ───────────────────────── Faltante no registrado (conteos) ─────────────────────────

export function shortageReport(db: Db, range: Range) {
  const { start, end } = utcBounds(range);
  const byMaterial = (
    db.$client
      .prepare(
        `SELECT m.id, m.sku, m.brand, m.line, m.color, m.finish, m.cost_per_m2, m.min_stock_mm2,
           count(*) AS counts,
           sum(CASE WHEN p.unexplained_mm2 < 0 THEN -p.unexplained_mm2 ELSE 0 END) AS missing,
           sum(CASE WHEN p.unexplained_mm2 > 0 THEN p.unexplained_mm2 ELSE 0 END) AS surplus,
           sum(p.freehand_adjust_mm2) AS freehand_adjust
         FROM physical_counts p
         JOIN inventory_units u ON u.id = p.unit_id
         JOIN materials m ON m.id = u.material_id
         WHERE p.created_at >= @start AND p.created_at < @end
         GROUP BY m.id ORDER BY missing DESC`,
      )
      .all({ start, end }) as (MaterialRow & { counts: number; missing: number; surplus: number; freehand_adjust: number })[]
  ).map((r) => ({
    materialId: r.id,
    label: label(r),
    counts: r.counts,
    missingMm2: r.missing,
    surplusMm2: r.surplus,
    freehandAdjustMm2: r.freehand_adjust,
    missingValue: m2cost(r.missing, r.cost_per_m2),
  }));

  const counts = db.$client
    .prepare(
      `SELECT p.id, p.created_at, p.method, p.system_area_mm2, p.computed_area_mm2, p.freehand_adjust_mm2, p.unexplained_mm2,
         u.id AS unit_id, u.code, us.full_name AS user_name
       FROM physical_counts p
       JOIN inventory_units u ON u.id = p.unit_id
       JOIN users us ON us.id = p.user_id
       WHERE p.created_at >= @start AND p.created_at < @end AND p.unexplained_mm2 <> 0
       ORDER BY p.unexplained_mm2 ASC LIMIT 100`,
    )
    .all({ start, end }) as Record<string, unknown>[];

  return {
    totalMissingMm2: byMaterial.reduce((a, r) => a + r.missingMm2, 0),
    totalMissingValue: byMaterial.reduce((a, r) => a + (r.missingValue ?? 0), 0),
    byMaterial,
    counts: counts.map((c) => ({
      id: c.id as number,
      createdAt: c.created_at as string,
      unitId: c.unit_id as number,
      unitCode: c.code as string,
      systemAreaMm2: c.system_area_mm2 as number,
      computedAreaMm2: c.computed_area_mm2 as number,
      freehandAdjustMm2: c.freehand_adjust_mm2 as number,
      unexplainedMm2: c.unexplained_mm2 as number,
      userName: c.user_name as string,
    })),
  };
}

// ───────────────────────── Cortes a pulso y precisión de las tallas ─────────────────────────

export function freehandReport(db: Db, range: Range) {
  const { start, end } = utcBounds(range);
  const byUser = (
    db.$client
      .prepare(
        `SELECT us.id, us.full_name AS name, count(*) AS cuts,
           sum(CASE WHEN c.method = 'FREEHAND' THEN 1 ELSE 0 END) AS freehand_cuts,
           sum(c.cut_area_mm2) AS area,
           sum(CASE WHEN c.method = 'FREEHAND' THEN c.cut_area_mm2 ELSE 0 END) AS freehand_area
         FROM cuts c JOIN users us ON us.id = c.user_id
         WHERE c.created_at >= @start AND c.created_at < @end
         GROUP BY us.id ORDER BY cuts DESC`,
      )
      .all({ start, end }) as { id: number; name: string; cuts: number; freehand_cuts: number; area: number; freehand_area: number }[]
  ).map((r) => ({
    userId: r.id,
    name: r.name,
    cuts: r.cuts,
    freehandCuts: r.freehand_cuts,
    freehandCutsPct: pct(r.freehand_cuts, r.cuts),
    freehandAreaPct: pct(r.freehand_area, r.area),
  }));

  // Precisión: solo cortes ya conciliados (sin importar la fecha del conteo, para tener más datos).
  const sizes = (
    db.$client
      .prepare(
        `SELECT s.id, s.name, s.ref_area_mm2, count(c.id) AS reconciled,
           coalesce(sum(c.cut_area_mm2), 0) AS estimated, coalesce(sum(c.reconciled_area_mm2), 0) AS real
         FROM freehand_sizes s
         LEFT JOIN cuts c ON c.freehand_size_id = s.id AND c.reconciled_count_id IS NOT NULL
           AND c.created_at >= @start AND c.created_at < @end
         GROUP BY s.id ORDER BY s.sort_order`,
      )
      .all({ start, end }) as { id: number; name: string; ref_area_mm2: number; reconciled: number; estimated: number; real: number }[]
  ).map((s) => ({
    sizeId: s.id,
    name: s.name,
    refAreaMm2: s.ref_area_mm2,
    reconciledCuts: s.reconciled,
    /** 130 = los cortes gastan en promedio 30 % más de lo estimado. */
    realVsEstimatedPct: pct(s.real, s.estimated),
    /** Área de referencia sugerida según lo observado (solo con 5 o más cortes conciliados). */
    suggestedRefAreaMm2: s.reconciled >= 5 && s.estimated > 0 ? Math.round((s.ref_area_mm2 * s.real) / s.estimated) : null,
  }));

  return { byUser, sizes };
}

// ───────────────────────── Ventas, cartera y margen ─────────────────────────

/** Pedidos aprobados en el rango (fecha de aprobación) y que no se cancelaron después. */
const APPROVED_IN_RANGE = `
  SELECT o.* FROM orders o
  WHERE o.status NOT IN ('COTIZADO', 'CANCELADO')
    AND (SELECT min(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'APROBADO') >= @start
    AND (SELECT min(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'APROBADO') < @end`;

export function salesReport(db: Db, range: Range) {
  const { start, end } = utcBounds(range);
  const byCustomer = (
    db.$client
      .prepare(
        `SELECT cu.id, cu.full_name AS name, count(*) AS orders, sum(o.subtotal) AS subtotal, sum(o.tax_total) AS tax, sum(o.total) AS total
         FROM (${APPROVED_IN_RANGE}) o JOIN customers cu ON cu.id = o.customer_id
         GROUP BY cu.id ORDER BY total DESC`,
      )
      .all({ start, end }) as { id: number; name: string; orders: number; subtotal: number; tax: number; total: number }[]
  ).map((r) => ({ customerId: r.id, name: r.name, orders: r.orders, subtotal: r.subtotal, tax: r.tax, total: r.total }));

  const payments = db.$client
    .prepare(
      `SELECT method, count(*) AS n, sum(amount) AS total FROM payments
       WHERE created_at >= @start AND created_at < @end GROUP BY method ORDER BY total DESC`,
    )
    .all({ start, end }) as { method: string; n: number; total: number }[];

  // Cartera: saldo pendiente de pedidos aprobados (sin importar la fecha).
  const receivables = (
    db.$client
      .prepare(
        `SELECT o.id, o.code, o.status, cu.full_name AS name, o.total,
           o.total - coalesce((SELECT sum(p.amount) FROM payments p WHERE p.order_id = o.id), 0) AS balance
         FROM orders o JOIN customers cu ON cu.id = o.customer_id
         WHERE o.status NOT IN ('COTIZADO', 'CANCELADO') AND balance > 0
         ORDER BY o.status = 'ENTREGADO' DESC, balance DESC`,
      )
      .all() as { id: number; code: string; status: string; name: string; total: number; balance: number }[]
  ).map((r) => ({ orderId: r.id, code: r.code, status: r.status, customerName: r.name, total: r.total, balance: r.balance }));

  return {
    orders: byCustomer.reduce((a, r) => a + r.orders, 0),
    subtotal: byCustomer.reduce((a, r) => a + r.subtotal, 0),
    tax: byCustomer.reduce((a, r) => a + r.tax, 0),
    total: byCustomer.reduce((a, r) => a + r.total, 0),
    byCustomer,
    payments: payments.map((p) => ({ method: p.method, count: p.n, total: p.total })),
    paymentsTotal: payments.reduce((a, p) => a + p.total, 0),
    receivables,
    receivablesTotal: receivables.reduce((a, r) => a + r.balance, 0),
  };
}

export function marginReport(db: Db, range: Range) {
  const { start, end } = utcBounds(range);
  const rows = db.$client
    .prepare(
      `SELECT o.id, o.code, o.status, o.subtotal, cu.full_name AS name,
         c.id AS cut_id, ${CONSUMED} AS consumed, m.cost_per_m2,
         (c.method = 'FREEHAND' AND c.reconciled_area_mm2 IS NULL) AS estimated
       FROM (${APPROVED_IN_RANGE}) o
       JOIN customers cu ON cu.id = o.customer_id
       LEFT JOIN cuts c ON c.order_id = o.id
       LEFT JOIN inventory_units u ON u.id = c.unit_id
       LEFT JOIN materials m ON m.id = u.material_id
       ORDER BY o.id`,
    )
    .all({ start, end }) as {
    id: number;
    code: string;
    status: string;
    subtotal: number;
    name: string;
    cut_id: number | null;
    consumed: number | null;
    cost_per_m2: number | null;
    estimated: number | null;
  }[];

  const orders = new Map<number, { orderId: number; code: string; status: string; customerName: string; subtotal: number; consumedMm2: number; materialCost: number; estimated: boolean; noCuts: boolean }>();
  for (const r of rows) {
    const o = orders.get(r.id) ?? { orderId: r.id, code: r.code, status: r.status, customerName: r.name, subtotal: r.subtotal, consumedMm2: 0, materialCost: 0, estimated: false, noCuts: true };
    if (r.cut_id !== null) {
      o.noCuts = false;
      o.consumedMm2 += r.consumed ?? 0;
      if (r.cost_per_m2 === null) o.estimated = true;
      else o.materialCost += mulDivRound(r.consumed ?? 0, r.cost_per_m2, 1_000_000);
      if (r.estimated) o.estimated = true;
    }
    orders.set(r.id, o);
  }
  const list = [...orders.values()].map((o) => ({ ...o, margin: o.subtotal - o.materialCost, marginPct: pct(o.subtotal - o.materialCost, o.subtotal) }));
  const subtotal = list.reduce((a, o) => a + o.subtotal, 0);
  const materialCost = list.reduce((a, o) => a + o.materialCost, 0);
  return { subtotal, materialCost, margin: subtotal - materialCost, marginPct: pct(subtotal - materialCost, subtotal), orders: list };
}
