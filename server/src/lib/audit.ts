import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export interface AuditEntry {
  actorUserId: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Nunca incluir contraseñas, hashes ni tokens en `details`. */
export function audit(db: Db, e: AuditEntry): void {
  db.insert(auditLog)
    .values({
      actorUserId: e.actorUserId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      detailsJson: e.details ? JSON.stringify(e.details) : null,
      ip: e.ip ?? null,
    })
    .run();
}
