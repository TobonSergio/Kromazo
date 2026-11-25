import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Agent, PASSWORD, seedUser, setup, type TestCtx } from './helpers.js';
import { customers, sessions, users } from '../src/db/schema.js';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(async () => {
  await ctx.app.close();
});

describe('registro', () => {
  it('crea un CLIENTE con su ficha de cliente e inicia sesión', async () => {
    const a = new Agent(ctx.app);
    const res = await a.req('POST', '/api/auth/register', {
      email: '  Juan@Correo.COM ',
      password: PASSWORD,
      fullName: 'Juan Pérez',
      phone: '300 123 4567',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'juan@correo.com', role: 'CLIENT' });
    expect(res.json().user.passwordHash).toBeUndefined();

    const u = ctx.db.select().from(users).where(eq(users.email, 'juan@correo.com')).get()!;
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(ctx.db.select().from(customers).where(eq(customers.userId, u.id)).get()).toBeTruthy();

    const me = await a.req('GET', '/api/auth/me');
    expect(me.json().user.email).toBe('juan@correo.com');
  });

  it('ignora un intento de registrarse como ADMIN', async () => {
    const a = new Agent(ctx.app);
    const res = await a.req('POST', '/api/auth/register', {
      email: 'colado@test.co',
      password: PASSWORD,
      fullName: 'Colado',
      role: 'ADMIN',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('CLIENT');
  });

  it('rechaza contraseñas débiles y correos duplicados', async () => {
    const a = new Agent(ctx.app);
    const weak = await a.req('POST', '/api/auth/register', { email: 'x@test.co', password: '1234567890', fullName: 'Equis' });
    expect(weak.statusCode).toBe(400);
    const short = await a.req('POST', '/api/auth/register', { email: 'x@test.co', password: 'corta', fullName: 'Equis' });
    expect(short.statusCode).toBe(400);

    await seedUser(ctx, 'CLIENT', 'dup@test.co');
    const dup = await new Agent(ctx.app).req('POST', '/api/auth/register', {
      email: 'DUP@test.co',
      password: PASSWORD,
      fullName: 'Duplicado',
    });
    expect(dup.statusCode).toBe(409);
  });
});

describe('login', () => {
  it('mismo mensaje para correo inexistente y contraseña incorrecta (sin enumeración)', async () => {
    await seedUser(ctx, 'CLIENT', 'real@test.co');
    const noUser = await new Agent(ctx.app).login('noexiste@test.co', 'loquesea-123');
    const badPass = await new Agent(ctx.app).login('real@test.co', 'incorrecta-123');
    expect(noUser.statusCode).toBe(401);
    expect(badPass.statusCode).toBe(401);
    expect(noUser.json().message).toBe(badPass.json().message);
  });

  it('cookie de sesión httpOnly, SameSite=Lax; en BD solo se guarda el hash del token', async () => {
    await seedUser(ctx, 'CLIENT', 'c@test.co');
    const res = await new Agent(ctx.app).login('c@test.co');
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === 'sid')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    const stored = ctx.db.select().from(sessions).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.idHash).not.toBe(c.value);
    expect(stored[0]!.idHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('en producción usa cookie __Host- con Secure', async () => {
    const prod = await setup({ COOKIE_SECURE: 'true' });
    await seedUser(prod, 'CLIENT', 'c@test.co');
    const res = await new Agent(prod.app).login('c@test.co');
    const c = res.cookies.find((x) => x.name === '__Host-sid')!;
    expect(c.secure).toBe(true);
    await prod.app.close();
  });

  it('bloquea la cuenta tras 5 intentos fallidos, incluso con la clave correcta', async () => {
    await seedUser(ctx, 'CLIENT', 'c@test.co');
    const a = new Agent(ctx.app);
    for (let i = 0; i < 5; i++) expect((await a.login('c@test.co', 'mala-clave-xx')).statusCode).toBe(401);
    const locked = await a.login('c@test.co');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('ACCOUNT_LOCKED');
  });

  it('un admin puede desbloquear la cuenta', async () => {
    const client = await seedUser(ctx, 'CLIENT', 'c@test.co');
    await seedUser(ctx, 'ADMIN', 'admin@test.co');
    const a = new Agent(ctx.app);
    for (let i = 0; i < 5; i++) await a.login('c@test.co', 'mala-clave-xx');
    const admin = new Agent(ctx.app);
    await admin.login('admin@test.co');
    expect((await admin.req('POST', `/api/admin/users/${client.id}/unlock`)).statusCode).toBe(204);
    expect((await a.login('c@test.co')).statusCode).toBe(200);
  });

  it('rate limit por IP en /api/auth', async () => {
    const limited = await setup({ AUTH_RATE_LIMIT_PER_MIN: '3' });
    const a = new Agent(limited.app);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await a.login('x@test.co', 'cualquiera-123')).statusCode);
    expect(codes).toEqual([401, 401, 401, 429]);
    await limited.app.close();
  });

  it('cuenta desactivada no puede iniciar sesión', async () => {
    const u = await seedUser(ctx, 'CLIENT', 'c@test.co');
    ctx.db.update(users).set({ isActive: false }).where(eq(users.id, u.id)).run();
    expect((await new Agent(ctx.app).login('c@test.co')).statusCode).toBe(403);
  });
});

describe('sesión', () => {
  it('logout invalida la sesión en el servidor', async () => {
    await seedUser(ctx, 'CLIENT', 'c@test.co');
    const a = new Agent(ctx.app);
    await a.login('c@test.co');
    const oldCookie = a.cookie;
    expect((await a.req('POST', '/api/auth/logout')).statusCode).toBe(204);
    // Reusar la cookie robada/antigua no sirve.
    const b = new Agent(ctx.app);
    b.cookie = oldCookie;
    expect((await b.req('GET', '/api/auth/me')).json().user).toBeNull();
  });

  it('expira por inactividad', async () => {
    await seedUser(ctx, 'CLIENT', 'c@test.co');
    const a = new Agent(ctx.app);
    await a.login('c@test.co');
    const old = new Date(Date.now() - 13 * 3_600_000).toISOString();
    ctx.db.update(sessions).set({ lastSeenAt: old }).run();
    expect((await a.req('GET', '/api/auth/me')).json().user).toBeNull();
    expect(ctx.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('expira por duración máxima', async () => {
    await seedUser(ctx, 'CLIENT', 'c@test.co');
    const a = new Agent(ctx.app);
    await a.login('c@test.co');
    ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).run();
    expect((await a.req('GET', '/api/auth/me')).json().user).toBeNull();
  });

  it('cambiar la contraseña cierra las demás sesiones pero no la actual', async () => {
    await seedUser(ctx, 'CLIENT', 'c@test.co');
    const pc = new Agent(ctx.app);
    const celular = new Agent(ctx.app);
    await pc.login('c@test.co');
    await celular.login('c@test.co');
    const res = await pc.req('POST', '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'Nueva-Clave-Larga-1' });
    expect(res.statusCode).toBe(204);
    expect((await pc.req('GET', '/api/auth/me')).json().user).not.toBeNull();
    expect((await celular.req('GET', '/api/auth/me')).json().user).toBeNull();
    expect((await new Agent(ctx.app).login('c@test.co', 'Nueva-Clave-Larga-1')).statusCode).toBe(200);
  });

  it('cambiar la contraseña exige la actual', async () => {
    await seedUser(ctx, 'CLIENT', 'c@test.co');
    const a = new Agent(ctx.app);
    await a.login('c@test.co');
    const res = await a.req('POST', '/api/auth/password', { currentPassword: 'otra-cosa-123', newPassword: 'Nueva-Clave-Larga-1' });
    expect(res.statusCode).toBe(400);
  });
});

describe('CSRF', () => {
  it('rechaza peticiones que modifican datos sin el token CSRF', async () => {
    await seedUser(ctx, 'CLIENT', 'c@test.co');
    const a = new Agent(ctx.app);
    await a.login('c@test.co');
    const res = await a.req('PATCH', '/api/account/profile', { fullName: 'Hackeado' }, { csrf: false });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('CSRF');
    const ok = await a.req('PATCH', '/api/account/profile', { fullName: 'Nombre Nuevo' });
    expect(ok.statusCode).toBe(200);
  });

  it('rechaza cuerpos que no sean JSON (formularios de otros sitios)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'email=a@b.co&password=x',
    });
    expect(res.statusCode).toBe(415);
  });
});
