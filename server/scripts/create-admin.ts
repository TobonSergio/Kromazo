/**
 * Crea un administrador desde la terminal. Es la ÚNICA forma de crear el primer admin.
 *
 *   npm run create-admin
 *
 * También acepta variables de entorno (útil para automatizar):
 *   ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD
 */
import 'dotenv/config';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/client.js';
import { audit } from '../src/lib/audit.js';
import { emailSchema, fullNameSchema } from '../src/lib/validation.js';
import { createUser } from '../src/modules/users/service.js';
import { AppError } from '../src/lib/errors.js';

let muted = false;
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

async function askHidden(q: string): Promise<string> {
  process.stdout.write(q);
  muted = true;
  const answer = await ask('');
  muted = false;
  process.stdout.write('\n');
  return answer;
}

async function main() {
  const config = loadConfig();
  const db = openDb(config.DATABASE_PATH);

  const email = emailSchema.parse(process.env.ADMIN_EMAIL ?? (await ask('Correo del administrador: ')));
  const fullName = fullNameSchema.parse(process.env.ADMIN_NAME ?? (await ask('Nombre completo: ')));
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askHidden('Contraseña (mín. 10 caracteres): ');
    const again = await askHidden('Repite la contraseña: ');
    if (password !== again) throw new Error('Las contraseñas no coinciden.');
  }

  const user = await createUser(db, { email, fullName, password, role: 'ADMIN' });
  audit(db, { actorUserId: null, action: 'user.create_admin_cli', entity: 'user', entityId: user.id, details: { email } });
  console.log(`\nAdministrador creado: ${user.email} (id ${user.id}) en ${config.DATABASE_PATH}`);
  db.$client.close();
}

main()
  .catch((err) => {
    const msg = err instanceof AppError ? err.message : err?.issues?.[0]?.message ?? err?.message ?? String(err);
    console.error(`\nError: ${msg}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
