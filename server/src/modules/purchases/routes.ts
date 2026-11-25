import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { requireUser } from '../../auth/plugin.js';
import { audit } from '../../lib/audit.js';
import { emailSchema, idParamSchema, parse, phoneSchema } from '../../lib/validation.js';
import { todayCo } from '../orders/service.js';
import { freehandReport, marginReport, salesReport, shortageReport, stockReport, wasteReport } from '../reports/service.js';
import { createPurchase, createSupplier, getPurchase, listPurchases, listSuppliers, updateSupplier } from './service.js';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');
const mm = z.number().int().positive().max(1_000_000);

const supplierSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    email: z.union([z.literal('').transform(() => null), emailSchema]).nullable().optional(),
    notes: optText(1000),
    isActive: z.boolean().optional(),
  })
  .strict();

const purchaseSchema = z
  .object({
    supplierId: z.number().int().positive(),
    invoiceRef: optText(60),
    purchasedAt: ymd,
    notes: optText(1000),
    lines: z
      .array(
        z
          .object({
            materialId: z.number().int().positive(),
            rolls: z.number().int().min(1).max(100),
            widthMm: mm,
            lengthMm: mm,
            unitCost: z.number().int().min(0).max(100_000_000),
            coreWeightG: z.number().int().min(0).max(100_000).nullable().optional(),
            location: optText(60),
          })
          .strict(),
      )
      .min(1, 'Agrega al menos una línea.')
      .max(50),
  })
  .strict()
  .refine((p) => p.purchasedAt <= todayCo(), { message: 'La fecha de compra no puede ser futura.', path: ['purchasedAt'] });

const addDays = (ymdStr: string, d: number) => new Date(Date.parse(`${ymdStr}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/** Rango por defecto: últimos 30 días (incluido hoy). */
const rangeQuery = z
  .object({ from: ymd.optional(), to: ymd.optional() })
  .transform((q) => {
    const to = q.to ?? todayCo();
    return { to, from: q.from ?? addDays(to, -29) };
  })
  .refine((r) => r.from <= r.to, 'La fecha inicial debe ser anterior a la final.')
  .refine((r) => Date.parse(r.to) - Date.parse(r.from) <= 366 * 86_400_000 * 3, 'Rango demasiado largo (máx. 3 años).');

export function purchaseRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const admin = { config: { access: 'ADMIN' as const } };

  app.get('/api/admin/suppliers', admin, async () => ({ suppliers: listSuppliers(db) }));

  app.post('/api/admin/suppliers', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const supplier = createSupplier(db, parse(supplierSchema, req.body));
    audit(db, { actorUserId: actor.id, action: 'supplier.create', entity: 'supplier', entityId: supplier.id, ip: req.ip });
    return reply.code(201).send({ supplier });
  });

  app.patch('/api/admin/suppliers/:id', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { supplier: updateSupplier(db, id, parse(supplierSchema.partial(), req.body)) };
  });

  app.get('/api/admin/purchases', admin, async () => ({ purchases: listPurchases(db) }));

  app.get('/api/admin/purchases/:id', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { purchase: getPurchase(db, id) };
  });

  app.post('/api/admin/purchases', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const body = parse(purchaseSchema, req.body);
    const r = createPurchase(db, actor.id, body);
    audit(db, {
      actorUserId: actor.id,
      action: 'purchase.create',
      entity: 'purchase',
      entityId: r.purchaseId,
      details: { rolls: r.createdCodes.length, costChanges: r.costChanges },
      ip: req.ip,
    });
    return reply.code(201).send({ purchase: getPurchase(db, r.purchaseId), createdCodes: r.createdCodes, costChanges: r.costChanges });
  });

  // ───── Reportes ─────

  app.get('/api/admin/reports/stock', admin, async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }), req.query);
    return { days, materials: stockReport(db, days) };
  });

  const ranged = <T>(fn: (db: Db, r: { from: string; to: string }) => T) =>
    async (req: { query: unknown }) => {
      const range = parse(rangeQuery, req.query);
      return { range, ...(fn(db, range) as object) };
    };

  app.get('/api/admin/reports/waste', admin, ranged(wasteReport));
  app.get('/api/admin/reports/shortages', admin, ranged(shortageReport));
  app.get('/api/admin/reports/freehand', admin, ranged(freehandReport));
  app.get('/api/admin/reports/sales', admin, ranged(salesReport));
  app.get('/api/admin/reports/margins', admin, ranged(marginReport));
}
