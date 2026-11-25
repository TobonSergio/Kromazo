import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/negocio.db'),
  /** Carpeta de fotos subidas. NUNCA debe estar dentro de la carpeta pública del frontend. */
  UPLOADS_PATH: z.string().min(1).default('./data/uploads'),
  /** Carpeta de respaldos (npm run backup). Debe copiarse FUERA del servidor (ver docs/DESPLIEGUE.md). */
  BACKUP_DIR: z.string().min(1).default('./data/backups'),
  /** Cantidad de copias de la BD que se conservan en BACKUP_DIR. */
  BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
  /** Horas de inactividad tras las cuales la sesión expira. */
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  /** Duración máxima absoluta de una sesión, en días. */
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),
  /** Cookie solo por HTTPS. Debe ser true en producción con dominio. */
  COOKIE_SECURE: bool.optional(),
  /** true si la app corre detrás de un proxy (Caddy/Nginx) que pone X-Forwarded-For. */
  TRUST_PROXY: bool.default(false),
  LOGIN_MAX_FAILED: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
  /** Peticiones por minuto y por IP a /api/auth/*. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  /** Carpeta con el frontend compilado. Vacío = no servir frontend. */
  WEB_DIST_PATH: z.string().default('../web/dist'),
});

export type Config = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida en variables de entorno:\n${problems}`);
  }
  const c = parsed.data;
  return { ...c, COOKIE_SECURE: c.COOKIE_SECURE ?? c.NODE_ENV === 'production' };
}
