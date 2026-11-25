import 'dotenv/config';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { sessionSettings } from './auth/plugin.js';

const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
const app = await buildApp(config, db);

// Limpieza periódica de sesiones vencidas.
const purge = () => purgeExpiredSessions(db, sessionSettings(config));
purge();
const timer = setInterval(purge, 60 * 60 * 1000);
timer.unref();

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  db.$client.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
