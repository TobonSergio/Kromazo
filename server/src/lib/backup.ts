import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Db } from '../db/client.js';

/**
 * Respaldo en caliente (la app puede seguir funcionando):
 * - la BD se copia con `VACUUM INTO`, que produce una copia consistente aunque haya escrituras en curso;
 * - la copia se abre y se verifica con `PRAGMA integrity_check` antes de darla por buena;
 * - las fotos se copian de forma incremental (nunca se modifican: tienen nombre aleatorio y solo se agregan);
 * - se conservan las `keep` copias de BD más recientes.
 *
 * Esto deja el respaldo en el mismo servidor. Para que sirva si se pierde el servidor, hay que copiarlo
 * FUERA (ver docs/DESPLIEGUE.md: rclone a otro proveedor).
 */

export interface BackupOptions {
  backupDir: string;
  uploadsDir: string;
  keep: number;
  now?: Date;
}

export interface BackupResult {
  dbFile: string;
  dbBytes: number;
  photosCopied: number;
  photosTotal: number;
  removed: string[];
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261124-231500

export function createBackup(db: Db, opts: BackupOptions): BackupResult {
  const dbDir = path.join(opts.backupDir, 'db');
  const photosDir = path.join(opts.backupDir, 'uploads');
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(photosDir, { recursive: true });

  let dbFile = path.join(dbDir, `negocio-${stamp(opts.now ?? new Date())}.db`);
  for (let i = 1; fs.existsSync(dbFile); i++) dbFile = dbFile.replace(/(-\d+)?\.db$/, `-${i}.db`);
  db.$client.prepare('VACUUM INTO ?').run(dbFile);

  const check = new Database(dbFile, { readonly: true });
  try {
    const result = check.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`La copia no pasó la verificación de integridad: ${String(result)}`);
  } finally {
    check.close();
  }

  let photosCopied = 0;
  let photosTotal = 0;
  if (fs.existsSync(opts.uploadsDir)) {
    for (const name of fs.readdirSync(opts.uploadsDir)) {
      if (!/^[0-9a-f]{32}\.jpg$/.test(name)) continue;
      photosTotal++;
      const target = path.join(photosDir, name);
      if (!fs.existsSync(target)) {
        fs.copyFileSync(path.join(opts.uploadsDir, name), target);
        photosCopied++;
      }
    }
  }

  const all = fs
    .readdirSync(dbDir)
    .filter((f) => /^negocio-\d{8}-\d{6}(-\d+)?\.db$/.test(f))
    .sort()
    .reverse();
  const removed = all.slice(Math.max(1, opts.keep));
  for (const f of removed) fs.rmSync(path.join(dbDir, f));

  return { dbFile, dbBytes: fs.statSync(dbFile).size, photosCopied, photosTotal, removed };
}
