import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { catalogItems, CATALOG_KINDS, type CatalogItem, type PricingUnit } from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import { getMaterial } from '../materials/service.js';

/** Lo que ve cualquiera en la vitrina, sin iniciar sesión. */
export interface PublicCatalogItem {
  id: number;
  name: string;
  description: string | null;
  kind: (typeof CATALOG_KINDS)[number];
  pricingUnit: PricingUnit;
  /** Precio de referencia sin IVA. */
  unitPrice: number;
  taxRateBp: number;
}

const toPublic = (c: CatalogItem): PublicCatalogItem => ({
  id: c.id,
  name: c.name,
  description: c.description,
  kind: c.kind,
  pricingUnit: c.pricingUnit,
  unitPrice: c.unitPrice,
  taxRateBp: c.taxRateBp,
});

const order = [asc(catalogItems.sortOrder), asc(catalogItems.name)];

export function listPublicCatalog(db: Db): PublicCatalogItem[] {
  return db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.isPublic, true), eq(catalogItems.isActive, true)))
    .orderBy(...order)
    .all()
    .map(toPublic);
}

export function listCatalogAdmin(db: Db): CatalogItem[] {
  return db.select().from(catalogItems).orderBy(...order).all();
}

export function getCatalogItem(db: Pick<Db, 'select'>, id: number): CatalogItem {
  const c = db.select().from(catalogItems).where(eq(catalogItems.id, id)).get();
  if (!c) throw notFound('Ítem del catálogo no encontrado.');
  return c;
}

export interface CatalogInput {
  name: string;
  description?: string | null;
  kind: (typeof CATALOG_KINDS)[number];
  pricingUnit: PricingUnit;
  unitPrice: number;
  taxRateBp?: number;
  materialId?: number | null;
  isPublic?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export function createCatalogItem(db: Db, input: CatalogInput): CatalogItem {
  if (input.materialId) getMaterial(db, input.materialId);
  return db.insert(catalogItems).values(input).returning().get();
}

export function updateCatalogItem(db: Db, id: number, input: Partial<CatalogInput>): { before: CatalogItem; after: CatalogItem } {
  const before = getCatalogItem(db, id);
  if (input.materialId) getMaterial(db, input.materialId);
  const after = db.update(catalogItems).set(input).where(eq(catalogItems.id, id)).returning().get()!;
  return { before, after };
}
