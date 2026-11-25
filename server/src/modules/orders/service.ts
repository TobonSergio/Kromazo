import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  customers,
  cuts,
  inventoryUnits,
  materials,
  orderItems,
  orders,
  orderStatusHistory,
  payments,
  PAYMENT_METHODS,
  quoteRequests,
  users,
  type Order,
  type OrderStatus,
  type PricingUnit,
  type Role,
} from '../../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { computeLine, computeTotals, mulDivRound } from '../../lib/money.js';
import type { PhotoStore } from '../../lib/photos.js';
import { getSettings } from '../../lib/settings.js';
import { getCatalogItem } from '../catalog/service.js';
import { getCustomer, getCustomerAdminView, type CustomerAdminView } from '../customers/service.js';
import { materialLabel } from '../materials/service.js';
import { insertAttachments, listPhotos, withStoredPhotos, type PhotoView } from './attachments.js';
import { assertRequestCanBeQuoted, getQuoteRequest } from './requests.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const nowIso = () => new Date().toISOString();

/** Fecha de hoy en Colombia (UTC−5), AAAA-MM-DD. */
export const todayCo = (nowMs = Date.now()) => new Date(nowMs - 5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// ───────────────────────── Máquina de estados ─────────────────────────

/**
 * Transiciones permitidas y quién puede hacerlas.
 * - El CLIENTE solo acepta o rechaza su cotización (rutas propias, con verificación de vigencia).
 * - El EMPLEADO mueve el trabajo en el taller.
 * - El ADMIN puede todo, y es el único que cancela un trabajo ya aprobado.
 */
export const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, readonly Role[]>>> = {
  COTIZADO: { APROBADO: ['ADMIN', 'CLIENT'], CANCELADO: ['ADMIN', 'CLIENT'] },
  APROBADO: { EN_PROCESO: ['ADMIN', 'EMPLOYEE'], CANCELADO: ['ADMIN'] },
  EN_PROCESO: { TERMINADO: ['ADMIN', 'EMPLOYEE'], CANCELADO: ['ADMIN'] },
  TERMINADO: { ENTREGADO: ['ADMIN', 'EMPLOYEE'], EN_PROCESO: ['ADMIN', 'EMPLOYEE'] },
  ENTREGADO: {},
  CANCELADO: {},
};

/** Estados en los que se puede cargar material (cortes) a un trabajo. */
export const CUTTABLE_STATUSES: OrderStatus[] = ['APROBADO', 'EN_PROCESO'];

function getOrderRow(db: Pick<Db, 'select'>, id: number): Order {
  const o = db.select().from(orders).where(eq(orders.id, id)).get();
  if (!o) throw notFound('Pedido no encontrado.');
  return o;
}

function setStatus(tx: Tx, order: Order, to: OrderStatus, userId: number, note?: string | null) {
  tx.update(orders).set({ status: to, updatedAt: nowIso() }).where(eq(orders.id, order.id)).run();
  tx.insert(orderStatusHistory).values({ orderId: order.id, fromStatus: order.status, toStatus: to, note: note ?? null, userId }).run();
}

export function changeStatus(db: Db, actor: { id: number; role: Role }, orderId: number, to: OrderStatus, note?: string | null) {
  db.transaction((tx) => {
    const o = getOrderRow(tx, orderId);
    const roles = TRANSITIONS[o.status][to];
    if (!roles) throw conflict(`No se puede pasar de ${o.status} a ${to}.`, 'INVALID_TRANSITION');
    if (!roles.includes(actor.role)) throw forbidden('No tienes permiso para este cambio de estado.');
    if (to === 'CANCELADO' && !note) throw badRequest('Escribe el motivo de la cancelación.');
    if (to === 'APROBADO' && !hasItems(tx, o.id)) throw badRequest('La cotización no tiene ítems.');
    setStatus(tx, o, to, actor.id, note);
  });
}

const hasItems = (tx: Pick<Db, 'select'>, orderId: number) =>
  !!tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, orderId)).get();

// ───────────────────────── Cotizar ─────────────────────────

export interface ItemInput {
  catalogItemId?: number | null;
  description?: string;
  pricingUnit?: PricingUnit;
  quantityMilli: number;
  unitPrice?: number;
  discount?: number;
  taxRateBp?: number;
}

