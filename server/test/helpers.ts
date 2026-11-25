import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { loadConfig, type Config } from '../src/config.js';
import { openDb, type Db } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/modules/users/service.js';
import type { Role } from '../src/db/schema.js';

export const PASSWORD = 'Vinilo-Seguro-2026';

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  config: Config;
  uploadsDir: string;
}

/** Carpeta temporal de fotos por proceso de pruebas; se borra al terminar. */
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'vinilos-test-'));
process.on('exit', () => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));
let n = 0;

export async function setup(overrides: Record<string, string> = {}): Promise<TestCtx> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    WEB_DIST_PATH: '',
    AUTH_RATE_LIMIT_PER_MIN: '1000',
    UPLOADS_PATH: path.join(TMP_ROOT, String(++n)),
    ...overrides,
  });
  const db = openDb(':memory:');
  const app = await buildApp(config, db);
  await app.ready();
  return { app, db, config, uploadsDir: config.UPLOADS_PATH };
}

export async function seedUser(ctx: TestCtx, role: Role, email = `${role.toLowerCase()}@test.co`) {
  return createUser(ctx.db, { email, password: PASSWORD, fullName: `Usuario ${role}`, role });
}

/** Cliente HTTP de prueba que conserva la cookie de sesión y envía el token CSRF, como el navegador. */
export class Agent {
  cookie = '';
  csrf = '';
  constructor(private app: FastifyInstance) {}

  async req(method: InjectOptions['method'], url: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && opts.csrf !== false) headers['x-csrf-token'] = this.csrf;
    const res = await this.app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    this.capture(res);
    return res;
  }

  private capture(res: LightMyRequestResponse) {
    for (const c of res.cookies) {
      if (c.name === 'sid' || c.name === '__Host-sid') this.cookie = c.value ? `${c.name}=${c.value}` : '';
    }
    const json = safeJson(res);
    if (json && typeof json === 'object' && 'csrfToken' in json) this.csrf = (json as { csrfToken: string }).csrfToken ?? '';
  }

  /** Envía multipart/form-data (campos + archivos), como un formulario del navegador. */
  async upload(url: string, fields: Record<string, string>, files: { buffer: Buffer; filename?: string; type?: string }[], opts: { csrf?: boolean } = {}) {
    const boundary = '----vinilos' + Math.random().toString(16).slice(2);
    const chunks: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    for (const f of files) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="${f.filename ?? 'foto.jpg'}"\r\n` +
            `Content-Type: ${f.type ?? 'image/jpeg'}\r\n\r\n`,
        ),
        f.buffer,
        Buffer.from('\r\n'),
      );
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const headers: Record<string, string> = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && opts.csrf !== false) headers['x-csrf-token'] = this.csrf;
    const res = await this.app.inject({ method: 'POST', url, headers, payload: Buffer.concat(chunks) });
    this.capture(res);
    return res;
  }

  login(email: string, password = PASSWORD) {
    return this.req('POST', '/api/auth/login', { email, password });
  }
}

export function safeJson(res: LightMyRequestResponse): unknown {
  try {
    return res.json();
  } catch {
    return null;
  }
}
