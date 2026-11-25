import { asc, eq, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { attachments, customers, orders, quoteRequests, type User } from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import { processPhoto, type PhotoStore } from '../../lib/photos.js';

export interface PhotoView {
  id: number;
  url: string;
  width: number;
  height: number;
  /** De dónde viene: la solicitud del cliente o el local (antes/después). */
  source: 'REQUEST' | 'ORDER';
  createdAt: string;
}

export function listPhotos(db: Db, f: { quoteRequestId?: number | null; orderId?: number | null }): PhotoView[] {
  const conds: SQL[] = [];
  if (f.quoteRequestId) conds.push(eq(attachments.quoteRequestId, f.quoteRequestId));
  if (f.orderId) conds.push(eq(attachments.orderId, f.orderId));
  if (conds.length === 0) return [];
  return db
    .select()
    .from(attachments)
    .where(or(...conds))
    .orderBy(asc(attachments.id))
    .all()
    .map((a) => ({
      id: a.id,
      url: `/api/attachments/${a.id}`,
      width: a.widthPx,
      height: a.heightPx,
      source: a.orderId ? 'ORDER' : 'REQUEST',
      createdAt: a.createdAt,
    }));
}

/**
 * Procesa las fotos (fuera de la transacción: es lento), las escribe en disco y luego ejecuta `insert`
 * dentro de una transacción con las claves ya guardadas. Si algo falla, borra los archivos escritos.
 */
export async function withStoredPhotos<T>(
  store: PhotoStore,
  files: Buffer[],
  insert: (photos: { key: string; size: number; width: number; height: number }[]) => T,
): Promise<T> {
  const processed = [];
  for (const f of files) processed.push(await processPhoto(f));
  const saved: { key: string; size: number; width: number; height: number }[] = [];
  try {
    for (const p of processed) saved.push({ key: store.save(p.buffer), size: p.buffer.length, width: p.width, height: p.height });
    return insert(saved);
  } catch (err) {
    for (const s of saved) store.remove(s.key);
    throw err;
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function insertAttachments(
  tx: Tx,
  owner: { quoteRequestId: number } | { orderId: number },
  photos: { key: string; size: number; width: number; height: number }[],
  userId: number,
) {
  for (const p of photos) {
    tx.insert(attachments)
      .values({
        ...owner,
        storageKey: p.key,
        mimeType: 'image/jpeg',
        sizeBytes: p.size,
        widthPx: p.width,
        heightPx: p.height,
        uploadedBy: userId,
      })
      .run();
  }
}

/**
 * Devuelve la clave en disco si el usuario puede ver la foto: el personal del local siempre;
 * un cliente, solo si la solicitud o el pedido son suyos. Si no, 404 (no se revela que existe).
 */
export function authorizeAttachment(db: Db, id: number, user: User): string {
  const a = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!a) throw notFound('Foto no encontrada.');
  if (user.role === 'ADMIN' || user.role === 'EMPLOYEE') return a.storageKey;

  const own = db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).get();
  if (!own) throw notFound('Foto no encontrada.');
  if (a.quoteRequestId) {
    const r = db.select({ c: quoteRequests.customerId }).from(quoteRequests).where(eq(quoteRequests.id, a.quoteRequestId)).get();
    if (r?.c === own.id) return a.storageKey;
  }
  if (a.orderId) {
    const o = db.select({ c: orders.customerId }).from(orders).where(eq(orders.id, a.orderId)).get();
    if (o?.c === own.id) return a.storageKey;
  }
  throw notFound('Foto no encontrada.');
}
