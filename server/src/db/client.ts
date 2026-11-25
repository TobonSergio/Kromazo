import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Abre la BD (':memory:' para pruebas), aplica PRAGMAs y migraciones pendientes. */
export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });

  // Procedimiento recomendado por SQLite para cambiar el esquema: las migraciones que reconstruyen
  // una tabla (p. ej. para cambiar un CHECK) hacen DROP de la tabla vieja, y con las FK activas eso
  // borraría en cascada o fallaría. El PRAGMA no tiene efecto dentro de una transacción, así que se
  // desactiva antes de migrar y se verifica la integridad al terminar.
  sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder: resolveMigrationsDir() });
    const broken = sqlite.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0) {
      throw new Error(`La migración dejó ${broken.length} referencias rotas: ${JSON.stringify(broken.slice(0, 5))}`);
    }
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
  return db as Db;
}

/** En el build (dist/) las migraciones SQL no se copian; se leen siempre desde src/. */
function resolveMigrationsDir(): string {
  if (fs.existsSync(MIGRATIONS_DIR)) return MIGRATIONS_DIR;
  const fromSrc = MIGRATIONS_DIR.replace(`${path.sep}dist${path.sep}src${path.sep}`, `${path.sep}src${path.sep}`);
  if (fs.existsSync(fromSrc)) return fromSrc;
  throw new Error(`No se encontró la carpeta de migraciones (${MIGRATIONS_DIR})`);
}
