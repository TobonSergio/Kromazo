/**
 * Restaura un respaldo. **Detén la app antes** (sudo systemctl stop vinilos).
 *
 *   npm run restore -- ./data/backups/db/negocio-20261124-231500.db
 *
 * 1. Verifica la integridad del archivo de respaldo.
 * 2. Renombra la BD actual (y sus -wal/-shm) a *.antes-de-restaurar-<fecha>, por si hay que volver atrás.
 * 3. Copia el respaldo como BD activa y aplica las migraciones pendientes (si el respaldo es de una versión anterior).
 * 4. Copia las fotos del respaldo que falten en UPLOADS_PATH.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/client.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Uso: npm run restore -- <archivo de respaldo .db>');
  process.exit(1);
}

const config = loadConfig();
const target = path.resolve(config.DATABASE_PATH);

const check = new Database(file, { readonly: true });
const ok = check.pragma('integrity_check', { simple: true });
check.close();
if (ok !== 'ok') {
  console.error(`El respaldo está dañado (${String(ok)}). No se restauró nada.`);
  process.exit(1);
}

const suffix = `.antes-de-restaurar-${new Date().toISOString().replace(/[:.]/g, '-')}`;
for (const ext of ['', '-wal', '-shm']) {
  if (fs.existsSync(target + ext)) fs.renameSync(target + ext, target + ext + suffix);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(file, target);

const db = openDb(target); // aplica migraciones pendientes y verifica las claves foráneas
const users = (db.$client.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
db.$client.close();

const backupPhotos = path.join(path.dirname(path.dirname(path.resolve(file))), 'uploads');
let restored = 0;
if (fs.existsSync(backupPhotos)) {
  const uploads = path.resolve(config.UPLOADS_PATH);
  fs.mkdirSync(uploads, { recursive: true });
  for (const name of fs.readdirSync(backupPhotos)) {
    if (/^[0-9a-f]{32}\.jpg$/.test(name) && !fs.existsSync(path.join(uploads, name))) {
      fs.copyFileSync(path.join(backupPhotos, name), path.join(uploads, name));
      restored++;
    }
  }
}

console.log(`Restaurado ${file} → ${target} (${users} usuarios). Fotos recuperadas: ${restored}.`);
console.log(`La BD anterior quedó como ${path.basename(target)}${suffix}. Ya puedes iniciar la app.`);
