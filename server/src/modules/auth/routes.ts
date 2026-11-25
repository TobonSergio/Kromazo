import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Config } from '../../config.js';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { getDummyHash, verifyPassword, PASSWORD_MAX } from '../../auth/password.js';
import { createSession, destroySession } from '../../auth/sessions.js';
import { clearSessionCookie, requireUser, sessionSettings, setSessionCookie } from '../../auth/plugin.js';
import { audit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { emailSchema, fullNameSchema, parse, phoneSchema } from '../../lib/validation.js';
import { createUser, findUserByEmail, setPassword, toPublicUser, updateProfile } from '../users/service.js';

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
});

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().max(PASSWORD_MAX),
  fullName: fullNameSchema,
  phone: phoneSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: z.string().max(PASSWORD_MAX),
});

const profileSchema = z.object({ fullName: fullNameSchema.optional(), phone: phoneSchema });

const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos.';

export function authRoutes(app: FastifyInstance, { db, config }: { db: Db; config: Config }) {
  const settings = sessionSettings(config);
  const authRateLimit = { max: config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' };

  app.post('/api/auth/register', { config: { access: 'public', rateLimit: authRateLimit } }, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const user = await createUser(db, { ...body, role: 'CLIENT' }); // el registro público SIEMPRE crea clientes
    const s = createSession(db, user.id, settings, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, config, s.token, s.expiresAt);
    audit(db, { actorUserId: user.id, action: 'user.register', entity: 'user', entityId: user.id, ip: req.ip });
    return reply.code(201).send({ user: toPublicUser(user), csrfToken: s.csrfToken });
  });

  app.post('/api/auth/login', { config: { access: 'public', rateLimit: authRateLimit } }, async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = findUserByEmail(db, email);
    const now = Date.now();

    if (!user) {
      await verifyPassword(await getDummyHash(), password); // mismo costo de tiempo que un usuario real
      throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }
    if (user.lockedUntil && Date.parse(user.lockedUntil) > now) {
      throw new AppError(429, 'ACCOUNT_LOCKED', 'Demasiados intentos fallidos. Intenta de nuevo en unos minutos.');
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lock = failed >= config.LOGIN_MAX_FAILED;
      db.update(users)
        .set({
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(now + config.LOGIN_LOCK_MINUTES * 60_000).toISOString() : user.lockedUntil,
        })
        .where(eq(users.id, user.id))
        .run();
      if (lock) {
        audit(db, { actorUserId: null, action: 'auth.lockout', entity: 'user', entityId: user.id, ip: req.ip });
      }
      throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'Tu cuenta está desactivada. Comunícate con el local.');
    }

    db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id)).run();
    // Rotación: si había una sesión previa en este navegador, se elimina.
    if (req.auth) destroySession(db, req.auth.idHash);
    const s = createSession(db, user.id, settings, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, config, s.token, s.expiresAt);
    if (user.role === 'ADMIN') {
      audit(db, { actorUserId: user.id, action: 'auth.admin_login', entity: 'user', entityId: user.id, ip: req.ip });
    }
    return { user: toPublicUser(user), csrfToken: s.csrfToken };
  });

  app.post('/api/auth/logout', { config: { access: 'authenticated' } }, async (req, reply) => {
    destroySession(db, requireUser(req).idHash);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  /** Pública: el frontend la usa para saber si hay sesión y obtener el token CSRF. */
  app.get('/api/auth/me', { config: { access: 'public' } }, async (req) => {
    if (!req.auth) return { user: null, csrfToken: null };
    return { user: toPublicUser(req.auth.user), csrfToken: req.auth.csrfToken };
  });

  app.post('/api/auth/password', { config: { access: 'authenticated', rateLimit: authRateLimit } }, async (req, reply) => {
    const session = requireUser(req);
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    if (!(await verifyPassword(session.user.passwordHash, currentPassword))) {
      throw new AppError(400, 'WRONG_PASSWORD', 'La contraseña actual no es correcta.');
    }
    await setPassword(db, session.user.id, newPassword, session.idHash); // cierra las demás sesiones
    audit(db, { actorUserId: session.user.id, action: 'user.change_password', entity: 'user', entityId: session.user.id, ip: req.ip });
    return reply.code(204).send();
  });

  app.patch('/api/account/profile', { config: { access: 'authenticated' } }, async (req) => {
    const session = requireUser(req);
    const data = parse(profileSchema, req.body);
    const user = updateProfile(db, session.user.id, data);
    return { user: toPublicUser(user) };
  });
}
