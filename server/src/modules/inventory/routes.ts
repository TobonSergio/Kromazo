import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { FINISHES, MATERIAL_TYPES, UNIT_KINDS, UNIT_STATUSES } from '../../db/schema.js';
import { requireUser } from '../../auth/plugin.js';
import { audit } from '../../lib/audit.js';
import { getSettings, settingsPatchSchema, updateSettings } from '../../lib/settings.js';
import { idParamSchema, parse } from '../../lib/validation.js';
import {
  createMaterial,
  getMaterialAdminView,
  listMaterialsAdmin,
  listMaterialsStaff,
  updateMaterial,
} from '../materials/service.js';
import {
  adjustUnit,
  createFreehandSize,
  createRoll,
  discardUnit,
  getUnitView,
  listCounts,
  listCuts,
  listFreehandSizes,
  listMovements,
  listUnits,
  registerCount,
  registerCut,
  updateFreehandSize,
  updateUnit,
} from './service.js';

// Medidas en la API: milímetros y mm², enteros. La interfaz convierte a cm, m y m².
const MAX_MM = 1_000_000; // 1 km: tope de cordura
const mm = z.number().int().positive().max(MAX_MM);
const mm2 = z.number().int().positive().max(MAX_MM * 10_000);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const reason = z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres).').max(300);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, 'Código inválido: usa letras, números y guiones (máx. 20).');

const materialSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  brand: z.string().trim().min(1, 'Escribe la marca.').max(60),
  line: optText(60),
  color: z.string().trim().min(1, 'Escribe el color.').max(60),
  finish: z.enum(FINISHES),
  type: z.enum(MATERIAL_TYPES),
  gramsPerM2: z.number().int().positive().max(5000).nullable().optional(),
  costPerM2: z.number().int().min(0).max(100_000_000).nullable().optional(),
  minStockMm2: z.number().int().min(0).max(MAX_MM * 10_000).optional(),
});

const rollSchema = z
  .object({
    materialId: z.number().int().positive(),
    code: code.optional().or(z.literal('').transform(() => undefined)),
    widthMm: mm,
    lengthMm: mm,
    coreWeightG: z.number().int().min(0).max(100_000).nullable().optional(),
    location: optText(60),
  })
  .strict();

const remnantSchema = z.object({ widthMm: mm, lengthMm: mm, location: optText(60) }).strict();
const cutBase = {
  unitId: z.number().int().positive(),
  orderId: z.number().int().positive().nullable().optional(),
  remnants: z.array(remnantSchema).max(10).optional(),
  notes: optText(300),
};
const cutSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('MEASURED'), lengthMm: mm, widthMm: mm.optional(), usedAreaMm2: z.number().int().min(0).optional(), ...cutBase }).strict(),
  z
    .object({
      method: z.literal('FREEHAND'),
      sizeId: z.number().int().positive().optional(),
      approxAreaMm2: mm2.optional(),
      lengthMm: mm.optional(),
      widthMm: mm.optional(),
      ...cutBase,
    })
    .strict()
    .refine((v) => v.widthMm === undefined || v.lengthMm !== undefined, 'Si das el ancho, da también el largo.'),
]);

const countSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('LENGTH'), measuredLengthMm: z.number().int().min(0).max(MAX_MM), notes: optText(300) }).strict(),
  z.object({ method: z.literal('WEIGHT'), measuredWeightG: z.number().int().min(0).max(1_000_000), notes: optText(300) }).strict(),
]);

const sizeSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    refAreaMm2: mm2,
    materialType: z.enum(MATERIAL_TYPES).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const unitsQuery = z.object({
  materialId: z.coerce.number().int().positive().optional(),
  kind: z.enum(UNIT_KINDS).optional(),
  status: z.enum([...UNIT_STATUSES, 'ALL']).optional(),
  q: z.string().trim().max(60).optional(),
  needsCount: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

/**
 * /api/staff/*: personal del local (admin y empleado). Sus respuestas NUNCA incluyen costos.
 * /api/admin/*: solo admin (costos, conteos, ajustes, bajas y configuración).
 */
export function inventoryRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const staff = { config: { access: 'STAFF' as const } };
  const admin = { config: { access: 'ADMIN' as const } };

  // ───── Personal (admin y empleado) ─────

  app.get('/api/staff/materials', staff, async (req) => {
    const { all } = parse(z.object({ all: z.enum(['true', 'false']).optional() }), req.query);
    return { materials: listMaterialsStaff(db, { activeOnly: all !== 'true' }) };
  });

  app.get('/api/staff/units', staff, async (req) => ({ units: listUnits(db, parse(unitsQuery, req.query)) }));

  app.get('/api/staff/units/:id', staff, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { unit: getUnitView(db, id), cuts: listCuts(db, { unitId: id, limit: 100 }), movements: listMovements(db, id) };
  });

  app.get('/api/staff/freehand-sizes', staff, async (req) => {
    const { materialType } = parse(z.object({ materialType: z.enum(MATERIAL_TYPES).optional() }), req.query);
    return { sizes: listFreehandSizes(db, { activeOnly: true, materialType }) };
  });

  app.get('/api/staff/cuts', staff, async (req) => {
    const q = parse(
      z.object({ mine: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(200).default(30) }),
      req.query,
    );
    const user = requireUser(req).user;
    return { cuts: listCuts(db, { userId: q.mine === 'true' ? user.id : undefined, limit: q.limit }) };
  });

  app.post('/api/staff/cuts', staff, async (req, reply) => {
    const user = requireUser(req).user;
    const result = registerCut(db, user.id, parse(cutSchema, req.body));
    return reply.code(201).send(result);
  });

  // ───── Solo admin ─────

  app.get('/api/admin/materials', admin, async () => ({ materials: listMaterialsAdmin(db) }));

  app.post('/api/admin/materials', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const m = createMaterial(db, parse(materialSchema, req.body));
    audit(db, { actorUserId: actor.id, action: 'material.create', entity: 'material', entityId: m.id, details: { sku: m.sku, costPerM2: m.costPerM2 }, ip: req.ip });
    return reply.code(201).send({ material: getMaterialAdminView(db, m.id) });
  });

  app.patch('/api/admin/materials/:id', admin, async (req) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const body = parse(materialSchema.partial().extend({ isActive: z.boolean().optional() }).strict(), req.body);
    const { before, after } = updateMaterial(db, id, body);
    const details: Record<string, unknown> = { ...body };
    if (body.costPerM2 !== undefined && before.costPerM2 !== after.costPerM2) details.previousCostPerM2 = before.costPerM2;
    audit(db, { actorUserId: actor.id, action: 'material.update', entity: 'material', entityId: id, details, ip: req.ip });
    return { material: getMaterialAdminView(db, id) };
  });

  app.post('/api/admin/units', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const unit = createRoll(db, actor.id, parse(rollSchema, req.body));
    audit(db, { actorUserId: actor.id, action: 'unit.create', entity: 'inventory_unit', entityId: unit.id, details: { code: unit.code, areaMm2: unit.balanceMm2 }, ip: req.ip });
    return reply.code(201).send({ unit });
  });

  app.patch('/api/admin/units/:id', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(
      z.object({ location: optText(60), coreWeightG: z.number().int().min(0).max(100_000).nullable().optional() }).strict(),
      req.body,
    );
    return { unit: updateUnit(db, id, body) };
  });

  app.get('/api/admin/units/:id/counts', admin, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    return { counts: listCounts(db, id) };
  });

  app.post('/api/admin/units/:id/counts', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const result = registerCount(db, actor.id, id, parse(countSchema, req.body));
    audit(db, {
      actorUserId: actor.id,
      action: 'inventory.count',
      entity: 'inventory_unit',
      entityId: id,
      details: { countId: result.count.id, freehandAdjustMm2: result.count.freehandAdjustMm2, unexplainedMm2: result.count.unexplainedMm2 },
      ip: req.ip,
    });
    return reply.code(201).send(result);
  });

  app.post('/api/admin/units/:id/adjust', admin, async (req) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const body = parse(
      z.object({ areaMm2: z.number().int().refine((v) => v !== 0, 'El ajuste no puede ser 0.'), reason }).strict(),
      req.body,
    );
    const unit = adjustUnit(db, actor.id, id, body);
    audit(db, { actorUserId: actor.id, action: 'inventory.adjust', entity: 'inventory_unit', entityId: id, details: body, ip: req.ip });
    return { unit };
  });

  app.post('/api/admin/units/:id/discard', admin, async (req) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const body = parse(z.object({ reason }).strict(), req.body);
    const unit = discardUnit(db, actor.id, id, body);
    audit(db, { actorUserId: actor.id, action: 'inventory.discard', entity: 'inventory_unit', entityId: id, details: body, ip: req.ip });
    return { unit };
  });

  app.get('/api/admin/freehand-sizes', admin, async () => ({ sizes: listFreehandSizes(db) }));

  app.post('/api/admin/freehand-sizes', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const size = createFreehandSize(db, parse(sizeSchema, req.body));
    audit(db, { actorUserId: actor.id, action: 'freehand_size.create', entity: 'freehand_size', entityId: size.id, details: size, ip: req.ip });
    return reply.code(201).send({ size });
  });

  app.patch('/api/admin/freehand-sizes/:id', admin, async (req) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const body = parse(sizeSchema.partial(), req.body);
    const size = updateFreehandSize(db, id, body);
    audit(db, { actorUserId: actor.id, action: 'freehand_size.update', entity: 'freehand_size', entityId: id, details: body, ip: req.ip });
    return { size };
  });

  app.get('/api/admin/settings', admin, async () => ({ settings: getSettings(db) }));

  app.patch('/api/admin/settings', admin, async (req) => {
    const actor = requireUser(req).user;
    const body = parse(settingsPatchSchema, req.body);
    const settings = updateSettings(db, body);
    audit(db, { actorUserId: actor.id, action: 'settings.update', entity: 'settings', details: body, ip: req.ip });
    return { settings };
  });
}
