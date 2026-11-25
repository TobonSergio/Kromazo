import { and, asc, count, eq, like, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { customers, orders, type Customer, type DocumentType } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';

/**
 * Dígito de verificación del NIT (algoritmo de la DIAN): pesos primos de derecha a izquierda, módulo 11.
 */
export function nitCheckDigit(nit: string): number {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digits = nit.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > weights.length) throw badRequest('NIT inválido.');
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * weights[i]!;
  const r = sum % 11;
  return r >= 2 ? 11 - r : r;
}

export interface BillingInput {
  documentType?: DocumentType | null;
  documentNumber?: string | null;
  billingEmail?: string | null;
}

/** Normaliza el documento y calcula el dígito de verificación si es NIT. */
function billingFields(b: BillingInput, current?: Customer) {
  const type = b.documentType !== undefined ? b.documentType : (current?.documentType ?? null);
  let number = b.documentNumber !== undefined ? b.documentNumber : (current?.documentNumber ?? null);
  if (number !== null) {
    number = type === 'NIT' || type === 'CC' ? number.replace(/\D/g, '') : number.replace(/\s/g, '').toUpperCase();
    if (number === '') number = null;
  }
  if (number && !type) throw badRequest('Elige el tipo de documento.');
  if (type === 'NIT' && number && number.length > 15) throw badRequest('NIT inválido.');
  return {
    documentType: number ? type : null,
    documentNumber: number,
    nitCheckDigit: type === 'NIT' && number ? nitCheckDigit(number) : null,
    ...(b.billingEmail !== undefined ? { billingEmail: b.billingEmail } : {}),
  };
}

/** Lo que ve el propio cliente: sin notas internas. */
export interface CustomerClientView {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  documentType: DocumentType | null;
  documentNumber: string | null;
  nitCheckDigit: number | null;
  billingEmail: string | null;
}

export interface CustomerAdminView extends CustomerClientView {
  userId: number | null;
  hasAccount: boolean;
  notes: string | null;
  orderCount: number;
  createdAt: string;
}

export const toClientView = (c: Customer): CustomerClientView => ({
  id: c.id,
  fullName: c.fullName,
  phone: c.phone,
  email: c.email,
  documentType: c.documentType,
  documentNumber: c.documentNumber,
  nitCheckDigit: c.nitCheckDigit,
  billingEmail: c.billingEmail,
});

const toAdminView = (c: Customer, orderCount: number): CustomerAdminView => ({
  ...toClientView(c),
  userId: c.userId,
  hasAccount: c.userId !== null,
  notes: c.notes,
  orderCount,
  createdAt: c.createdAt,
});

export function getCustomer(db: Pick<Db, 'select'>, id: number): Customer {
  const c = db.select().from(customers).where(eq(customers.id, id)).get();
  if (!c) throw notFound('Cliente no encontrado.');
  return c;
}

/** Ficha de cliente del usuario con sesión. Todas las rutas de cliente filtran por aquí. */
export function getOwnCustomer(db: Pick<Db, 'select'>, userId: number): Customer {
  const c = db.select().from(customers).where(eq(customers.userId, userId)).get();
  if (!c) throw notFound('Tu cuenta no tiene ficha de cliente. Comunícate con el local.');
  return c;
}

export function listCustomers(db: Db, q?: string): CustomerAdminView[] {
  const conds: SQL[] = [];
  if (q) {
    const p = `%${q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(customers.fullName, p), like(customers.phone, p), like(customers.email, p), like(customers.documentNumber, p))!);
  }
  const rows = db
    .select({ c: customers, n: count(orders.id) })
    .from(customers)
    .leftJoin(orders, eq(orders.customerId, customers.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(customers.id)
    .orderBy(asc(customers.fullName))
    .limit(500)
    .all();
  return rows.map((r) => toAdminView(r.c, r.n));
}

export function getCustomerAdminView(db: Db, id: number): CustomerAdminView {
  const c = getCustomer(db, id);
  const n = db.select({ n: count() }).from(orders).where(eq(orders.customerId, id)).get()!.n;
  return toAdminView(c, n);
}

export interface CustomerInput extends BillingInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

/** Cliente sin cuenta (el que llega al local). */
export function createCustomer(db: Db, input: CustomerInput): CustomerAdminView {
  const c = db
    .insert(customers)
    .values({
      fullName: input.fullName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
      ...billingFields(input),
    })
    .returning()
    .get();
  return toAdminView(c, 0);
}

export function updateCustomer(db: Db, id: number, input: Partial<CustomerInput>): CustomerAdminView {
  const current = getCustomer(db, id);
  if (current.userId !== null && (input.fullName !== undefined || input.phone !== undefined || input.email !== undefined)) {
    throw badRequest('El nombre, celular y correo de un cliente con cuenta los cambia él desde «Mi cuenta».', 'LINKED_CUSTOMER');
  }
  const { documentType, documentNumber, billingEmail, ...rest } = input;
  db.update(customers)
    .set({ ...rest, ...billingFields({ documentType, documentNumber, billingEmail }, current) })
    .where(eq(customers.id, id))
    .run();
  return getCustomerAdminView(db, id);
}

/** El cliente actualiza sus propios datos de facturación. */
export function updateOwnBilling(db: Db, userId: number, input: BillingInput): CustomerClientView {
  const current = getOwnCustomer(db, userId);
  db.update(customers).set(billingFields(input, current)).where(eq(customers.id, current.id)).run();
  return toClientView(getCustomer(db, current.id));
}
