import type { FastifyInstance } from 'fastify';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { auditLog, ROLES } from '../../db/schema.js';
import { PASSWORD_MAX } from '../../auth/password.js';
import { requireUser } from '../../auth/plugin.js';
import { audit } from '../../lib/audit.js';
import { emailSchema, fullNameSchema, idParamSchema, parse, phoneSchema } from '../../lib/validation.js';
import { adminUpdateUser, createUser, listUsers, setPassword, toAdminView, unlockUser } from './service.js';

const listQuery = z.object({
  role: z.enum(ROLES).optional(),
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const createSchema = z.object({
  email: emailSchema,
  password: z.string().max(PASSWORD_MAX),
  fullName: fullNameSchema,
  phone: phoneSchema,
  role: z.enum(ROLES),
});

const updateSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    phone: phoneSchema,
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const resetSchema = z.object({ newPassword: z.string().max(PASSWORD_MAX) });

/** Gestión de usuarios: solo ADMIN. */
export function userAdminRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const admin = { config: { access: 'ADMIN' as const } };

  app.get('/api/admin/users', admin, async (req) => {
    return { users: listUsers(db, parse(listQuery, req.query)).map(toAdminView) };
  });

  app.post('/api/admin/users', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const body = parse(createSchema, req.body);
    const user = await createUser(db, body);
    audit(db, {
      actorUserId: actor.id,
      action: 'user.create',
      entity: 'user',
      entityId: user.id,
      details: { email: user.email, role: user.role },
      ip: req.ip,
    });
    return reply.code(201).send({ user: toAdminView(user) });
  });

  app.patch('/api/admin/users/:id', admin, async (req) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const body = parse(updateSchema, req.body);
    const user = adminUpdateUser(db, actor.id, id, body);
    audit(db, { actorUserId: actor.id, action: 'user.update', entity: 'user', entityId: id, details: body, ip: req.ip });
    return { user: toAdminView(user) };
  });

  app.post('/api/admin/users/:id/password', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    const { newPassword } = parse(resetSchema, req.body);
    await setPassword(db, id, newPassword);
    audit(db, { actorUserId: actor.id, action: 'user.reset_password', entity: 'user', entityId: id, ip: req.ip });
    return reply.code(204).send();
  });

  app.post('/api/admin/users/:id/unlock', admin, async (req, reply) => {
    const actor = requireUser(req).user;
    const { id } = parse(idParamSchema, req.params);
    unlockUser(db, id);
    audit(db, { actorUserId: actor.id, action: 'user.unlock', entity: 'user', entityId: id, ip: req.ip });
    return reply.code(204).send();
  });

  app.get('/api/admin/audit', admin, async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return { entries: db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit).all() };
  });
}
