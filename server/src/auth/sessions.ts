import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users, type User } from '../db/schema.js';

export interface SessionSettings {
  idleHours: number;
  maxDays: number;
}

export interface ActiveSession {
  idHash: string;
  csrfToken: string;
  user: User;
}

const HOUR = 3_600_000;
/** Solo se reescribe last_seen_at si pasó al menos este tiempo (evita una escritura por petición). */
const TOUCH_INTERVAL_MS = 60_000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export function createSession(
  db: Db,
  userId: number,
  s: SessionSettings,
  meta: { ip?: string; userAgent?: string } = {},
  nowMs = Date.now(),
): { token: string; csrfToken: string; expiresAt: Date } {
  const token = newToken();
  const csrfToken = newToken();
  const expiresAt = new Date(nowMs + s.maxDays * 24 * HOUR);
  db.insert(sessions)
    .values({
      idHash: sha256(token),
      userId,
      csrfToken,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastSeenAt: new Date(nowMs).toISOString(),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    })
    .run();
  return { token, csrfToken, expiresAt };
}

/** Valida el token de la cookie. Devuelve null (y borra la sesión si aplica) cuando no es válida. */
export function getSession(db: Db, token: string, s: SessionSettings, nowMs = Date.now()): ActiveSession | null {
  if (!token || token.length > 100) return null;
  const idHash = sha256(token);
  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.idHash, idHash))
    .get();
  if (!row) return null;

  const expired = Date.parse(row.session.expiresAt) <= nowMs;
  const idle = Date.parse(row.session.lastSeenAt) + s.idleHours * HOUR <= nowMs;
  if (expired || idle || !row.user.isActive) {
    db.delete(sessions).where(eq(sessions.idHash, idHash)).run();
    return null;
  }
  if (nowMs - Date.parse(row.session.lastSeenAt) >= TOUCH_INTERVAL_MS) {
    db.update(sessions).set({ lastSeenAt: new Date(nowMs).toISOString() }).where(eq(sessions.idHash, idHash)).run();
  }
  return { idHash, csrfToken: row.session.csrfToken, user: row.user };
}

export function destroySession(db: Db, idHash: string): void {
  db.delete(sessions).where(eq(sessions.idHash, idHash)).run();
}

/** Cierra todas las sesiones de un usuario (cambio de clave, desactivación, cambio de rol). */
export function destroyUserSessions(db: Db, userId: number, exceptIdHash?: string): void {
  const all = db.select({ idHash: sessions.idHash }).from(sessions).where(eq(sessions.userId, userId)).all();
  for (const { idHash } of all) if (idHash !== exceptIdHash) destroySession(db, idHash);
}

export function purgeExpiredSessions(db: Db, s: SessionSettings, nowMs = Date.now()): number {
  const idleCutoff = new Date(nowMs - s.idleHours * HOUR).toISOString();
  return db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, new Date(nowMs).toISOString()), lt(sessions.lastSeenAt, idleCutoff)))
    .run().changes;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
