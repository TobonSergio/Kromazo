import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { FINISHES, inventoryUnits, MATERIAL_TYPES, materials, type Material } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';

export type Finish = (typeof FINISHES)[number];
export type MaterialTypeValue = (typeof MATERIAL_TYPES)[number];

/** Nombre legible: "3M 2080 Negro mate". */
export function materialLabel(m: Pick<Material, 'brand' | 'line' | 'color' | 'finish'>): string {
  // No repetir el acabado si el color ya lo dice ("Fibra de carbono" + CARBONO → sin "carbono" al final).
  const finish = m.finish === 'OTRO' || m.color.toLowerCase().includes(m.finish.toLowerCase()) ? '' : m.finish.toLowerCase();
  return [m.brand, m.line, m.color, finish].filter(Boolean).join(' ');
}

export interface StockSummary {
  rollsMm2: number;
  remnantsMm2: number;
  activeUnits: number;
}

/** Vista para el personal (admin y empleado): SIN costos. */
export interface MaterialStaffView {
  id: number;
  sku: string;
  label: string;
  brand: string;
  line: string | null;
  color: string;
  finish: Finish;
  type: MaterialTypeValue;
  gramsPerM2: number | null;
  minStockMm2: number;
  isActive: boolean;
  stock: StockSummary;
  lowStock: boolean;
}

export interface MaterialAdminView extends MaterialStaffView {
  costPerM2: number | null;
  /** Valor aproximado del stock activo (pesos), si hay costo. */
  stockValue: number | null;
}

function stockByMaterial(db: Db): Map<number, StockSummary> {
  const rows = db
    .select({
      materialId: inventoryUnits.materialId,
      rolls: sql<number>`coalesce(sum(case when ${inventoryUnits.kind} = 'ROLL' then ${inventoryUnits.balanceMm2} end), 0)`,
      remnants: sql<number>`coalesce(sum(case when ${inventoryUnits.kind} = 'REMNANT' then ${inventoryUnits.balanceMm2} end), 0)`,
      n: sql<number>`count(*)`,
    })
    .from(inventoryUnits)
    .where(eq(inventoryUnits.status, 'ACTIVE'))
    .groupBy(inventoryUnits.materialId)
    .all();
  return new Map(rows.map((r) => [r.materialId, { rollsMm2: r.rolls, remnantsMm2: r.remnants, activeUnits: r.n }]));
}

const EMPTY: StockSummary = { rollsMm2: 0, remnantsMm2: 0, activeUnits: 0 };

function toStaffView(m: Material, stock: StockSummary): MaterialStaffView {
  const total = stock.rollsMm2 + stock.remnantsMm2;
  return {
    id: m.id,
    sku: m.sku,
    label: materialLabel(m),
    brand: m.brand,
    line: m.line,
    color: m.color,
    finish: m.finish,
    type: m.type,
    gramsPerM2: m.gramsPerM2,
    minStockMm2: m.minStockMm2,
    isActive: m.isActive,
    stock,
    lowStock: m.isActive && m.minStockMm2 > 0 && total < m.minStockMm2,
  };
}

function toAdminView(m: Material, stock: StockSummary): MaterialAdminView {
  const total = stock.rollsMm2 + stock.remnantsMm2;
  return {
    ...toStaffView(m, stock),
    costPerM2: m.costPerM2,
    stockValue: m.costPerM2 === null ? null : Math.round((total * m.costPerM2) / 1_000_000),
  };
}

function listRaw(db: Db, opts: { activeOnly?: boolean }): Material[] {
  return db
    .select()
    .from(materials)
    .where(opts.activeOnly ? eq(materials.isActive, true) : undefined)
    .orderBy(asc(materials.type), asc(materials.brand), asc(materials.color))
    .all();
}

export function listMaterialsStaff(db: Db, opts: { activeOnly?: boolean } = {}): MaterialStaffView[] {
  const stock = stockByMaterial(db);
  return listRaw(db, opts).map((m) => toStaffView(m, stock.get(m.id) ?? EMPTY));
}

export function listMaterialsAdmin(db: Db, opts: { activeOnly?: boolean } = {}): MaterialAdminView[] {
  const stock = stockByMaterial(db);
  return listRaw(db, opts).map((m) => toAdminView(m, stock.get(m.id) ?? EMPTY));
}

export function getMaterial(db: Pick<Db, 'select'>, id: number): Material {
  const m = db.select().from(materials).where(eq(materials.id, id)).get();
  if (!m) throw notFound('Material no encontrado.');
  return m;
}

export function getMaterialAdminView(db: Db, id: number): MaterialAdminView {
  return toAdminView(getMaterial(db, id), stockByMaterial(db).get(id) ?? EMPTY);
}

export interface MaterialInput {
  sku?: string | null;
  brand: string;
  line?: string | null;
  color: string;
  finish: Finish;
  type: MaterialTypeValue;
  gramsPerM2?: number | null;
  costPerM2?: number | null;
  minStockMm2?: number;
}

function nextSku(db: Db): string {
  const row = db
    .select({ n: sql<number | null>`max(cast(substr(${materials.sku}, 3) as integer))` })
    .from(materials)
    .where(sql`${materials.sku} GLOB 'M-[0-9]*'`)
    .get();
  return `M-${String((row?.n ?? 0) + 1).padStart(3, '0')}`;
}

function assertSkuFree(db: Db, sku: string, exceptId?: number) {
  const other = db.select({ id: materials.id }).from(materials).where(eq(materials.sku, sku)).get();
  if (other && other.id !== exceptId) throw conflict(`Ya existe un material con la referencia ${sku}.`, 'SKU_TAKEN');
}

export function createMaterial(db: Db, input: MaterialInput): Material {
  const sku = input.sku || nextSku(db);
  assertSkuFree(db, sku);
  return db
    .insert(materials)
    .values({
      sku,
      brand: input.brand,
      line: input.line ?? null,
      color: input.color,
      finish: input.finish,
      type: input.type,
      gramsPerM2: input.gramsPerM2 ?? null,
      costPerM2: input.costPerM2 ?? null,
      minStockMm2: input.minStockMm2 ?? 0,
    })
    .returning()
    .get();
}

export function updateMaterial(
  db: Db,
  id: number,
  input: Partial<MaterialInput> & { isActive?: boolean },
): { before: Material; after: Material } {
  const before = getMaterial(db, id);
  if (input.sku) assertSkuFree(db, input.sku, id);
  const { sku, ...rest } = input;
  const after = db
    .update(materials)
    .set({ ...rest, ...(sku ? { sku } : {}) })
    .where(eq(materials.id, id))
    .returning()
    .get()!;
  return { before, after };
}
