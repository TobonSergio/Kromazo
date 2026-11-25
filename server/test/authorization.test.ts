import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Agent, seedUser, setup, type TestCtx } from './helpers.js';
import authPlugin from '../src/auth/plugin.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/client.js';

let ctx: TestCtx;
let adminRoutes: { method: string; url: string }[] = [];
let staffRoutes: { method: string; url: string }[] = [];
const fill = (url: string) => url.replace(/:\w+/g, '1');

beforeAll(async () => {
  ctx = await setup();
  // Todas las rutas ADMIN registradas: si mañana se agrega una, queda cubierta automáticamente.
  adminRoutes = ctx.app.apiRoutes.filter((r) => r.access === 'ADMIN');
  staffRoutes = ctx.app.apiRoutes.filter((r) => r.access === 'STAFF');
});
afterAll(async () => {
  await ctx.app.close();
});

describe('autorización por rol', () => {
  it('hay rutas de admin para probar', () => {
    expect(adminRoutes.length).toBeGreaterThanOrEqual(5);
  });

  it('anónimo recibe 401 en todas las rutas de admin', async () => {
    for (const r of adminRoutes) {
      const res = await ctx.app.inject({ method: r.method as 'GET', url: fill(r.url), payload: r.method === 'GET' ? undefined : {} });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('un CLIENTE recibe 403 en todas las rutas de admin', async () => {
    await seedUser(ctx, 'CLIENT', 'cliente-authz@test.co');
    const a = new Agent(ctx.app);
    await a.login('cliente-authz@test.co');
    for (const r of adminRoutes) {
      const res = await a.req(r.method as 'GET', fill(r.url), r.method === 'GET' ? undefined : {});
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
    }
  });

  it('un CLIENTE recibe 403 en todas las rutas del personal (STAFF)', async () => {
    expect(staffRoutes.length).toBeGreaterThanOrEqual(5);
    const a = new Agent(ctx.app);
    await a.login('cliente-authz@test.co');
    for (const r of staffRoutes) {
      const res = await a.req(r.method as 'GET', fill(r.url), r.method === 'GET' ? undefined : {});
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
    }
  });

  it('un EMPLEADO recibe 403 en todas las rutas de admin', async () => {
    await seedUser(ctx, 'EMPLOYEE', 'emp-authz@test.co');
    const a = new Agent(ctx.app);
    await a.login('emp-authz@test.co');
    for (const r of adminRoutes) {
      const res = await a.req(r.method as 'GET', fill(r.url), r.method === 'GET' ? undefined : {});
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
    }
    expect((await a.req('GET', '/api/staff/materials')).statusCode).toBe(200);
  });

  it('las rutas de cliente solo son para clientes: personal → 403, anónimo → 401', async () => {
    const clientRoutes = ctx.app.apiRoutes.filter((r) => r.access === 'CLIENT');
    expect(clientRoutes.length).toBeGreaterThanOrEqual(8);
    const e = new Agent(ctx.app);
    await e.login('emp-authz@test.co');
    for (const r of clientRoutes) {
      const body = r.method === 'GET' ? undefined : {};
      expect((await e.req(r.method as 'GET', fill(r.url), body)).statusCode, `${r.method} ${r.url}`).toBe(403);
      const anon = await ctx.app.inject({ method: r.method as 'GET', url: fill(r.url), payload: body });
      expect(anon.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('un ADMIN sí accede', async () => {
    await seedUser(ctx, 'ADMIN', 'admin-authz@test.co');
    const a = new Agent(ctx.app);
    await a.login('admin-authz@test.co');
    expect((await a.req('GET', '/api/admin/users')).statusCode).toBe(200);
    expect((await a.req('GET', '/api/admin/audit')).statusCode).toBe(200);
  });

  it('la lista de usuarios nunca expone el hash de la contraseña', async () => {
    const a = new Agent(ctx.app);
    await a.login('admin-authz@test.co');
    const body = (await a.req('GET', '/api/admin/users')).body;
    expect(body).not.toContain('argon2');
    expect(body).not.toContain('passwordHash');
  });
});

describe('denegar por defecto', () => {
  it('la app no arranca si una ruta /api no declara config.access', async () => {
    const app = Fastify();
    await app.register(authPlugin, { db: openDb(':memory:'), config: loadConfig({ NODE_ENV: 'test' }) });
    await expect(
      (async () => {
        app.get('/api/sin-proteccion', async () => ({ secreto: true }));
        await app.ready();
      })(),
    ).rejects.toThrow(/config.access/);
  });
});