export interface QuoteInput {
  vehicleDesc?: string | null;
  description?: string | null;
  internalNotes?: string | null;
  quoteValidUntil?: string | null;
  items: ItemInput[];
}

function nextOrderCode(tx: Pick<Db, 'select'>): string {
  const row = tx
    .select({ n: sql<number | null>`max(cast(substr(${orders.code}, 3) as integer))` })
    .from(orders)
    .where(sql`${orders.code} GLOB 'T-[0-9]*'`)
    .get();
  return `T-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

/** Valida y calcula las líneas. Si viene del catálogo, completa lo que falte con sus datos. */
function buildItems(tx: Pick<Db, 'select'>, items: ItemInput[], defaultTax: number) {
  return items.map((it, i) => {
    const cat = it.catalogItemId ? getCatalogItem(tx, it.catalogItemId) : null;
    const description = (it.description?.trim() || cat?.name || '').slice(0, 200);
    if (!description) throw badRequest(`Línea ${i + 1}: escribe la descripción.`);
    const unitPrice = it.unitPrice ?? cat?.unitPrice;
    if (unitPrice === undefined) throw badRequest(`Línea ${i + 1}: escribe el precio.`);
    const line = {
      catalogItemId: cat?.id ?? null,
      description,
      pricingUnit: it.pricingUnit ?? cat?.pricingUnit ?? 'UNIDAD',
      quantityMilli: it.quantityMilli,
      unitPrice,
      discount: it.discount ?? 0,
      taxRateBp: it.taxRateBp ?? cat?.taxRateBp ?? defaultTax,
      sortOrder: i,
    };
    const amounts = computeLine(line);
    if (amounts.lineTotal < 0) throw badRequest(`Línea ${i + 1}: el descuento supera el valor de la línea.`);
    return { ...line, ...amounts };
  });
}

function writeQuote(tx: Tx, orderId: number, input: QuoteInput, defaultTax: number) {
  const lines = buildItems(tx, input.items, defaultTax);
  const totals = computeTotals(lines);
  tx.delete(orderItems).where(eq(orderItems.orderId, orderId)).run();
  for (const l of lines) {
    tx.insert(orderItems)
      .values({
        orderId,
        catalogItemId: l.catalogItemId,
        description: l.description,
        pricingUnit: l.pricingUnit,
        quantityMilli: l.quantityMilli,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxRateBp: l.taxRateBp,
        taxAmount: l.taxAmount,
        lineTotal: l.lineTotal,
        sortOrder: l.sortOrder,
      })
      .run();
  }
  tx.update(orders)
    .set({
      ...totals,
      ...(input.vehicleDesc !== undefined ? { vehicleDesc: input.vehicleDesc } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
      ...(input.quoteValidUntil !== undefined ? { quoteValidUntil: input.quoteValidUntil } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(orders.id, orderId))
    .run();
}

/** Crea una cotización: para un cliente del local o a partir de una solicitud web (que pasa a COTIZADA). */
export function createQuote(
  db: Db,
  actorId: number,
  input: QuoteInput & { customerId?: number; quoteRequestId?: number },
): number {
  const s = getSettings(db);
  return db.transaction((tx) => {
    let customerId = input.customerId;
    let vehicleDesc = input.vehicleDesc ?? null;
    let description = input.description ?? null;
    if (input.quoteRequestId) {
      const r = getQuoteRequest(tx, input.quoteRequestId);
      assertRequestCanBeQuoted(r);
      if (customerId && customerId !== r.customerId) throw badRequest('La solicitud es de otro cliente.');
      customerId = r.customerId;
      vehicleDesc ??= r.vehicleDesc;
      description ??= r.description;
      tx.update(quoteRequests).set({ status: 'COTIZADA', updatedAt: nowIso() }).where(eq(quoteRequests.id, r.id)).run();
    }
    if (!customerId) throw badRequest('Elige el cliente.');
    getCustomer(tx, customerId);

    const o = tx
      .insert(orders)
      .values({
        code: nextOrderCode(tx),
        customerId,
        quoteRequestId: input.quoteRequestId ?? null,
        status: 'COTIZADO',
        vehicleDesc,
        description,
        internalNotes: input.internalNotes ?? null,
        quoteValidUntil: input.quoteValidUntil ?? addDays(todayCo(), s.quoteValidDays),
        createdBy: actorId,
      })
      .returning()
      .get();
    tx.insert(orderStatusHistory).values({ orderId: o.id, fromStatus: null, toStatus: 'COTIZADO', userId: actorId }).run();
    writeQuote(tx, o.id, { items: input.items }, s.defaultTaxRateBp);
    return o.id;
  });
}

/** Reemplaza las líneas y el encabezado. Solo mientras sea una cotización (COTIZADO). */
export function updateQuote(db: Db, orderId: number, input: QuoteInput) {
  const s = getSettings(db);
  db.transaction((tx) => {
    const o = getOrderRow(tx, orderId);
    if (o.status !== 'COTIZADO') {
      throw conflict('Solo se puede modificar una cotización que el cliente no ha aceptado.', 'NOT_EDITABLE');
    }
    writeQuote(tx, o.id, input, s.defaultTaxRateBp);
  });
}

export function updateOrderMeta(db: Db, orderId: number, input: { invoiceNumber?: string | null; internalNotes?: string | null }) {
  getOrderRow(db, orderId);
  db.update(orders).set({ ...input, updatedAt: nowIso() }).where(eq(orders.id, orderId)).run();
}

// ───────────────────────── Cliente ─────────────────────────

function getOwnOrderRow(db: Pick<Db, 'select'>, customerId: number, id: number): Order {
  const o = db.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, customerId))).get();
  if (!o) throw notFound('Pedido no encontrado.');
  return o;
}

export function clientRespondQuote(db: Db, user: { id: number }, customerId: number, orderId: number, accept: boolean, note?: string | null) {
  db.transaction((tx) => {
    const o = getOwnOrderRow(tx, customerId, orderId);
    if (o.status !== 'COTIZADO') throw conflict('Esta cotización ya fue respondida.', 'INVALID_TRANSITION');
    if (accept) {
      if (o.quoteValidUntil && todayCo() > o.quoteValidUntil) {
        throw conflict('La cotización venció. Pide al local que la actualice.', 'QUOTE_EXPIRED');
      }
      if (!hasItems(tx, o.id)) throw badRequest('La cotización no tiene ítems.');
    }
    setStatus(tx, o, accept ? 'APROBADO' : 'CANCELADO', user.id, accept ? 'Aceptada por el cliente.' : (note || 'Rechazada por el cliente.'));
  });
}

// ───────────────────────── Pagos y fotos ─────────────────────────

export function paidAmount(db: Pick<Db, 'select'>, orderId: number): number {
  return db.select({ s: sql<number>`coalesce(sum(${payments.amount}), 0)` }).from(payments).where(eq(payments.orderId, orderId)).get()!.s;
}

export function addPayment(
  db: Db,
  actorId: number,
  orderId: number,
  input: { amount: number; method: (typeof PAYMENT_METHODS)[number]; note?: string | null },
) {
  db.transaction((tx) => {
    const o = getOrderRow(tx, orderId);
    if (o.status === 'CANCELADO') throw conflict('El pedido está cancelado.');
    const paid = paidAmount(tx, orderId);
    if (paid + input.amount > o.total) {
      throw badRequest(`El pago supera el saldo pendiente (${(o.total - paid).toLocaleString('es-CO')} pesos).`, 'OVERPAYMENT');
    }
    tx.insert(payments).values({ orderId, amount: input.amount, method: input.method, note: input.note ?? null, userId: actorId }).run();
  });
}

export async function addOrderPhotos(db: Db, store: PhotoStore, userId: number, orderId: number, files: Buffer[]) {
  const o = getOrderRow(db, orderId);
  if (files.length === 0) throw badRequest('Adjunta al menos una foto.');
  const existing = listPhotos(db, { orderId }).filter((p) => p.source === 'ORDER').length;
  if (existing + files.length > 20) throw badRequest('Un pedido puede tener máximo 20 fotos del local.');
  await withStoredPhotos(store, files, (photos) => db.transaction((tx) => insertAttachments(tx, { orderId: o.id }, photos, userId)));
}

// ───────────────────────── Consultas ─────────────────────────

export interface OrderFilter {
  status?: OrderStatus[];
  customerId?: number;
  q?: string;
}

function listRows(db: Db, f: OrderFilter) {
  const conds: SQL[] = [];
  if (f.status?.length) conds.push(inArray(orders.status, f.status));
  if (f.customerId) conds.push(eq(orders.customerId, f.customerId));
  if (f.q) {
    const p = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(orders.code, p), like(customers.fullName, p), like(customers.phone, p), like(orders.vehicleDesc, p))!);
  }
  return db
    .select({ o: orders, customerName: customers.fullName, customerPhone: customers.phone })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(orders.id))
    .limit(300)
    .all();
}

/** Para el personal: SIN dinero (el empleado no ve precios ni costos). */
export interface OrderStaffSummary {
  id: number;
  code: string;
  status: OrderStatus;
  customerName: string;
  vehicleDesc: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listOrdersStaff(db: Db, f: OrderFilter): OrderStaffSummary[] {
  return listRows(db, f).map(({ o, customerName }) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    customerName,
    vehicleDesc: o.vehicleDesc,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }));
}

export interface OrderAdminSummary extends OrderStaffSummary {
  customerId: number;
  total: number;
  paid: number;
  invoiceNumber: string | null;
}

export function listOrdersAdmin(db: Db, f: OrderFilter): OrderAdminSummary[] {
  const rows = listRows(db, f);
  const ids = rows.map((r) => r.o.id);
  const paid = ids.length
    ? new Map(
        db
          .select({ id: payments.orderId, s: sql<number>`sum(${payments.amount})` })
          .from(payments)
          .where(inArray(payments.orderId, ids))
          .groupBy(payments.orderId)
          .all()
          .map((r) => [r.id, r.s]),
      )
    : new Map<number, number>();
  return rows.map(({ o, customerName }) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    customerId: o.customerId,
    customerName,
    vehicleDesc: o.vehicleDesc,
    total: o.total,
    paid: paid.get(o.id) ?? 0,
    invoiceNumber: o.invoiceNumber,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }));
}

function itemsOf(db: Pick<Db, 'select'>, orderId: number) {
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.sortOrder), asc(orderItems.id)).all();
}

function historyOf(db: Db, orderId: number) {
  return db
    .select({
      id: orderStatusHistory.id,
      fromStatus: orderStatusHistory.fromStatus,
      toStatus: orderStatusHistory.toStatus,
      note: orderStatusHistory.note,
      userName: users.fullName,
      createdAt: orderStatusHistory.createdAt,
    })
    .from(orderStatusHistory)
    .innerJoin(users, eq(users.id, orderStatusHistory.userId))
    .where(eq(orderStatusHistory.orderId, orderId))
    .orderBy(asc(orderStatusHistory.id))
    .all();
}

function paymentsOf(db: Db, orderId: number) {
  return db
    .select({ id: payments.id, amount: payments.amount, method: payments.method, note: payments.note, userName: users.fullName, createdAt: payments.createdAt })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.userId))
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.id))
    .all();
}

const photosOf = (db: Db, o: Order): PhotoView[] => listPhotos(db, { quoteRequestId: o.quoteRequestId, orderId: o.id });

/** Material cargado al trabajo. Los retazos guardados vuelven al stock, así que no cuentan como consumo. */
function cutsOf(db: Db, orderId: number) {
  return db
    .select({ cut: cuts, unitCode: inventoryUnits.code, material: materials, userName: users.fullName })
    .from(cuts)
    .innerJoin(inventoryUnits, eq(inventoryUnits.id, cuts.unitId))
    .innerJoin(materials, eq(materials.id, inventoryUnits.materialId))
    .innerJoin(users, eq(users.id, cuts.userId))
    .where(eq(cuts.orderId, orderId))
    .orderBy(asc(cuts.id))
    .all()
    .map(({ cut, unitCode, material, userName }) => {
      const real = cut.method === 'FREEHAND' ? (cut.reconciledAreaMm2 ?? cut.cutAreaMm2) : cut.cutAreaMm2;
      const consumed = Math.max(0, real - cut.remnantAreaMm2);
      return {
        id: cut.id,
        unitCode,
        materialLabel: materialLabel(material),
        method: cut.method,
        consumedAreaMm2: consumed,
        estimated: cut.method === 'FREEHAND' && cut.reconciledAreaMm2 === null,
        userName,
        createdAt: cut.createdAt,
        costPerM2: material.costPerM2,
      };
    });
}

/** Vista del personal: SIN precios, pagos ni costos. */
export function getOrderStaff(db: Db, id: number) {
  const o = getOrderRow(db, id);
  const c = getCustomer(db, o.customerId);
  return {
    order: {
      id: o.id,
      code: o.code,
      status: o.status,
      vehicleDesc: o.vehicleDesc,
      description: o.description,
      internalNotes: o.internalNotes,
      quoteRequestId: o.quoteRequestId,
      createdAt: o.createdAt,
    },
    customer: { id: c.id, fullName: c.fullName, phone: c.phone },
    items: itemsOf(db, id).map((i) => ({ id: i.id, description: i.description, pricingUnit: i.pricingUnit, quantityMilli: i.quantityMilli })),
    history: historyOf(db, id),
    photos: photosOf(db, o),
    cuts: cutsOf(db, id).map(({ costPerM2: _c, ...rest }) => rest),
  };
}

export function getOrderAdmin(db: Db, id: number) {
  const o = getOrderRow(db, id);
  const customer: CustomerAdminView = getCustomerAdminView(db, o.customerId);
  const cutList = cutsOf(db, id);
  const materialCost = cutList.reduce((a, c) => a + (c.costPerM2 === null ? 0 : mulDivRound(c.consumedAreaMm2, c.costPerM2, 1_000_000)), 0);
  const paid = paidAmount(db, id);
  return {
    order: o,
    customer,
    items: itemsOf(db, id),
    history: historyOf(db, id),
    payments: paymentsOf(db, id),
    paid,
    balance: o.total - paid,
    photos: photosOf(db, o),
    cuts: cutList,
    materialCost,
    /** El costo es aproximado si algún corte a pulso no se ha conciliado o algún material no tiene costo. */
    materialCostEstimated: cutList.some((c) => c.estimated || c.costPerM2 === null),
    /** Margen aproximado sobre el subtotal (sin IVA). */
    margin: o.subtotal - materialCost,
  };
}

/** Vista del cliente: sus precios y pagos, pero nunca notas internas, cortes ni costos. */
export function getOrderClient(db: Db, customerId: number, id: number) {
  const o = getOwnOrderRow(db, customerId, id);
  const paid = paidAmount(db, id);
  return {
    order: {
      id: o.id,
      code: o.code,
      status: o.status,
      vehicleDesc: o.vehicleDesc,
      description: o.description,
      subtotal: o.subtotal,
      discount: o.discount,
      taxTotal: o.taxTotal,
      total: o.total,
      invoiceNumber: o.invoiceNumber,
      quoteValidUntil: o.quoteValidUntil,
      quoteRequestId: o.quoteRequestId,
      createdAt: o.createdAt,
    },
    items: itemsOf(db, id).map((i) => ({
      id: i.id,
      description: i.description,
      pricingUnit: i.pricingUnit,
      quantityMilli: i.quantityMilli,
      unitPrice: i.unitPrice,
      discount: i.discount,
      taxRateBp: i.taxRateBp,
      taxAmount: i.taxAmount,
      lineTotal: i.lineTotal,
    })),
    history: historyOf(db, id).map(({ userName: _u, ...h }) => h),
    payments: paymentsOf(db, id).map((p) => ({ id: p.id, amount: p.amount, method: p.method, createdAt: p.createdAt })),
    paid,
    balance: o.total - paid,
    photos: photosOf(db, o),
    canRespond: o.status === 'COTIZADO',
    expired: o.status === 'COTIZADO' && !!o.quoteValidUntil && todayCo() > o.quoteValidUntil,
  };
}

export function listOrdersClient(db: Db, customerId: number) {
  return db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.id))
    .limit(200)
    .all()
    .map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      vehicleDesc: o.vehicleDesc,
      total: o.total,
      quoteValidUntil: o.quoteValidUntil,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));
}

/** Para vincular un corte: el pedido debe existir y estar aprobado o en proceso. */
export function assertOrderCuttable(db: Pick<Db, 'select'>, orderId: number) {
  const o = getOrderRow(db, orderId);
  if (!CUTTABLE_STATUSES.includes(o.status)) {
    throw conflict(`El pedido ${o.code} no está aprobado ni en proceso; no se le puede cargar material.`, 'ORDER_NOT_ACTIVE');
  }
}
