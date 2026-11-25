import { hash, verify, Algorithm } from '@node-rs/argon2';

/** Parámetros mínimos recomendados por OWASP para argon2id (19 MiB, 2 iteraciones). */
const ARGON_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128; // límite superior: evita usar el hash como vector de DoS

/** Lista corta de contraseñas obvias. Se compara en minúsculas. */
const COMMON = new Set([
  '1234567890', '12345678910', '0123456789', '1234567891', 'qwertyuiop', 'contraseña', 'contrasena',
  'contrasena1', 'password12', 'password123', 'passwordpassword', 'abcdefghij', 'aaaaaaaaaa',
  '1111111111', '0000000000', 'colombia123', 'colombia2024', 'colombia2025', 'colombia2026',
  'vinilos123', 'motos12345', 'iloveyou12', 'qwerty1234', 'asdfghjkl1', '123456789a', 'a123456789',
  'administrador', 'admin12345', 'admin123456', 'bienvenido1', 'teamo12345',
]);

/** Devuelve el motivo del rechazo, o null si la contraseña es aceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `La contraseña no puede superar ${PASSWORD_MAX} caracteres.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Esa contraseña es demasiado común. Elige otra.';
  if (new Set(lower).size < 4) return 'La contraseña es demasiado repetitiva.';
  const localPart = email?.toLowerCase().split('@')[0] ?? '';
  if (localPart.length >= 4 && lower.includes(localPart)) return 'La contraseña no puede contener tu correo.';
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Hash fijo para gastar el mismo tiempo cuando el usuario no existe (evita enumeración por tiempo). */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  return dummyHash;
}
