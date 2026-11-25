/**
 * Respaldo de la BD y las fotos. Se puede ejecutar con la app funcionando.
 *
 *   npm run backup
 *
 * Variables: BACKUP_DIR (por defecto ./data/backups) y BACKUP_KEEP (copias de BD a conservar, 14).
 * En el servidor lo ejecuta a diario el timer de systemd (deploy/vinilos-backup.timer), que además lo
 * copia fuera del servidor con rclone. Ver docs/DESPLIEGUE.md.
 */
import 'dotenv/config';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/client.js';
import { createBackup } from '../src/lib/backup.js';

const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
try {
  const r = createBackup(db, {
    backupDir: path.resolve(config.BACKUP_DIR),
    uploadsDir: path.resolve(config.UPLOADS_PATH),
    keep: config.BACKUP_KEEP,
  });
  console.log(`Respaldo OK: ${r.dbFile} (${(r.dbBytes / 1024).toFixed(0)} KB, integridad verificada)`);
  console.log(`Fotos: ${r.photosCopied} nuevas copiadas, ${r.photosTotal} en total.`);
  if (r.removed.length) console.log(`Copias antiguas eliminadas: ${r.removed.join(', ')}`);
} catch (err) {
  console.error(`ERROR en el respaldo: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  db.$client.close();
}
