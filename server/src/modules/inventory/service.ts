import { alias } from 'drizzle-orm/sqlite-core';
import { and, asc, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  cuts,
  freehandSizes,
  inventoryMovements,
  inventoryUnits,
  materials,
  orders,
  physicalCounts,
  users,
  type Cut,
  type InventoryUnit,
  type MaterialType,
  type MovementType,
  type UnitKind,
  type UnitStatus,
} from '../../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { getMaterial, materialLabel } from '../materials/service.js';
import { reconcile } from './reconcile.js';
import { assertOrderCuttable } from '../orders/service.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

const m2 = (mm2: number) => (mm2 / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 2 });

// ───────────────────────── Vistas (sin costos: las usan admin y empleado) ─────────────────────────

export interface UnitView {
  id: number;
  code: string;
  kind: UnitKind;
  materialId: number;
  materialLabel: string;
  materialType: MaterialType;
  widthMm: number;
  initialLengthMm: number;
  coreWeightG: number | null;
  balanceMm2: number;
  /** Largo restante aproximado (saldo ÷ ancho). */
  approxLengthMm: number;
  status: UnitStatus;
  location: string | null;
  parentUnitId: number | null;
  parentCode: string | null;
  pendingFreehand: { count: number; areaMm2: number };
  /** Conviene contarla: muchos cortes a pulso sin conciliar, o saldo en 0 con cortes pendientes. */
  needsCount: boolean;
  createdAt: string;
}

const parent = alias(inventoryUnits, 'parent');

function pendingFreehandByUnit(db: Conn, unitIds?: number[]) {
  const conds: SQL[] = [eq(cuts.method, 'FREEHAND'), isNull(cuts.reconciledCountId)];
  if (unitIds) conds.push(inArray(cuts.unitId, unitIds));
  const rows = db
    .select({ unitId: cuts.unitId, n: sql<number>`count(*)`, area: sql<number>`sum(${cuts.cutAreaMm2})` })
    .from(cuts)
    .where(and(...conds))
    .groupBy(cuts.unitId)
    .all();
  return new Map(rows.map((r) => [r.unitId, { count: r.n, areaMm2: r.area }]));
}

export interface UnitFilter {
  materialId?: number;
  kind?: UnitKind;
  status?: UnitStatus | 'ALL';
  q?: string;
  needsCount?: boolean;
}

