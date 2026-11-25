import { z } from 'zod';

/** Valida con Zod; un fallo lo convierte el manejador de errores en 400. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Correo electrónico inválido.' }));

export const fullNameSchema = z.string().trim().min(2, 'El nombre es muy corto.').max(120);

export const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .regex(/^[0-9+()\s-]*$/, 'Teléfono inválido.')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
