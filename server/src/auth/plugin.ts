import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { Role } from '../db/schema.js';
import { forbidden, unauthorized, AppError } from '../lib/errors.js';
import { getSession, safeEqual, type ActiveSession, type SessionSettings } from './sessions.js';

/**
 * Nivel de acceso de una ruta. TODA ruta bajo /api debe declararlo en `config.access`;
 * si falta, la app no arranca (denegar por defecto).
 */
export type Access = 'public' | 'authenticated' | 'CLIENT' | 'STAFF' | 'ADMIN';

/** Qué roles cumplen cada nivel. STAFF = personal del local (admin o empleado). */
const ALLOWED: Record<Exclude<Access, 'public' | 'authenticated'>, readonly Role[]> = {
  CLIENT: ['CLIENT'],
  STAFF: ['ADMIN', 'EMPLOYEE'],
  ADMIN: ['ADMIN'],
};

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
    /** La ruta recibe archivos (multipart/form-data). Única excepción a "solo JSON"; sigue exigiendo CSRF. */
    multipart?: boolean;
  }
  interface FastifyRequest {
    auth: ActiveSession | null;
  }
  interface FastifyInstance {
    /** Inventario de rutas /api con su nivel de acceso (lo usan las pruebas de autorización). */
    apiRoutes: { method: string; url: string; access: Access }[];
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function cookieName(cfg: Config): string {
  // El prefijo __Host- obliga a Secure, Path=/ y sin Domain: la cookie no puede ser fijada por subdominios.
  return cfg.COOKIE_SECURE ? '__Host-sid' : 'sid';
}

export function sessionSettings(cfg: Config): SessionSettings {
  return { idleHours: cfg.SESSION_IDLE_HOURS, maxDays: cfg.SESSION_MAX_DAYS };
}

export function setSessionCookie(reply: FastifyReply, cfg: Config, token: string, expiresAt: Date): void {
  reply.setCookie(cookieName(cfg), token, {
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, cfg: Config): void {
  reply.clearCookie(cookieName(cfg), { path: '/', secure: cfg.COOKIE_SECURE, sameSite: 'lax', httpOnly: true });
}

export const requireUser = (req: FastifyRequest): ActiveSession => {
  if (!req.auth) throw unauthorized();
  return req.auth;
};

async function authPlugin(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;
  const settings = sessionSettings(config);

  app.decorateRequest('auth', null);
  const apiRoutes: FastifyInstance['apiRoutes'] = [];
  app.decorate('apiRoutes', apiRoutes);

  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api')) return;
    const access = route.config?.access;
    if (!access || !(access === 'public' || access === 'authenticated' || access in ALLOWED)) {
      throw new Error(`Ruta ${route.method} ${route.url} sin config.access válido: toda ruta /api debe declarar su nivel de acceso.`);
    }
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') apiRoutes.push({ method, url: route.url, access });
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    const access = req.routeOptions.config?.access;
    if (!req.url.startsWith('/api')) return;

    // 1) Cargar la sesión desde la cookie (si existe).
    const token = req.cookies[cookieName(config)];
    if (token) {
      req.auth = getSession(db, token, settings);
      if (!req.auth) clearSessionCookie(reply, config);
    }

    // 2) Defensa CSRF para métodos que modifican datos.
    if (UNSAFE.has(req.method)) {
      // Un formulario HTML de otro sitio no puede enviar application/json sin preflight CORS.
      const len = req.headers['content-length'];
      const hasBody = (len !== undefined && len !== '0') || req.headers['transfer-encoding'] !== undefined;
      const ct = req.headers['content-type'] ?? '';
      const type = ct.toLowerCase();
      const isJson = type.startsWith('application/json');
      const isMultipart = access !== undefined && req.routeOptions.config?.multipart === true && type.startsWith('multipart/form-data');
      if (hasBody && !isJson && !isMultipart) {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Solo se acepta application/json.');
      }
      if (req.auth) {
        const sent = req.headers['x-csrf-token'];
        if (typeof sent !== 'string' || !safeEqual(sent, req.auth.csrfToken)) {
          throw new AppError(403, 'CSRF', 'Token CSRF inválido o ausente. Recarga la página.');
        }
      }
    }

    // 3) Autorización por rol.
    if (!access) {
      // Rutas /api inexistentes (404) llegan aquí sin config; no hay nada que proteger.
      return;
    }
    if (access === 'public') return;
    if (!req.auth) throw unauthorized();
    if (access === 'authenticated') return;
    if (!ALLOWED[access].includes(req.auth.user.role)) throw forbidden();
  });
}

export default fp(authPlugin, { name: 'auth' });
