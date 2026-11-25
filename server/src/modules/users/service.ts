import { and, asc, count, eq, like, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { customers, users, type Role, type User } from '../../db/schema.js';
import { hashPassword, passwordProblem } from '../../auth/password.js';
import { destroyUserSessions } from '../../auth/sessions.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';

/** Lo que se expone de un usuario. Nunca incluir password_hash. */
export interface PublicUser {
  id: number;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AdminUserView extends PublicUser {
  lockedUntil: string | null;
  failedLogins: number;
}

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  role: u.role,
  fullName: u.fullName,
  phone: u.phone,
  isActive: u.isActive,
  createdAt: u.createdAt,
});

export const toAdminView = (u: User): AdminUserView => ({
  ...toPublicUser(u),
  lockedUntil: u.lockedUntil && Date.parse(u.lockedUntil) > Date.now() ? u.lockedUntil : null,
  failedLogins: u.failedLogins,
});

const nowIso = () => new Date().toISOString();

export function findUserByEmail(db: Db, email: string): User | undefined {
  return db.select().from(users).where(eq(users.email, email)).get();
}

export function getUser(db: Db, id: number): User {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  if (!u) throw notFound('Usuario no encontrado.');
  return u;
}

export interface NewUserInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  role: Role;
}

/** Crea el usuario y, si es cliente, su ficha de cliente, en una sola transacción. */
export async function createUser(db: Db, input: NewUserInput): Promise<User> {
  const problem = passwordProblem(input.password, input.email);
  if (problem) throw badRequest(problem, 'WEAK_PASSWORD');
  if (findUserByEmail(db, input.email)) {
    throw conflict('Ya existe una cuenta con ese correo. Si es tuya, inicia sesión.', 'EMAIL_TAKEN');
  }
  const passwordHash = await hashPassword(input.password);

  return db.transaction((tx) => {
    const user = tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        role: input.role,
        fullName: input.fullName,
        phone: input.phone ?? null,
      })
      .returning()
      .get();
    if (input.role === 'CLIENT') {
      // No se vincula automáticamente a un cliente existente con el mismo correo:
      // cualquiera podría registrarse con un correo ajeno y ver ese historial.
      tx.insert(customers)
        .values({ userId: user.id, fullName: user.fullName, phone: user.phone, email: user.email })
        .run();
    }
    return user;
  });
}

export async function setPassword(db: Db, userId: number, newPassword: string, keepSessionIdHash?: string) {
  const user = getUser(db, userId);
  const problem = passwordProblem(newPassword, user.email);
  if (problem) throw badRequest(problem, 'WEAK_PASSWORD');
  const passwordHash = await hashPassword(newPassword);
  db.update(users)
    .set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: nowIso() })
    .where(eq(users.id, userId))
    .run();
  destroyUserSessions(db, userId, keepSessionIdHash);
}

export function updateProfile(db: Db, userId: number, data: { fullName?: string; phone?: string | null }): User {
  return db.transaction((tx) => {
    const user = tx
      .update(users)
      .set({ ...data, updatedAt: nowIso() })
      .where(eq(users.id, userId))
      .returning()
      .get();
    if (!user) throw notFound('Usuario no encontrado.');
    if (user.role === 'CLIENT') {
      tx.update(customers).set({ fullName: user.fullName, phone: user.phone }).where(eq(customers.userId, userId)).run();
    }
    return user;
  });
}

function countActiveAdmins(db: Db): number {
  return db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)))
    .get()!.n;
}

export interface AdminUpdateInput {
  fullName?: string;
  phone?: string | null;
  role?: Role;
  isActive?: boolean;
}

/** Cambios hechos por un admin sobre otro usuario. Revoca sesiones si cambia rol o estado. */
export function adminUpdateUser(db: Db, actorId: number, targetId: number, input: AdminUpdateInput): User {
  const target = getUser(db, targetId);
  const changesRole = input.role !== undefined && input.role !== target.role;
  const deactivates = input.isActive === false && target.isActive;

  if (actorId === targetId && (changesRole || deactivates)) {
    throw badRequest('No puedes cambiar tu propio rol ni desactivar tu propia cuenta.', 'SELF_LOCKOUT');
  }
  if (target.role === 'ADMIN' && target.isActive && (changesRole || deactivates) && countActiveAdmins(db) <= 1) {
    throw badRequest('Debe quedar al menos un administrador activo.', 'LAST_ADMIN');
  }

  const updated = db.transaction((tx) => {
    const u = tx
      .update(users)
      .set({ ...input, updatedAt: nowIso() })
      .where(eq(users.id, targetId))
      .returning()
      .get()!;
    if (u.role === 'CLIENT') {
      const existing = tx.select().from(customers).where(eq(customers.userId, u.id)).get();
      if (existing) {
        tx.update(customers).set({ fullName: u.fullName, phone: u.phone }).where(eq(customers.id, existing.id)).run();
      } else {
        tx.insert(customers).values({ userId: u.id, fullName: u.fullName, phone: u.phone, email: u.email }).run();
      }
    }
    return u;
  });

  if (changesRole || deactivates) destroyUserSessions(db, targetId);
  return updated;
}

export function unlockUser(db: Db, userId: number): void {
  getUser(db, userId);
  db.update(users).set({ failedLogins: 0, lockedUntil: null, updatedAt: nowIso() }).where(eq(users.id, userId)).run();
}

export function listUsers(db: Db, f: { role?: Role; q?: string; active?: boolean }): User[] {
  const conds: SQL[] = [];
  if (f.role) conds.push(eq(users.role, f.role));
  if (f.active !== undefined) conds.push(eq(users.isActive, f.active));
  if (f.q) {
    const pattern = `%${f.q.replace(/[%_]/g, '')}%`; // se quitan los comodines que escriba el usuario
    conds.push(or(like(users.email, pattern), like(users.fullName, pattern), like(users.phone, pattern))!);
  }
  return db
    .select()
    .from(users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(users.role), asc(users.fullName))
    .limit(500)
    .all();
}
