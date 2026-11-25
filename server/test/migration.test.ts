import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb } from '../src/db/client.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
let tmp = '';

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** BD "vieja": solo con las primeras `n` migraciones aplicadas. */
function oldDb(n: number): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vinilos-mig-'));
  const dir = path.join(tmp, 'migrations');
  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, n);
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));

  const file = path.join(tmp, 'old.db');
  const s = new Database(file);
  s.pragma('foreign_keys = ON');
  migrate(drizzle(s), { migrationsFolder: dir });
  s.close();
  return file;
}

describe('migraciones sobre una BD con datos', () => {
  it('la Fase 2 agrega EMPLOYEE sin perder usuarios, clientes, sesiones ni auditoría', () => {
    const file = oldDb(1);
    const s = new Database(file);
    s.pragma('foreign_keys = ON');
    s.exec(`
      INSERT INTO users(email,password_hash,role,full_name) VALUES ('a@x.co','h','ADMIN','A'),('c@x.co','h','CLIENT','C');
      INSERT INTO customers(user_id,full_name) VALUES (2,'C');
      INSERT INTO sessions(id_hash,user_id,csrf_token,expires_at,last_seen_at) VALUES ('x',2,'t','2099','2099');
      INSERT INTO audit_log(actor_user_id,action,entity) VALUES (1,'a','b');`);
    s.close();

    const db = openDb(file);
    const c = db.$client;
    const n = (t: string) => (c.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect([n('users'), n('customers'), n('sessions'), n('audit_log')]).toEqual([2, 1, 1, 1]);
    expect(c.pragma('foreign_keys', { simple: true })).toBe(1);

    c.prepare("INSERT INTO users(email,password_hash,role,full_name) VALUES ('e@x.co','h','EMPLOYEE','E')").run();
    expect(() =>
      c.prepare("INSERT INTO users(email,password_hash,role,full_name) VALUES ('z@x.co','h','ROOT','Z')").run(),
    ).toThrow(/CHECK/);
    expect(n('freehand_sizes')).toBe(3);
    c.close();
  });

  it('la Fase 3 conserva clientes e inventario y mantiene los triggers de inmutabilidad', () => {
    const file = oldDb(2);
    const s = new Database(file);
    s.pragma('foreign_keys = ON');
    s.exec(`
      INSERT INTO users(email,password_hash,role,full_name) VALUES ('a@x.co','h','ADMIN','A'),('c@x.co','h','CLIENT','C');
      INSERT INTO customers(user_id,full_name,phone,notes) VALUES (2,'C','300','vip');
      INSERT INTO materials(sku,brand,color,finish,type) VALUES ('M-001','3M','Negro','MATE','WRAP');
      INSERT INTO inventory_units(code,material_id,kind,width_mm,initial_length_mm,balance_mm2) VALUES ('R-001',1,'ROLL',1000,1000,1000000);
      INSERT INTO inventory_movements(unit_id,type,area_mm2,user_id) VALUES (1,'INITIAL_IN',1000000,1);
      INSERT INTO cuts(unit_id,method,cut_length_mm,cut_width_mm,cut_area_mm2,used_area_mm2,waste_area_mm2,user_id)
        VALUES (1,'MEASURED',10,1000,10000,10000,0,1);`);
    s.close();

    const db = openDb(file);
    const c = db.$client;
    expect(c.prepare('SELECT full_name, phone, notes, document_type FROM customers').get()).toEqual({
      full_name: 'C',
      phone: '300',
      notes: 'vip',
      document_type: null,
    });
    expect(() => c.prepare('DELETE FROM cuts').run()).toThrow(/no se borra/);
    expect(() => c.prepare('UPDATE inventory_movements SET area_mm2 = 1').run()).toThrow(/inmutable/);
    expect((c.prepare('SELECT order_id FROM cuts').get() as { order_id: null }).order_id).toBeNull();
    c.close();
  });
});
