import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { inventoryUnits, materials, purchaseLines, purchases, suppliers, users } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getMaterial, materialLabel } from '../materials/service.js';
import { insertRoll } from '../inventory/service.js';

// ───────────────────────── Proveedores ─────────────────────────

export interface SupplierInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export function listSuppliers(db: Db) {
  return db.select().from(suppliers).orderBy(asc(suppliers.name)).all();
}

export function createSupplier(db: Db, input: SupplierInput) {
  return db.insert(suppliers).values(input).returning().get();
}

export function updateSupplier(db: Db, id: number, input: Partial<SupplierInput>) {
  const s = db.update(suppliers).set(input).where(eq(suppliers.id, id)).returning().get();
  if (!s) throw notFound('Proveedor no encontrado.');
  return s;
}

// ───────────────────────── Compras ─────────────────────────

export interface PurchaseLineInput {
  materialId: number;
  rolls: number;
  widthMm: number;
  /** Largo de cada rollo. */
  lengthMm: number;
  /** Costo de cada rollo (pesos). */
  unitCost: number;
  coreWeightG?: number | null;
  location?: string | null;
}

export interface PurchaseInput {
  supplierId: number;
  invoiceRef?: string | null;
  purchasedAt: string;
  notes?: string | null;
  lines: PurchaseLineInput[];
}

/** round(a / b) para enteros grandes, con BigInt (mitad hacia arriba). */
const divRound = (a: bigint, b: bigint) => Number((a * 2n + b) / (b * 2n));

/**
 * Costo promedio ponderado por m²:
 *   nuevo = (stock_actual × costo_actual + área_comprada × costo_compra) / (stock_actual + área_comprada)
 * Si el material no tenía costo o no tenía stock, el nuevo costo es el de la compra.
 */
export function weightedCost(stockMm2: number, currentCostPerM2: number | null, boughtMm2: number, boughtTotalPesos: number): number {
  if (boughtMm2 <= 0) throw new Error('área comprada inválida');
  // Todo en "pesos × mm² / m²" para no perder precisión: costo_total_stock = stock × costo / 1e6.
  const stockPart = currentCostPerM2 === null || stockMm2 === 0 ? 0n : BigInt(stockMm2) * BigInt(currentCostPerM2);
  const stockArea = currentCostPerM2 === null ? 0n : BigInt(stockMm2);
  const boughtPart = BigInt(boughtTotalPesos) * 1_000_000n;
  return divRound(stockPart + boughtPart, stockArea + BigInt(boughtMm2));
}

/**
 * Confirma una compra en una sola transacción: crea la compra, sus líneas, un rollo por cada unidad comprada
 * (con su movimiento PURCHASE_IN) y recalcula el costo promedio de cada material.
 */
export function createPurchase(db: Db, userId: number, input: PurchaseInput) {
  return db.transaction((tx) => {
    const supplier = tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).get();
    if (!supplier) throw badRequest('Proveedor no encontrado.');

    const total = input.lines.reduce((a, l) => a + l.rolls * l.unitCost, 0);
    const purchase = tx
      .insert(purchases)
      .values({ supplierId: supplier.id, invoiceRef: input.invoiceRef ?? null, purchasedAt: input.purchasedAt, total, notes: input.notes ?? null, userId })
      .returning()
      .get();

    // Agrupa por material para calcular el costo con el stock ANTES de la compra.
    const byMaterial = new Map<number, { area: number; cost: number }>();
    for (const l of input.lines) {
      const acc = byMaterial.get(l.materialId) ?? { area: 0, cost: 0 };
      acc.area += l.rolls * l.widthMm * l.lengthMm;
      acc.cost += l.rolls * l.unitCost;
      byMaterial.set(l.materialId, acc);
    }
    const costChanges: { materialId: number; label: string; before: number | null; after: number }[] = [];
    for (const [materialId, bought] of byMaterial) {
      const m = getMaterial(tx, materialId);
      const stock = tx
        .select({ s: sql<number>`coalesce(sum(${inventoryUnits.balanceMm2}), 0)` })
        .from(inventoryUnits)
        .where(and(eq(inventoryUnits.materialId, materialId), eq(inventoryUnits.status, 'ACTIVE')))
        .get()!.s;
      const after = weightedCost(stock, m.costPerM2, bought.area, bought.cost);
      tx.update(materials).set({ costPerM2: after }).where(eq(materials.id, materialId)).run();
      costChanges.push({ materialId, label: materialLabel(m), before: m.costPerM2, after });
    }

    const createdCodes: string[] = [];
    for (const l of input.lines) {
      const line = tx
        .insert(purchaseLines)
        .values({ purchaseId: purchase.id, materialId: l.materialId, rolls: l.rolls, widthMm: l.widthMm, lengthMm: l.lengthMm, unitCost: l.unitCost })
        .returning()
        .get();
      for (let i = 0; i < l.rolls; i++) {
        const unit = insertRoll(
          tx,
          userId,
          { materialId: l.materialId, widthMm: l.widthMm, lengthMm: l.lengthMm, coreWeightG: l.coreWeightG, location: l.location, purchaseLineId: line.id },
          { type: 'PURCHASE_IN', reason: `Compra #${purchase.id}${input.invoiceRef ? ` (${input.invoiceRef})` : ''}` },
        );
        createdCodes.push(unit.code);
      }
    }
    return { purchaseId: purchase.id, createdCodes, costChanges };
  });
}

export function listPurchases(db: Db, limit = 100) {
  return db
    .select({
      id: purchases.id,
      supplierName: suppliers.name,
      invoiceRef: purchases.invoiceRef,
      purchasedAt: purchases.purchasedAt,
      total: purchases.total,
      rolls: sql<number>`(select coalesce(sum(${purchaseLines.rolls}), 0) from ${purchaseLines} where ${purchaseLines.purchaseId} = ${purchases.id})`,
      userName: users.fullName,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .innerJoin(users, eq(users.id, purchases.userId))
    .orderBy(desc(purchases.purchasedAt), desc(purchases.id))
    .limit(limit)
    .all();
}

export function getPurchase(db: Db, id: number) {
  const p = db
    .select({ purchase: purchases, supplierName: suppliers.name, userName: users.fullName })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .innerJoin(users, eq(users.id, purchases.userId))
    .where(eq(purchases.id, id))
    .get();
  if (!p) throw notFound('Compra no encontrada.');
  const lines = db
    .select({ line: purchaseLines, material: materials })
    .from(purchaseLines)
    .innerJoin(materials, eq(materials.id, purchaseLines.materialId))
    .where(eq(purchaseLines.purchaseId, id))
    .orderBy(asc(purchaseLines.id))
    .all();
  const units = db
    .select({ id: inventoryUnits.id, code: inventoryUnits.code, lineId: inventoryUnits.purchaseLineId, status: inventoryUnits.status })
    .from(inventoryUnits)
    .innerJoin(purchaseLines, eq(purchaseLines.id, inventoryUnits.purchaseLineId))
    .where(eq(purchaseLines.purchaseId, id))
    .orderBy(asc(inventoryUnits.id))
    .all();
  return {
    ...p.purchase,
    supplierName: p.supplierName,
    userName: p.userName,
    lines: lines.map(({ line, material }) => ({
      ...line,
      materialLabel: materialLabel(material),
      costPerM2: Math.round((line.unitCost * 1_000_000) / (line.widthMm * line.lengthMm)),
      units: units.filter((u) => u.lineId === line.id).map(({ lineId: _l, ...u }) => u),
    })),
  };
}
