import { and, count, desc, eq, gte, inArray, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { customers, orders, quoteRequests, type OrderStatus, type QuoteRequest, type QuoteRequestStatus } from '../../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import type { PhotoStore } from '../../lib/photos.js';
import { getSettings } from '../../lib/settings.js';
import { insertAttachments, listPhotos, withStoredPhotos, type PhotoView } from './attachments.js';

const nowIso = () => new Date().toISOString();

export interface QuoteRequestView {
  id: number;
  status: QuoteRequestStatus;
  vehicleDesc: string;
  description: string;
  discardReason: string | null;
  createdAt: string;
  photos: PhotoView[];
  order: { id: number; code: string; status: OrderStatus } | null;
}

export interface QuoteRequestStaffView extends QuoteRequestView {
  customer: { id: number; fullName: string; phone: string | null; email: string | null };
}

function linkedOrder(db: Db, requestId: number) {
  return db
    .select({ id: orders.id, code: orders.code, status: orders.status })
    .from(orders)
    .where(eq(orders.quoteRequestId, requestId))
    .get() ?? null;
}

function toView(db: Db, r: QuoteRequest): QuoteRequestView {
  return {
    id: r.id,
    status: r.status,
    vehicleDesc: r.vehicleDesc,
    description: r.description,
    discardReason: r.discardReason,
    createdAt: r.createdAt,
    photos: listPhotos(db, { quoteRequestId: r.id }),
    order: linkedOrder(db, r.id),
  };
}

export function getQuoteRequest(db: Pick<Db, 'select'>, id: number): QuoteRequest {
  const r = db.select().from(quoteRequests).where(eq(quoteRequests.id, id)).get();
  if (!r) throw notFound('Solicitud no encontrada.');
  return r;
}

// ───── Cliente ─────

export async function createQuoteRequest(
  db: Db,
  store: PhotoStore,
  user: { id: number },
  customerId: number,
  input: { vehicleDesc: string; description: string },
  files: Buffer[],
): Promise<QuoteRequestView> {
  const s = getSettings(db);
  const open = db
    .select({ n: count() })
    .from(quoteRequests)
    .where(and(eq(quoteRequests.customerId, customerId), eq(quoteRequests.status, 'NUEVA')))
    .get()!.n;
  if (open >= s.maxOpenQuoteRequests) {
    throw conflict(`Ya tienes ${open} solicitudes pendientes. Espera a que el local las responda.`, 'TOO_MANY_OPEN');
  }
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const today = db
    .select({ n: count() })
    .from(quoteRequests)
    .where(and(eq(quoteRequests.customerId, customerId), gte(quoteRequests.createdAt, dayAgo)))
    .get()!.n;
  if (today >= s.quoteRequestsPerDay) {
    throw new AppError(429, 'DAILY_LIMIT', 'Llegaste al límite de solicitudes por hoy. Intenta mañana.');
  }

  const id = await withStoredPhotos(store, files, (photos) =>
    db.transaction((tx) => {
      const r = tx
        .insert(quoteRequests)
        .values({ customerId, vehicleDesc: input.vehicleDesc, description: input.description })
        .returning()
        .get();
      insertAttachments(tx, { quoteRequestId: r.id }, photos, user.id);
      return r.id;
    }),
  );
  return toView(db, getQuoteRequest(db, id));
}

export function listOwnQuoteRequests(db: Db, customerId: number): QuoteRequestView[] {
  return db
    .select()
    .from(quoteRequests)
    .where(eq(quoteRequests.customerId, customerId))
    .orderBy(desc(quoteRequests.id))
    .limit(100)
    .all()
    .map((r) => toView(db, r));
}

/** 404 si la solicitud no es del cliente: no se revela que existe. */
export function getOwnQuoteRequest(db: Db, customerId: number, id: number): QuoteRequestView {
  const r = db.select().from(quoteRequests).where(and(eq(quoteRequests.id, id), eq(quoteRequests.customerId, customerId))).get();
  if (!r) throw notFound('Solicitud no encontrada.');
  return toView(db, r);
}

export function withdrawOwnQuoteRequest(db: Db, customerId: number, id: number): QuoteRequestView {
  const r = getOwnQuoteRequest(db, customerId, id);
  if (r.status !== 'NUEVA') throw conflict('Solo puedes retirar una solicitud que aún no ha sido cotizada.');
  db.update(quoteRequests)
    .set({ status: 'DESCARTADA', discardReason: 'Retirada por el cliente.', updatedAt: nowIso() })
    .where(eq(quoteRequests.id, id))
    .run();
  return getOwnQuoteRequest(db, customerId, id);
}

// ───── Personal del local ─────

export function listQuoteRequestsStaff(db: Db, f: { status?: QuoteRequestStatus }): QuoteRequestStaffView[] {
  const conds: SQL[] = [];
  if (f.status) conds.push(eq(quoteRequests.status, f.status));
  const rows = db
    .select({ r: quoteRequests, c: customers })
    .from(quoteRequests)
    .innerJoin(customers, eq(customers.id, quoteRequests.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(quoteRequests.id))
    .limit(200)
    .all();
  return rows.map(({ r, c }) => ({
    ...toView(db, r),
    customer: { id: c.id, fullName: c.fullName, phone: c.phone, email: c.email },
  }));
}

export function getQuoteRequestStaff(db: Db, id: number): QuoteRequestStaffView {
  const r = getQuoteRequest(db, id);
  const c = db.select().from(customers).where(eq(customers.id, r.customerId)).get()!;
  return { ...toView(db, r), customer: { id: c.id, fullName: c.fullName, phone: c.phone, email: c.email } };
}

export function discardQuoteRequest(db: Db, id: number, reason: string): QuoteRequestStaffView {
  const r = getQuoteRequest(db, id);
  if (r.status !== 'NUEVA') throw conflict('Solo se puede descartar una solicitud nueva.');
  db.update(quoteRequests).set({ status: 'DESCARTADA', discardReason: reason, updatedAt: nowIso() }).where(eq(quoteRequests.id, id)).run();
  return getQuoteRequestStaff(db, id);
}

export function countNewQuoteRequests(db: Db): number {
  return db.select({ n: count() }).from(quoteRequests).where(inArray(quoteRequests.status, ['NUEVA'])).get()!.n;
}

export const assertRequestCanBeQuoted = (r: QuoteRequest) => {
  if (r.status !== 'NUEVA') throw badRequest('Esa solicitud ya fue cotizada o descartada.');
};
