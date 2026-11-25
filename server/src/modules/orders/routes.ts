import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  CATALOG_KINDS,
  DOCUMENT_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PRICING_UNITS,
  QUOTE_REQUEST_STATUSES,
} from '../../db/schema.js';
import { requireUser } from '../../auth/plugin.js';
import { audit } from '../../lib/audit.js';
import { badRequest } from '../../lib/errors.js';
import { MAX_PHOTOS, readMultipart, type PhotoStore } from '../../lib/photos.js';
import { emailSchema, fullNameSchema, idParamSchema, parse, phoneSchema } from '../../lib/validation.js';
import { createCatalogItem, listCatalogAdmin, listPublicCatalog, updateCatalogItem } from '../catalog/service.js';
import {
  createCustomer,
  getCustomerAdminView,
  getOwnCustomer,
  listCustomers,
  toClientView,
  updateCustomer,
  updateOwnBilling,
} from '../customers/service.js';
import { authorizeAttachment } from './attachments.js';
import {
  createQuoteRequest,
  discardQuoteRequest,
  getOwnQuoteRequest,
  getQuoteRequestStaff,
  listOwnQuoteRequests,
  listQuoteRequestsStaff,
  withdrawOwnQuoteRequest,
} from './requests.js';
import {
  addOrderPhotos,
  addPayment,
  changeStatus,
  clientRespondQuote,
  createQuote,
  getOrderAdmin,
  getOrderClient,
  getOrderStaff,
  listOrdersAdmin,
  listOrdersClient,
  listOrdersStaff,
  updateOrderMeta,
  updateQuote,
} from './service.js';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const optEmail = z
  .union([z.literal('').transform(() => null), emailSchema])
  .nullable()
  .optional();
const MAX_PRICE = 500_000_000;
const taxRate = z.union([z.literal(0), z.literal(500), z.literal(1900)]);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');

const billingSchema = {
  documentType: z.enum(DOCUMENT_TYPES).nullable().optional(),
  documentNumber: optText(20),
  billingEmail: optEmail,
};

const customerSchema = z
  .object({ fullName: fullNameSchema, phone: phoneSchema, email: optEmail, notes: optText(1000), ...billingSchema })
  .strict();

const catalogSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: optText(1000),
    kind: z.enum(CATALOG_KINDS),
    pricingUnit: z.enum(PRICING_UNITS),
    unitPrice: z.number().int().min(0).max(MAX_PRICE),
    taxRateBp: taxRate.optional(),
    materialId: z.number().int().positive().nullable().optional(),
    isPublic: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

const itemSchema = z
  .object({
    catalogItemId: z.number().int().positive().nullable().optional(),
    description: z.string().trim().max(200).optional(),
    pricingUnit: z.enum(PRICING_UNITS).optional(),
    /** Cantidad en milésimas: 1500 = 1,5. Máximo 10.000 unidades. */
    quantityMilli: z.number().int().positive().max(10_000_000),
    unitPrice: z.number().int().min(0).max(MAX_PRICE).optional(),
    discount: z.number().int().min(0).max(MAX_PRICE).optional(),
    taxRateBp: taxRate.optional(),
  })
  .strict();

const quoteBody = {
  vehicleDesc: optText(120),
  description: optText(2000),
  internalNotes: optText(2000),
  quoteValidUntil: ymd.nullable().optional(),
  items: z.array(itemSchema).min(1, 'Agrega al menos una línea.').max(50),
};

const orderListQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(z.enum(ORDER_STATUSES)).optional()),
  customerId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(60).optional(),
});

const requestFields = z.object({
  vehicleDesc: z.string().trim().min(3, 'Describe la moto (marca, modelo, color).').max(120),
  description: z.string().trim().min(10, 'Cuéntanos con más detalle qué quieres (mínimo 10 caracteres).').max(2000),
});

