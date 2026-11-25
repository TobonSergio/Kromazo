/** Cliente HTTP: envía la cookie de sesión (mismo origen) y el token CSRF en cada petición que modifica datos. */

export type Role = 'ADMIN' | 'EMPLOYEE' | 'CLIENT';

export interface User {
  id: number;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AdminUser extends User {
  lockedUntil: string | null;
  failedLogins: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

/** Se llama cuando el servidor responde 401: la sesión expiró. */
let onUnauthorized: () => void = () => {};
export const setOnUnauthorized = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/login')) onUnauthorized();
    throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? 'Ocurrió un error.');
  }
  return data as T;
}

/** Envía un formulario con archivos (fotos). El navegador pone el Content-Type multipart; el CSRF va en el header. */
export async function apiUpload<T = unknown>(url: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(url, { method: 'POST', headers, credentials: 'same-origin', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const message = res.status === 413 && !data.message ? 'Las fotos son demasiado grandes.' : (data.message ?? 'Ocurrió un error.');
    throw new ApiError(res.status, data.error ?? 'ERROR', message);
  }
  return data as T;
}

export interface AuthResponse {
  user: User | null;
  csrfToken: string | null;
}