export function listUnits(db: Db, f: UnitFilter = {}): UnitView[] {
  const conds: SQL[] = [];
  if (f.materialId) conds.push(eq(inventoryUnits.materialId, f.materialId));
  if (f.kind) conds.push(eq(inventoryUnits.kind, f.kind));
  if (f.status !== 'ALL') conds.push(eq(inventoryUnits.status, f.status ?? 'ACTIVE'));
  if (f.q) {
    const p = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(
      or(
        like(inventoryUnits.code, p),
        like(materials.color, p),
        like(materials.brand, p),
        like(materials.line, p),
        like(materials.sku, p),
        like(inventoryUnits.location, p),
      )!,
    );
  }
  const rows = db
    .select({ unit: inventoryUnits, material: materials, parentCode: parent.code })
    .from(inventoryUnits)
    .innerJoin(materials, eq(materials.id, inventoryUnits.materialId))
    .leftJoin(parent, eq(parent.id, inventoryUnits.parentUnitId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(materials.type), asc(materials.brand), asc(materials.color), asc(inventoryUnits.kind), asc(inventoryUnits.code))
    .limit(1000)
    .all();
  const pending = pendingFreehandByUnit(db);
  const threshold = getSettings(db).freehandPendingAlert;
  const views = rows.map((r) => toUnitView(r.unit, r.material, r.parentCode, pending.get(r.unit.id), threshold));
  return f.needsCount ? views.filter((v) => v.needsCount) : views;
}

function toUnitView(
  u: InventoryUnit,
  m: Parameters<typeof materialLabel>[0] & { type: MaterialType },
  parentCode: string | null,
  pending: { count: number; areaMm2: number } | undefined,
  threshold: number,
): UnitView {
  const p = pending ?? { count: 0, areaMm2: 0 };
  return {
    id: u.id,
    code: u.code,
    kind: u.kind,
    materialId: u.materialId,
    materialLabel: materialLabel(m),
    materialType: m.type,
    widthMm: u.widthMm,
    initialLengthMm: u.initialLengthMm,
    coreWeightG: u.coreWeightG,
    balanceMm2: u.balanceMm2,
    approxLengthMm: Math.floor(u.balanceMm2 / u.widthMm),
    status: u.status,
    location: u.location,
    parentUnitId: u.parentUnitId,
    parentCode,
    pendingFreehand: p,
    needsCount: u.status !== 'DISCARDED' && p.count > 0 && (p.count >= threshold || u.balanceMm2 === 0),
    createdAt: u.createdAt,
  };
}

export function getUnitView(db: Conn, id: number): UnitView {
  const r = db
    .select({ unit: inventoryUnits, material: materials, parentCode: parent.code })
    .from(inventoryUnits)
    .innerJoin(materials, eq(materials.id, inventoryUnits.materialId))
    .leftJoin(parent, eq(parent.id, inventoryUnits.parentUnitId))
    .where(eq(inventoryUnits.id, id))
    .get();
  if (!r) throw notFound('Rollo o retazo no encontrado.');
  return toUnitView(r.unit, r.material, r.parentCode, pendingFreehandByUnit(db, [id]).get(id), getSettings(db).freehandPendingAlert);
}

export interface CutView {
  id: number;
  unitId: number;
  unitCode: string;
  materialLabel: string;
  method: Cut['method'];
  cutLengthMm: number | null;
  cutWidthMm: number | null;
  sizeName: string | null;
  cutAreaMm2: number;
  usedAreaMm2: number;
  remnantAreaMm2: number;
  wasteAreaMm2: number;
  reconciled: boolean;
  reconciledAreaMm2: number | null;
  notes: string | null;
  userName: string;
  createdAt: string;
  remnantCodes: string[];
  orderId: number | null;
  orderCode: string | null;
}

export function listCuts(db: Db, f: { unitId?: number; userId?: number; limit?: number }): CutView[] {
  const conds: SQL[] = [];
  if (f.unitId) conds.push(eq(cuts.unitId, f.unitId));
  if (f.userId) conds.push(eq(cuts.userId, f.userId));
  const rows = db
    .select({ cut: cuts, unit: inventoryUnits, material: materials, sizeName: freehandSizes.name, userName: users.fullName, orderCode: orders.code })
    .from(cuts)
    .innerJoin(inventoryUnits, eq(inventoryUnits.id, cuts.unitId))
    .innerJoin(materials, eq(materials.id, inventoryUnits.materialId))
    .innerJoin(users, eq(users.id, cuts.userId))
    .leftJoin(freehandSizes, eq(freehandSizes.id, cuts.freehandSizeId))
    .leftJoin(orders, eq(orders.id, cuts.orderId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(cuts.id))
    .limit(f.limit ?? 50)
    .all();
  const ids = rows.map((r) => r.cut.id);
  const remnants = ids.length
    ? db
        .select({ cutId: inventoryUnits.sourceCutId, code: inventoryUnits.code })
        .from(inventoryUnits)
        .where(inArray(inventoryUnits.sourceCutId, ids))
        .orderBy(asc(inventoryUnits.id))
        .all()
    : [];
  return rows.map((r) => ({
    id: r.cut.id,
    unitId: r.unit.id,
    unitCode: r.unit.code,
    materialLabel: materialLabel(r.material),
    method: r.cut.method,
    cutLengthMm: r.cut.cutLengthMm,
    cutWidthMm: r.cut.cutWidthMm,
    sizeName: r.sizeName,
    cutAreaMm2: r.cut.cutAreaMm2,
    usedAreaMm2: r.cut.usedAreaMm2,
    remnantAreaMm2: r.cut.remnantAreaMm2,
    wasteAreaMm2: r.cut.wasteAreaMm2,
    reconciled: r.cut.reconciledCountId !== null,
    reconciledAreaMm2: r.cut.reconciledAreaMm2,
    notes: r.cut.notes,
    userName: r.userName,
    createdAt: r.cut.createdAt,
    remnantCodes: remnants.filter((x) => x.cutId === r.cut.id).map((x) => x.code),
    orderId: r.cut.orderId,
    orderCode: r.orderCode,
  }));
}

export interface MovementView {
  id: number;
  type: MovementType;
  areaMm2: number;
  cutId: number | null;
  countId: number | null;
  reason: string | null;
  userName: string;
  createdAt: string;
}

export function listMovements(db: Db, unitId: number, limit = 200): MovementView[] {
  return db
    .select({
      id: inventoryMovements.id,
      type: inventoryMovements.type,
      areaMm2: inventoryMovements.areaMm2,
      cutId: inventoryMovements.cutId,
      countId: inventoryMovements.countId,
      reason: inventoryMovements.reason,
      userName: users.fullName,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .innerJoin(users, eq(users.id, inventoryMovements.userId))
    .where(eq(inventoryMovements.unitId, unitId))
    .orderBy(desc(inventoryMovements.id))
    .limit(limit)
    .all();
}

export function listCounts(db: Db, unitId: number) {
  return db
    .select({ count: physicalCounts, userName: users.fullName })
    .from(physicalCounts)
    .innerJoin(users, eq(users.id, physicalCounts.userId))
    .where(eq(physicalCounts.unitId, unitId))
    .orderBy(desc(physicalCounts.id))
    .all()
    .map((r) => ({ ...r.count, userName: r.userName }));
}

// ───────────────────────── Escritura ─────────────────────────

function getUnitRow(tx: Conn, id: number): InventoryUnit {
  const u = tx.select().from(inventoryUnits).where(eq(inventoryUnits.id, id)).get();
  if (!u) throw notFound('Rollo o retazo no encontrado.');
  return u;
}

/** Único punto que mueve stock: inserta el movimiento y actualiza el saldo en caché. */
function applyMovement(
  tx: Tx,
  unit: InventoryUnit,
  m: { type: MovementType; areaMm2: number; userId: number; cutId?: number; countId?: number; reason?: string | null },
): number {
  const newBalance = unit.balanceMm2 + m.areaMm2;
  if (newBalance < 0) {
    throw conflict(`${unit.code} no tiene saldo suficiente (quedan ${m2(unit.balanceMm2)} m²).`, 'INSUFFICIENT_STOCK');
  }
  tx.insert(inventoryMovements)
    .values({
      unitId: unit.id,
      type: m.type,
      areaMm2: m.areaMm2,
      cutId: m.cutId ?? null,
      countId: m.countId ?? null,
      reason: m.reason ?? null,
      userId: m.userId,
    })
    .run();
  tx.update(inventoryUnits).set({ balanceMm2: newBalance }).where(eq(inventoryUnits.id, unit.id)).run();
  unit.balanceMm2 = newBalance;
  return newBalance;
}

function setStatus(tx: Tx, unit: InventoryUnit, status: UnitStatus) {
  if (unit.status === status) return;
  tx.update(inventoryUnits).set({ status }).where(eq(inventoryUnits.id, unit.id)).run();
  unit.status = status;
}

function nextCode(tx: Conn, prefix: 'R' | 'RZ'): string {
  const row = tx
    .select({ n: sql<number | null>`max(cast(substr(${inventoryUnits.code}, ${prefix.length + 2}) as integer))` })
    .from(inventoryUnits)
    .where(sql`${inventoryUnits.code} GLOB ${`${prefix}-[0-9]*`}`)
    .get();
  return `${prefix}-${String((row?.n ?? 0) + 1).padStart(3, '0')}`;
}

function assertCodeFree(tx: Conn, code: string) {
  if (tx.select({ id: inventoryUnits.id }).from(inventoryUnits).where(eq(inventoryUnits.code, code)).get()) {
    throw conflict(`Ya existe una unidad con el código ${code}.`, 'CODE_TAKEN');
  }
}

export interface NewRollInput {
  materialId: number;
  code?: string | null;
  widthMm: number;
  /** Largo actual del rollo (si ya está empezado, lo que queda). */
  lengthMm: number;
  coreWeightG?: number | null;
  location?: string | null;
}

/** Alta manual de un rollo (inventario inicial o entrada sin compra). Las compras llegan en la Fase 4. */
export function createRoll(db: Db, userId: number, input: NewRollInput): UnitView {
  const id = db.transaction((tx) => {
    getMaterial(tx, input.materialId);
    return insertRoll(tx, userId, input, { type: 'INITIAL_IN', reason: 'Alta manual' }).id;
  });
  return getUnitView(db, id);
}

/** Crea un rollo con su movimiento de entrada, dentro de una transacción ya abierta (alta manual o compra). */
export function insertRoll(
  tx: Tx,
  userId: number,
  input: NewRollInput & { purchaseLineId?: number },
  entry: { type: 'INITIAL_IN' | 'PURCHASE_IN'; reason?: string },
): InventoryUnit {
  const code = input.code || nextCode(tx, 'R');
  assertCodeFree(tx, code);
  const unit = tx
    .insert(inventoryUnits)
    .values({
      code,
      materialId: input.materialId,
      kind: 'ROLL',
      widthMm: input.widthMm,
      initialLengthMm: input.lengthMm,
      coreWeightG: input.coreWeightG ?? null,
      location: input.location ?? null,
      purchaseLineId: input.purchaseLineId ?? null,
      balanceMm2: 0,
    })
    .returning()
    .get();
  applyMovement(tx, unit, { type: entry.type, areaMm2: input.widthMm * input.lengthMm, userId, reason: entry.reason });
  return unit;
}

export function updateUnit(db: Db, id: number, data: { location?: string | null; coreWeightG?: number | null }): UnitView {
  const unit = getUnitRow(db, id);
  if (data.coreWeightG !== undefined && unit.kind !== 'ROLL') throw badRequest('Solo los rollos tienen tubo.');
  db.update(inventoryUnits).set(data).where(eq(inventoryUnits.id, id)).run();
  return getUnitView(db, id);
}

// ── Cortes ──

export interface RemnantInput {
  widthMm: number;
  lengthMm: number;
  location?: string | null;
}

interface CutBase {
  unitId: number;
  /** Trabajo al que se carga el material (debe estar aprobado o en proceso). */
  orderId?: number | null;
  remnants?: RemnantInput[];
  notes?: string | null;
}

export interface MeasuredCutInput extends CutBase {
  method: 'MEASURED';
  lengthMm: number;
  /** Por defecto, el ancho completo de la unidad. */
  widthMm?: number;
  /** Por defecto, todo lo que no es retazo (sin desperdicio). */
  usedAreaMm2?: number;
}

export interface FreehandCutInput extends CutBase {
  method: 'FREEHAND';
  /** Una de tres formas de estimar: talla, área aproximada o largo (× ancho, por defecto el de la unidad). */
  sizeId?: number;
  approxAreaMm2?: number;
  lengthMm?: number;
  widthMm?: number;
}

export type CutInput = MeasuredCutInput | FreehandCutInput;

export interface CutResult {
  cut: CutView;
  unit: UnitView;
  remnants: UnitView[];
}

const fits = (r: RemnantInput, w: number, l: number) =>
  (r.widthMm <= w && r.lengthMm <= l) || (r.widthMm <= l && r.lengthMm <= w);

export function registerCut(db: Db, userId: number, input: CutInput): CutResult {
  const { cutId, remnantIds } = db.transaction((tx) => {
    const unit = getUnitRow(tx, input.unitId);
    if (unit.status !== 'ACTIVE') {
      throw conflict(`${unit.code} está ${unit.status === 'DEPLETED' ? 'agotado' : 'dado de baja'}; no se puede cortar.`, 'UNIT_NOT_ACTIVE');
    }
    const material = getMaterial(tx, unit.materialId);
    const remnants = input.remnants ?? [];
    if (input.orderId) assertOrderCuttable(tx, input.orderId);

    let lengthMm: number | null = input.lengthMm ?? null;
    let widthMm: number | null = input.widthMm ?? (lengthMm !== null ? unit.widthMm : null);
    let cutArea: number;
    let sizeId: number | null = null;

    if (widthMm !== null && widthMm > unit.widthMm) {
      throw badRequest(`El ancho del corte no puede superar el de ${unit.code} (${unit.widthMm / 10} cm).`);
    }
    if (unit.kind === 'REMNANT' && lengthMm !== null && widthMm !== null) {
      const piece = { widthMm, lengthMm };
      if (!fits(piece, unit.widthMm, unit.initialLengthMm)) {
        throw badRequest(`El corte no cabe en el retazo ${unit.code}.`);
      }
    }

    if (input.method === 'MEASURED') {
      cutArea = input.lengthMm * widthMm!;
    } else {
      const ways = [input.sizeId !== undefined, input.approxAreaMm2 !== undefined, input.lengthMm !== undefined].filter(Boolean).length;
      if (ways !== 1) throw badRequest('Elige una talla, o escribe un área o un largo aproximado (solo una opción).');
      if (input.sizeId !== undefined) {
        const size = tx.select().from(freehandSizes).where(eq(freehandSizes.id, input.sizeId)).get();
        if (!size || !size.isActive) throw badRequest('Talla no encontrada.');
        if (size.materialType && size.materialType !== material.type) throw badRequest('Esa talla no aplica a este material.');
        sizeId = size.id;
        cutArea = size.refAreaMm2;
        lengthMm = null;
        widthMm = null;
      } else if (input.approxAreaMm2 !== undefined) {
        cutArea = input.approxAreaMm2;
        lengthMm = null;
        widthMm = null;
      } else {
        cutArea = lengthMm! * widthMm!;
      }
    }

    // Retazos.
    let remnantArea = 0;
    for (const r of remnants) {
      if (lengthMm !== null && widthMm !== null && !fits(r, widthMm, lengthMm)) {
        throw badRequest('Cada retazo debe caber dentro del trozo cortado.');
      }
      remnantArea += r.widthMm * r.lengthMm;
    }
    if (remnantArea > cutArea) {
      throw badRequest(
        input.method === 'FREEHAND'
          ? 'Los retazos suman más que el tamaño estimado. Elige una talla más grande.'
          : 'Los retazos suman más que el trozo cortado.',
      );
    }

    let used = cutArea - remnantArea;
    let waste = 0;
    if (input.method === 'MEASURED' && input.usedAreaMm2 !== undefined) {
      if (input.usedAreaMm2 > cutArea - remnantArea) {
        throw badRequest('El área usada más los retazos no puede superar el trozo cortado.');
      }
      used = input.usedAreaMm2;
      waste = cutArea - remnantArea - used;
    }

    if (cutArea > unit.balanceMm2) {
      throw conflict(
        `El corte (${m2(cutArea)} m²) supera el saldo de ${unit.code} (${m2(unit.balanceMm2)} m²). ` +
          'Pide al administrador que cuente el rollo.',
        'INSUFFICIENT_STOCK',
      );
    }

    const cut = tx
      .insert(cuts)
      .values({
        unitId: unit.id,
        method: input.method,
        cutLengthMm: lengthMm,
        cutWidthMm: widthMm,
        freehandSizeId: sizeId,
        orderId: input.orderId ?? null,
        cutAreaMm2: cutArea,
        usedAreaMm2: used,
        remnantAreaMm2: remnantArea,
        wasteAreaMm2: waste,
        notes: input.notes ?? null,
        userId,
      })
      .returning()
      .get();
    applyMovement(tx, unit, { type: 'CUT_OUT', areaMm2: -cutArea, cutId: cut.id, userId });

    const remnantIds: number[] = [];
    for (const r of remnants) {
      const rem = tx
        .insert(inventoryUnits)
        .values({
          code: nextCode(tx, 'RZ'),
          materialId: unit.materialId,
          kind: 'REMNANT',
          // Se guarda con el ancho como el lado menor, para que "ancho × largo" sea consistente.
          widthMm: Math.min(r.widthMm, r.lengthMm),
          initialLengthMm: Math.max(r.widthMm, r.lengthMm),
          parentUnitId: unit.id,
          sourceCutId: cut.id,
          location: r.location ?? unit.location,
          balanceMm2: 0,
        })
        .returning()
        .get();
      applyMovement(tx, rem, { type: 'REMNANT_IN', areaMm2: r.widthMm * r.lengthMm, cutId: cut.id, userId });
      remnantIds.push(rem.id);
    }

    // Una unidad no se da por agotada solo por estimaciones: si quedan cortes a pulso pendientes, se pide conteo.
    if (unit.balanceMm2 === 0 && !pendingFreehandByUnit(tx, [unit.id]).has(unit.id)) setStatus(tx, unit, 'DEPLETED');
    return { cutId: cut.id, remnantIds };
  });

  const cut = listCuts(db, { unitId: input.unitId, limit: 20 }).find((c) => c.id === cutId)!;
  return { cut, unit: getUnitView(db, input.unitId), remnants: remnantIds.map((id) => getUnitView(db, id)) };
}

// ── Conteo físico ──

export type CountInput =
  | { method: 'LENGTH'; measuredLengthMm: number; notes?: string | null }
  | { method: 'WEIGHT'; measuredWeightG: number; notes?: string | null };

export function registerCount(db: Db, userId: number, unitId: number, input: CountInput) {
  const tolerancePct = getSettings(db).freehandTolerancePct;
  const countId = db.transaction((tx) => {
    const unit = getUnitRow(tx, unitId);
    if (unit.status === 'DISCARDED') throw conflict(`${unit.code} está dado de baja.`, 'UNIT_NOT_ACTIVE');
    const material = getMaterial(tx, unit.materialId);

    let computed: number;
    if (input.method === 'LENGTH') {
      computed = input.measuredLengthMm * unit.widthMm;
    } else {
      if (!material.gramsPerM2) {
        throw badRequest('Para contar por peso, registra primero el gramaje (g/m²) del material.', 'NO_GSM');
      }
      const core = unit.kind === 'ROLL' ? unit.coreWeightG : 0;
      if (core === null) throw badRequest('Para contar por peso, registra primero el peso del tubo del rollo.', 'NO_CORE');
      const net = input.measuredWeightG - core;
      if (net < 0) throw badRequest('El peso medido es menor que el del tubo.');
      computed = Math.round((net * 1_000_000) / material.gramsPerM2);
    }

    const system = unit.balanceMm2;
    const pending = tx
      .select({ id: cuts.id, area: cuts.cutAreaMm2 })
      .from(cuts)
      .where(and(eq(cuts.unitId, unit.id), eq(cuts.method, 'FREEHAND'), isNull(cuts.reconciledCountId)))
      .orderBy(asc(cuts.id))
      .all();
    const r = reconcile(
      computed - system,
      pending.map((p) => p.area),
      tolerancePct,
    );

    const count = tx
      .insert(physicalCounts)
      .values({
        unitId: unit.id,
        method: input.method,
        measuredLengthMm: input.method === 'LENGTH' ? input.measuredLengthMm : null,
        measuredWeightG: input.method === 'WEIGHT' ? input.measuredWeightG : null,
        computedAreaMm2: computed,
        systemAreaMm2: system,
        freehandAdjustMm2: r.freehandAdjust,
        unexplainedMm2: r.unexplained,
        notes: input.notes ?? null,
        userId,
      })
      .returning()
      .get();

    pending.forEach((p, i) => {
      tx.update(cuts)
        .set({ reconciledCountId: count.id, reconciledAreaMm2: r.reconciledAreas[i]! })
        .where(eq(cuts.id, p.id))
        .run();
    });
    if (r.freehandAdjust !== 0) {
      applyMovement(tx, unit, { type: 'FREEHAND_ADJUST', areaMm2: r.freehandAdjust, countId: count.id, userId });
    }
    if (r.unexplained !== 0) {
      applyMovement(tx, unit, { type: 'COUNT_ADJUST', areaMm2: r.unexplained, countId: count.id, userId });
    }
    if (unit.balanceMm2 !== computed) throw new AppError(500, 'INTERNAL', 'Conteo inconsistente.');
    setStatus(tx, unit, computed === 0 ? 'DEPLETED' : 'ACTIVE');
    return count.id;
  });

  const count = db.select().from(physicalCounts).where(eq(physicalCounts.id, countId)).get()!;
  return { count, unit: getUnitView(db, unitId) };
}

// ── Ajustes y bajas (solo admin) ──

export function adjustUnit(db: Db, userId: number, unitId: number, input: { areaMm2: number; reason: string }): UnitView {
  db.transaction((tx) => {
    const unit = getUnitRow(tx, unitId);
    if (unit.status === 'DISCARDED') throw conflict(`${unit.code} está dado de baja.`, 'UNIT_NOT_ACTIVE');
    applyMovement(tx, unit, { type: 'MANUAL_ADJUST', areaMm2: input.areaMm2, reason: input.reason, userId });
    setStatus(tx, unit, unit.balanceMm2 === 0 ? 'DEPLETED' : 'ACTIVE');
  });
  return getUnitView(db, unitId);
}

export function discardUnit(db: Db, userId: number, unitId: number, input: { reason: string }): UnitView {
  db.transaction((tx) => {
    const unit = getUnitRow(tx, unitId);
    if (unit.status === 'DISCARDED') throw conflict(`${unit.code} ya está dado de baja.`, 'UNIT_NOT_ACTIVE');
    if (unit.balanceMm2 > 0) {
      applyMovement(tx, unit, { type: 'DISCARD', areaMm2: -unit.balanceMm2, reason: input.reason, userId });
    }
    setStatus(tx, unit, 'DISCARDED');
  });
  return getUnitView(db, unitId);
}

// ── Tallas de corte a pulso ──

export function listFreehandSizes(db: Db, opts: { activeOnly?: boolean; materialType?: MaterialType } = {}) {
  const conds: SQL[] = [];
  if (opts.activeOnly) conds.push(eq(freehandSizes.isActive, true));
  if (opts.materialType) {
    conds.push(or(isNull(freehandSizes.materialType), eq(freehandSizes.materialType, opts.materialType))!);
  }
  return db
    .select()
    .from(freehandSizes)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(freehandSizes.sortOrder), asc(freehandSizes.refAreaMm2))
    .all();
}

export interface SizeInput {
  name: string;
  refAreaMm2: number;
  materialType?: MaterialType | null;
  sortOrder?: number;
  isActive?: boolean;
}

export function createFreehandSize(db: Db, input: SizeInput) {
  return db.insert(freehandSizes).values(input).returning().get();
}

export function updateFreehandSize(db: Db, id: number, input: Partial<SizeInput>) {
  const s = db.update(freehandSizes).set(input).where(eq(freehandSizes.id, id)).returning().get();
  if (!s) throw notFound('Talla no encontrada.');
  return s;
}