export function orderRoutes(app: FastifyInstance, { db, store }: { db: Db; store: PhotoStore }) {
  const pub = { config: { access: 'public' as const } };
  const authed = { config: { access: 'authenticated' as const } };
  const client = { config: { access: 'CLIENT' as const } };
  const staff = { config: { access: 'STAFF' as const } };
  const admin = { config: { access: 'ADMIN' as const } };
  const own = (req: Parameters<typeof requireUser>[0]) => getOwnCustomer(db, requireUser(req).user.id);

  // ───── Público ─────

  app.get('/api/public/catalog', pub, async () => ({ items: listPublicCatalog(db) }));

  // ───── Fotos (con control de acceso) ─────

  app.get('/api/attachments/:id', authed, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    const key = authorizeAttachment(db, id, requireUser(req).user);
    return reply
      .type('image/jpeg')
      .header('Content-Disposition', `inline; filename="foto-${id}.jpg"`)
      .header('Cache-Control', 'private, max-age=86400')
      .send(store.read(key));
  });

  // ───── Cliente: solo sus propios datos ─────

  app.get('/api/client/profile', client, async (req) => ({ customer: toClientView(own(req)) }));

  app.patch('/api/client/profile', client, async (req) => {
    const body = parse(z.object(billingSchema).strict(), req.body);
    return { customer: updateOwnBilling(db, requireUser(req).user.id, body) };
  });

  app.get('/api/client/quote-requests', client, async (req) => ({ requests: listOwnQuoteRequests(db, own(req).id) }));

  app.get('/api/client/quote-requests/:id', client, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { request: getOwnQuoteRequest(db, own(req).id, id) };
  });

  app.post(
    '/api/client/quote-requests',
    { config: { access: 'CLIENT', multipart: true, rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const user = requireUser(req).user;
      const customer = own(req);
      const { fields, files } = await readMultipart(req);
      const body = parse(requestFields, fields);
      if (files.length === 0) throw badRequest(`Adjunta al menos una foto de la moto (máximo ${MAX_PHOTOS}).`);
      const request = await createQuoteRequest(db, store, user, customer.id, body, files);
      return reply.code(201).send({ request });
    },
  );

  app.post('/api/client/quote-requests/:id/withdraw', client, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { request: withdrawOwnQuoteRequest(db, own(req).id, id) };
  });

  app.get('/api/client/orders', client, async (req) => ({ orders: listOrdersClient(db, own(req).id) }));

  app.get('/api/client/orders/:id', client, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return getOrderClient(db, own(req).id, id);
  });

  app.post('/api/client/orders/:id/accept', client, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    const customer = own(req);
    clientRespondQuote(db, requireUser(req).user, customer.id, id, true);
    return getOrderClient(db, customer.id, id);
  });

  app.post('/api/client/orders/:id/reject', client, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    const { reason } = parse(z.object({ reason: optText(300) }).strict(), req.body ?? {});
    const customer = own(req);
    clientRespondQuote(db, requireUser(req).user, customer.id, id, false, reason);
    return getOrderClient(db, customer.id, id);
  });

  // ───── Personal del local (sin precios ni costos) ─────

  app.get('/api/staff/quote-requests', staff, async (req) => {
    const { status } = parse(z.object({ status: z.enum(QUOTE_REQUEST_STATUSES).optional() }), req.query);
    return { requests: listQuoteRequestsStaff(db, { status }) };
  });

  app.get('/api/staff/quote-requests/:id', staff, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { request: getQuoteRequestStaff(db, id) };
  });

  app.get('/api/staff/orders', staff, async (req) => ({ orders: listOrdersStaff(db, parse(orderListQuery, req.query)) }));

  app.get('/api/staff/orders/:id', staff, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return getOrderStaff(db, id);
  });

  app.post('/api/staff/orders/:id/status', staff, async (req) => {
    const user = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const { to, note } = parse(z.object({ to: z.enum(ORDER_STATUSES), note: optText(300) }).strict(), req.body);
    changeStatus(db, user, id, to, note);
    if (to === 'CANCELADO') {
      audit(db, { actorUserId: user.id, action: 'order.cancel', entity: 'order', entityId: id, details: { note }, ip: req.ip });
    }
    return getOrderStaff(db, id);
  });

  app.post('/api/staff/orders/:id/photos', { config: { access: 'STAFF', multipart: true } }, async (req, reply) => {
    const user = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const { files } = await readMultipart(req);
    await addOrderPhotos(db, store, user.id, id, files);
    return reply.code(201).send(getOrderStaff(db, id));
  });

  // ───── Solo admin ─────

  app.get('/api/admin/customers', admin, async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), req.query);
    return { customers: listCustomers(db, q) };
  });

  app.get('/api/admin/customers/:id', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { customer: getCustomerAdminView(db, id), orders: listOrdersAdmin(db, { customerId: id }) };
  });

  app.post('/api/admin/customers', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const customer = createCustomer(db, parse(customerSchema, req.body));
    audit(db, { actorUserId: actor.id, action: 'customer.create', entity: 'customer', entityId: customer.id, ip: req.ip });
    return reply.code(201).send({ customer });
  });

  app.patch('/api/admin/customers/:id', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { customer: updateCustomer(db, id, parse(customerSchema.partial(), req.body)) };
  });

  app.get('/api/admin/catalog', admin, async () => ({ items: listCatalogAdmin(db) }));

  app.post('/api/admin/catalog', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const item = createCatalogItem(db, parse(catalogSchema, req.body));
    audit(db, { actorUserId: actor.id, action: 'catalog.create', entity: 'catalog_item', entityId: item.id, details: { name: item.name, unitPrice: item.unitPrice }, ip: req.ip });
    return reply.code(201).send({ item });
  });

  app.patch('/api/admin/catalog/:id', admin, async (req) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const body = parse(catalogSchema.partial(), req.body);
    const { before, after } = updateCatalogItem(db, id, body);
    const details: Record<string, unknown> = { ...body };
    if (body.unitPrice !== undefined && body.unitPrice !== before.unitPrice) details.previousUnitPrice = before.unitPrice;
    audit(db, { actorUserId: actor.id, action: 'catalog.update', entity: 'catalog_item', entityId: id, details, ip: req.ip });
    return { item: after };
  });

  app.post('/api/admin/quote-requests/:id/discard', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Escribe el motivo; el cliente lo verá.').max(300) }).strict(), req.body);
    return { request: discardQuoteRequest(db, id, reason) };
  });

  app.get('/api/admin/orders', admin, async (req) => ({ orders: listOrdersAdmin(db, parse(orderListQuery, req.query)) }));

  app.get('/api/admin/orders/:id', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return getOrderAdmin(db, id);
  });

  app.post('/api/admin/orders', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const body = parse(
      z
        .object({
          customerId: z.number().int().positive().optional(),
          quoteRequestId: z.number().int().positive().optional(),
          ...quoteBody,
        })
        .strict(),
      req.body,
    );
    const id = createQuote(db, actor.id, body);
    audit(db, { actorUserId: actor.id, action: 'order.quote', entity: 'order', entityId: id, ip: req.ip });
    return reply.code(201).send(getOrderAdmin(db, id));
  });

  app.put('/api/admin/orders/:id/quote', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    updateQuote(db, id, parse(z.object(quoteBody).strict(), req.body));
    return getOrderAdmin(db, id);
  });

  app.patch('/api/admin/orders/:id', admin, async (req) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const body = parse(z.object({ invoiceNumber: optText(40), internalNotes: optText(2000) }).strict(), req.body);
    updateOrderMeta(db, id, body);
    if (body.invoiceNumber !== undefined) {
      audit(db, { actorUserId: actor.id, action: 'order.invoice', entity: 'order', entityId: id, details: body, ip: req.ip });
    }
    return getOrderAdmin(db, id);
  });

  app.post('/api/admin/orders/:id/payments', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const body = parse(
      z.object({ amount: z.number().int().positive().max(MAX_PRICE), method: z.enum(PAYMENT_METHODS), note: optText(300) }).strict(),
      req.body,
    );
    addPayment(db, actor.id, id, body);
    audit(db, { actorUserId: actor.id, action: 'order.payment', entity: 'order', entityId: id, details: body, ip: req.ip });
    return reply.code(201).send(getOrderAdmin(db, id));
  });
}
