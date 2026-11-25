import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

/**
 * Valores que ajusta el admin desde la app. Se guardan en `app_settings`; si una clave no existe,
 * se usa el valor por defecto. Agregar una clave aquí basta para exponerla en la API.
 */
export const SETTINGS = {
  /** Corte a pulso: % del área estimada pendiente que un conteo puede atribuir a la imprecisión (§1.1). */
  freehandTolerancePct: { default: 50, schema: z.number().int().min(0).max(100) },
  /** Cantidad de cortes a pulso sin conciliar a partir de la cual se pide contar la unidad. */
  freehandPendingAlert: { default: 8, schema: z.number().int().min(1).max(1000) },
  /** IVA por defecto de las líneas nuevas, en centésimas de %: 0, 500 (5 %) o 1900 (19 %). Lo define el contador. */
  defaultTaxRateBp: {
    default: 0,
    schema: z.number().int().refine((v) => v === 0 || v === 500 || v === 1900, 'El IVA debe ser 0, 5 o 19 %.'),
  },
  /** Días que una cotización es válida para que el cliente la acepte. */
  quoteValidDays: { default: 15, schema: z.number().int().min(1).max(365) },
  /** Solicitudes de cotización abiertas (NUEVA) que puede tener un cliente a la vez. */
  maxOpenQuoteRequests: { default: 3, schema: z.number().int().min(1).max(50) },
  /** Avisar que hay que comprar cuando, al ritmo de consumo actual, el material dure menos de estos días. */
  stockAlertDays: { default: 15, schema: z.number().int().min(1).max(365) },
  /** Solicitudes de cotización que un cliente puede enviar en 24 horas. */
  quoteRequestsPerDay: { default: 5, schema: z.number().int().min(1).max(100) },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: number };

export function getSettings(db: Pick<Db, 'select'>): Settings {
  const rows = db.select().from(appSettings).all();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Settings;
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const def = SETTINGS[key];
    const parsed = def.schema.safeParse(Number(stored.get(key)));
    out[key] = stored.has(key) && parsed.success ? parsed.data : def.default;
  }
  return out;
}

export const settingsPatchSchema = z
  .object(
    Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.schema.optional()])) as {
      [K in SettingKey]: z.ZodOptional<(typeof SETTINGS)[K]['schema']>;
    },
  )
  .strict();

export function updateSettings(db: Db, patch: Partial<Settings>): Settings {
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      tx.insert(appSettings)
        .values({ key, value: String(value) })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: String(value), updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
        })
        .run();
    }
  });
  return getSettings(db);
}
