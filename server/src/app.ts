import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import authPlugin from './auth/plugin.js';
import { AppError } from './lib/errors.js';
import { MAX_PHOTO_BYTES, MAX_PHOTOS, PhotoStore } from './lib/photos.js';
import { authRoutes } from './modules/auth/routes.js';
import { userAdminRoutes } from './modules/users/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import { purchaseRoutes } from './modules/purchases/routes.js';

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.NODE_ENV === 'production' ? 'info' : 'debug',
            // Nunca registrar cookies ni el token CSRF.
            redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
          },
  });

  await app.register(helmet, {
    hsts: config.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: true } : false,
    contentSecurityPolicy: {
      directives: {
        // Sin HTTPS (p. ej. en la red local del negocio) forzar https rompería la carga de la app.
        upgradeInsecureRequests: config.COOKIE_SECURE ? [] : null,
        // blob: = vista previa de las fotos que el cliente elige antes de subirlas (URL.createObjectURL).
        imgSrc: ["'self'", 'data:', 'blob:'],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  // Solo las rutas con config.multipart lo aceptan (ver auth/plugin.ts). Límites contra abuso: ARQUITECTURA §1.3.
  await app.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS, fields: 10, fieldSize: 4000, parts: MAX_PHOTOS + 10 },
  });
  await app.register(authPlugin, { db, config });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: err.issues[0]?.message ?? 'Datos inválidos.',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const message = status === 429 ? 'Demasiadas solicitudes. Espera un momento.' : 'Solicitud inválida.';
      return reply.code(status).send({ error: 'REQUEST_ERROR', message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL', message: 'Ocurrió un error inesperado.' });
  });

  // Para monitoreo: también verifica que la BD responde.
  app.get('/api/health', { config: { access: 'public' } }, async () => {
    db.$client.prepare('SELECT 1').get();
    return { ok: true };
  });
  authRoutes(app, { db, config });
  userAdminRoutes(app, { db });
  inventoryRoutes(app, { db });
  orderRoutes(app, { db, store: new PhotoStore(path.resolve(config.UPLOADS_PATH)) });
  purchaseRoutes(app, { db });

  // Frontend compilado (producción). En desarrollo lo sirve Vite.
  const webDist = config.WEB_DIST_PATH ? path.resolve(config.WEB_DIST_PATH) : '';
  const hasWeb = webDist !== '' && fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) await app.register(fastifyStatic, { root: webDist, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    // Un archivo que no existe (p. ej. /assets/index-viejo.js tras un despliegue) es 404, NO la página:
    // si se respondiera index.html con 200, el navegador lo rechazaría como JS/CSS y quedaría en blanco.
    const pathname = req.url.split('?')[0]!;
    const looksLikeFile = pathname.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(pathname);
    if (!pathname.startsWith('/api') && req.method === 'GET' && hasWeb && !looksLikeFile) {
      return reply.sendFile('index.html'); // rutas del SPA (React Router)
    }
    return reply.code(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado.' });
  });

  return app;
}
