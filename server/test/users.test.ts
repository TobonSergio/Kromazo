import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Agent, PASSWORD, seedUser, setup, type TestCtx } from './helpers.js';
import { auditLog, customers } from '../src/db/schema.js';
import { adminUpdateUser } from '../src/modules/users/service.js';

let ctx: TestCtx;
let admin: Agent;
let adminId: number;

beforeEach(async () => {
  ctx = await setup();
  adminId = (await seedUser(ctx, 'ADMIN', 'admin@test.co')).id;
  admin = new Agent(ctx.app);
  await admin.login('admin@test.co');
});
afterEach(async () => {
  await ctx.app.close();
});

describe('gestión de usuarios (admin)', () => {
  it('crea otro administrador y queda en auditoría', async () => {
    const res = await admin.req('POST', '/api/admin/users', {
      email: 'socio@test.co',
      password: PASSWORD,
      fullName: 'Socio del local',
      role: 'ADMIN',
    });
    expect(res.statusCode).toBe(201);
    expect((await new Agent(ctx.app).login('socio@test.co')).statusCode).toBe(200);
    const log = ctx.db.select().from(auditLog).where(eq(auditLog.action, 'user.create')).all();
    expect(log).toHaveLength(1);
    expect(log[0]!.detailsJson).not.toContain(PASSWORD);
  });

  it('crear un cliente desde admin también crea su ficha de cliente', async () => {
    const res = await admin.req('POST', '/api/admin/users', {
      email: 'cli@test.co',
      password: PASSWORD,
      fullName: 'Cliente Mostrador',
      role: 'CLIENT',
    });
    const id = res.json().user.id;
    expect(ctx.db.select().from(customers).where(eq(customers.userId, id)).get()).toBeTruthy();
  });

  it('no puede quitarse su propio rol ni desactivarse', async () => {
    expect((await admin.req('PATCH', `/api/admin/users/${adminId}`, { role: 'CLIENT' })).statusCode).toBe(400);
    expect((await admin.req('PATCH', `/api/admin/users/${adminId}`, { isActive: false })).statusCode).toBe(400);
    // Sí puede editar su nombre.
    expect((await admin.req('PATCH', `/api/admin/users/${adminId}`, { fullName: 'Camilo' })).statusCode).toBe(200);
  });

  it('siempre debe quedar al menos un admin activo', async () => {
    const otro = await seedUser(ctx, 'ADMIN', 'otro@test.co');
    // Hay 2 admins: se puede desactivar uno.
    expect((await admin.req('PATCH', `/api/admin/users/${otro.id}`, { isActive: false })).statusCode).toBe(200);
    // Ahora queda uno solo: el servicio se niega aunque lo pida otro actor (p. ej. un script).
    expect(() => adminUpdateUser(ctx.db, otro.id, adminId, { isActive: false })).toThrow(/al menos un administrador/);
    expect(() => adminUpdateUser(ctx.db, otro.id, adminId, { role: 'CLIENT' })).toThrow(/al menos un administrador/);
  });

  it('desactivar a un usuario cierra sus sesiones de inmediato', async () => {
    const cli = await seedUser(ctx, 'CLIENT', 'cli@test.co');
    const c = new Agent(ctx.app);
    await c.login('cli@test.co');
    expect((await c.req('GET', '/api/auth/me')).json().user).not.toBeNull();
    expect((await admin.req('PATCH', `/api/admin/users/${cli.id}`, { isActive: false })).statusCode).toBe(200);
    expect((await c.req('GET', '/api/auth/me')).json().user).toBeNull();
  });

  it('ascender un cliente a admin cierra su sesión (debe volver a entrar con el nuevo rol)', async () => {
    const cli = await seedUser(ctx, 'CLIENT', 'cli@test.co');
    const c = new Agent(ctx.app);
    await c.login('cli@test.co');
    await admin.req('PATCH', `/api/admin/users/${cli.id}`, { role: 'ADMIN' });
    expect((await c.req('GET', '/api/auth/me')).json().user).toBeNull();
    await c.login('cli@test.co');
    expect((await c.req('GET', '/api/admin/users')).statusCode).toBe(200);
  });

  it('restablecer la contraseña cierra las sesiones del usuario', async () => {
    const cli = await seedUser(ctx, 'CLIENT', 'cli@test.co');
    const c = new Agent(ctx.app);
    await c.login('cli@test.co');
    const res = await admin.req('POST', `/api/admin/users/${cli.id}/password`, { newPassword: 'Temporal-Nueva-99' });
    expect(res.statusCode).toBe(204);
    expect((await c.req('GET', '/api/auth/me')).json().user).toBeNull();
    expect((await c.login('cli@test.co', 'Temporal-Nueva-99')).statusCode).toBe(200);
  });

  it('filtra por rol y búsqueda', async () => {
    await seedUser(ctx, 'CLIENT', 'maria@test.co');
    await seedUser(ctx, 'CLIENT', 'pedro@test.co');
    const res = await admin.req('GET', '/api/admin/users?role=CLIENT&q=mar');
    expect(res.json().users.map((u: { email: string }) => u.email)).toEqual(['maria@test.co']);
  });

  it('rechaza campos no permitidos en la edición', async () => {
    const cli = await seedUser(ctx, 'CLIENT', 'cli@test.co');
    const res = await admin.req('PATCH', `/api/admin/users/${cli.id}`, { passwordHash: 'x' });
    expect(res.statusCode).toBe(400);
  });
});
