import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Agent, seedUser, setup, type TestCtx } from './helpers.js';
import { weightedCost } from '../src/modules/purchases/service.js';
import { stockReport } from '../src/modules/reports/service.js';
import { createBackup } from '../src/lib/backup.js';
import { openDb } from '../src/db/client.js';
import { todayCo } from '../src/modules/orders/service.js';

let ctx: TestCtx;
let admin: Agent;
let emp: Agent;

beforeEach(async () => {
  ctx = await setup();
  await seedUser(ctx, 'ADMIN', 'admin@test.co');
  await seedUser(ctx, 'EMPLOYEE', 'emp@test.co');
  admin = new Agent(ctx.app);
  emp = new Agent(ctx.app);
  await admin.login('admin@test.co');
  await emp.login('emp@test.co');
});
afterEach(async () => {
  await ctx.app.close();
});

async function material(extra: Record<string, unknown> = {}) {
  const r = await admin.req('POST', '/api/admin/materials', { brand: '3M', color: 'Negro', finish: 'MATE', type: 'WRAP', ...extra });
  return r.json().material as { id: number };
}
async function supplier() {
  return (await admin.req('POST', '/api/admin/suppliers', { name: 'Distribuidora Vinilos SAS', phone: '6011234567' })).json().supplier as { id: number };
}
const buy = (body: Record<string, unknown>) => admin.req('POST', '/api/admin/purchases', body);
const today = todayCo();

describe('costo promedio ponderado', () => {
  it('pondera el stock actual con lo comprado', () => {
    // 10 m² a 40.000 + 10 m² comprados por 500.000 (50.000/m²) → 45.000
    expect(weightedCost(10_000_000, 40_000, 10_000_000, 500_000)).toBe(45_000);
    // Sin costo previo o sin stock: el de la compra.
    expect(weightedCost(10_000_000, null, 2_000_000, 100_000)).toBe(50_000);
    expect(weightedCost(0, 40_000, 2_000_000, 100_000)).toBe(50_000);
  });
});

describe('compras', () => {
  it('crea un rollo por unidad comprada, con PURCHASE_IN, y recalcula el costo', async () => {
    const m = await material({ costPerM2: 40_000 });
    await admin.req('POST', '/api/admin/units', { materialId: m.id, widthMm: 1000, lengthMm: 10_000 }); // 10 m² a 40.000
    const s = await supplier();
    // 2 rollos de 1 m × 5 m (5 m² c/u) a 250.000 c/u → 10 m² por 500.000 = 50.000/m²
    const res = await buy({ supplierId: s.id, invoiceRef: 'FV-123', purchasedAt: today, lines: [{ materialId: m.id, rolls: 2, widthMm: 1000, lengthMm: 5000, unitCost: 250_000, location: 'Bodega' }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().createdCodes).toEqual(['R-002', 'R-003']);
    expect(res.json().purchase).toMatchObject({ total: 500_000, supplierName: 'Distribuidora Vinilos SAS' });
    expect(res.json().purchase.lines[0]).toMatchObject({ costPerM2: 50_000, units: [{ code: 'R-002' }, { code: 'R-003' }] });
    expect(res.json().costChanges).toEqual([{ materialId: m.id, label: '3M Negro mate', before: 40_000, after: 45_000 }]);

    const mats = (await admin.req('GET', '/api/admin/materials')).json().materials;
    expect(mats[0]).toMatchObject({ costPerM2: 45_000, stock: { rollsMm2: 20_000_000, activeUnits: 3 } });
    const movs = ctx.db.$client.prepare("SELECT type, area_mm2 FROM inventory_movements WHERE type = 'PURCHASE_IN'").all();
    expect(movs).toEqual([{ type: 'PURCHASE_IN', area_mm2: 5_000_000 }, { type: 'PURCHASE_IN', area_mm2: 5_000_000 }]);
    const log = ctx.db.$client.prepare("SELECT details_json FROM audit_log WHERE action = 'purchase.create'").get() as { details_json: string };
    expect(JSON.parse(log.details_json).costChanges[0]).toMatchObject({ before: 40_000, after: 45_000 });
  });

  it('una compra confirmada no se puede modificar ni borrar', async () => {
    const m = await material();
    const s = await supplier();
    await buy({ supplierId: s.id, purchasedAt: today, lines: [{ materialId: m.id, rolls: 1, widthMm: 1000, lengthMm: 1000, unitCost: 1 }] });
    expect(() => ctx.db.$client.prepare('UPDATE purchases SET total = 0').run()).toThrow(/inmutable/);
    expect(() => ctx.db.$client.prepare('DELETE FROM purchase_lines').run()).toThrow(/inmutable/);
  });

  it('valida: fecha futura, proveedor inexistente, sin líneas; todo o nada', async () => {
    const m = await material();
    const s = await supplier();
    const line = { materialId: m.id, rolls: 1, widthMm: 1000, lengthMm: 1000, unitCost: 1 };
    expect((await buy({ supplierId: s.id, purchasedAt: '2999-01-01', lines: [line] })).statusCode).toBe(400);
    expect((await buy({ supplierId: 999, purchasedAt: today, lines: [line] })).statusCode).toBe(400);
    expect((await buy({ supplierId: s.id, purchasedAt: today, lines: [] })).statusCode).toBe(400);
    // Una línea con material inexistente revierte toda la compra.
    expect((await buy({ supplierId: s.id, purchasedAt: today, lines: [line, { ...line, materialId: 999 }] })).statusCode).toBe(404);
    expect(ctx.db.$client.prepare('SELECT count(*) AS n FROM inventory_units').get()).toEqual({ n: 0 });
    expect(ctx.db.$client.prepare('SELECT count(*) AS n FROM purchases').get()).toEqual({ n: 0 });
  });

  it('el empleado no ve compras, proveedores ni reportes', async () => {
    for (const url of ['/api/admin/purchases', '/api/admin/suppliers', '/api/admin/reports/stock', '/api/admin/reports/sales']) {
      expect((await emp.req('GET', url)).statusCode, url).toBe(403);
    }
  });
});

describe('reportes', () => {
  async function roll(materialId: number, lengthMm = 10_000) {
    return (await admin.req('POST', '/api/admin/units', { materialId, widthMm: 1000, lengthMm })).json().unit as { id: number };
  }
  const cut = (body: Record<string, unknown>) => emp.req('POST', '/api/staff/cuts', body);

  it('stock: consumo promedio diario, días restantes y alerta', async () => {
    const m = await material({ costPerM2: 10_000, minStockMm2: 1_000_000 });
    const r = await roll(m.id); // 10 m²
    // Consumo neto en 30 días: 3 m² cortados − 0,6 m² de retazo = 2,4 m² → 80.000 mm²/día
    await cut({ unitId: r.id, method: 'MEASURED', lengthMm: 3000, remnants: [{ widthMm: 600, lengthMm: 1000 }] });
    const row = stockReport(ctx.db, 30).find((x) => x.materialId === m.id)!;
    expect(row).toMatchObject({ stockMm2: 7_600_000, consumedMm2: 2_400_000, avgDailyMm2: 80_000, daysLeft: 95, lowStock: false, alert: false, stockValue: 76_000 });

    await admin.req('PATCH', '/api/admin/settings', { stockAlertDays: 120 });
    expect((await admin.req('GET', '/api/admin/reports/stock?days=30')).json().materials[0].alert).toBe(true);
  });

  it('desperdicio: solo cortes medidos, por material y por operario', async () => {
    const m = await material();
    const r = await roll(m.id);
    await cut({ unitId: r.id, method: 'MEASURED', lengthMm: 1000, usedAreaMm2: 900_000 }); // 10 % desperdicio
    await cut({ unitId: r.id, method: 'MEASURED', lengthMm: 1000 }); // 0 %
    await cut({ unitId: r.id, method: 'FREEHAND', approxAreaMm2: 500_000 }); // no cuenta
    const w = (await admin.req('GET', '/api/admin/reports/waste')).json();
    expect(w).toMatchObject({ totalCutMm2: 2_000_000, totalWasteMm2: 100_000, wastePct: 5 });
    expect(w.byUser[0]).toMatchObject({ name: 'Usuario EMPLOYEE', cuts: 2, wastePct: 5 });
  });

  it('faltantes: lo no explicado de los conteos, con su valor', async () => {
    const m = await material({ costPerM2: 20_000 });
    const r = await roll(m.id);
    await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: 9500 }); // faltan 0,5 m²
    const s = (await admin.req('GET', '/api/admin/reports/shortages')).json();
    expect(s).toMatchObject({ totalMissingMm2: 500_000, totalMissingValue: 10_000 });
    expect(s.counts[0]).toMatchObject({ unitId: r.id, unexplainedMm2: -500_000, userName: 'Usuario ADMIN' });
  });

  it('cortes a pulso: proporción por operario y precisión de las tallas con sugerencia', async () => {
    const m = await material();
    const r = await roll(m.id, 100_000);
    const mediano = (ctx.db.$client.prepare("SELECT id FROM freehand_sizes WHERE name LIKE 'Mediano%'").get() as { id: number }).id;
    for (let i = 0; i < 5; i++) await cut({ unitId: r.id, method: 'FREEHAND', sizeId: mediano }); // 5 × 0,25 = 1,25 m²
    await cut({ unitId: r.id, method: 'MEASURED', lengthMm: 1000 });
    const system = (ctx.db.$client.prepare('SELECT balance_mm2 AS b FROM inventory_units WHERE id = ?').get(r.id) as { b: number }).b;
    // Faltan 250.000 mm² (= 20 % de lo estimado, dentro de la tolerancia): los cortes gastaron 20 % más.
    await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: (system - 250_000) / 1000 });
    const f = (await admin.req('GET', '/api/admin/reports/freehand')).json();
    expect(f.byUser[0]).toMatchObject({ cuts: 6, freehandCuts: 5, freehandCutsPct: 83.33 });
    const size = f.sizes.find((s: { sizeId: number }) => s.sizeId === mediano);
    expect(size).toMatchObject({ reconciledCuts: 5, realVsEstimatedPct: 120, suggestedRefAreaMm2: 300_000 });
  });

  it('ventas, pagos, cartera y margen por trabajo', async () => {
    const m = await material({ costPerM2: 40_000 });
    const r = await roll(m.id);
    const c = (await admin.req('POST', '/api/admin/customers', { fullName: 'Pedro Mostrador' })).json().customer;
    const mk = async () =>
      (await admin.req('POST', '/api/admin/orders', { customerId: c.id, items: [{ description: 'Wrap', quantityMilli: 1000, unitPrice: 100_000, taxRateBp: 1900 }] })).json().order;
    const a = await mk();
    const b = await mk();
    const cancelled = await mk();
    await mk(); // queda COTIZADO: no es venta
    for (const o of [a, b, cancelled]) await admin.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'APROBADO' });
    await admin.req('POST', `/api/staff/orders/${cancelled.id}/status`, { to: 'CANCELADO', note: 'desistió' });
    await admin.req('POST', `/api/admin/orders/${a.id}/payments`, { amount: 119_000, method: 'EFECTIVO' });
    await admin.req('POST', `/api/admin/orders/${b.id}/payments`, { amount: 50_000, method: 'TRANSFERENCIA' });
    await emp.req('POST', '/api/staff/cuts', { unitId: r.id, orderId: a.id, method: 'MEASURED', lengthMm: 500 }); // 0,5 m² × 40.000 = 20.000

    const s = (await admin.req('GET', '/api/admin/reports/sales')).json();
    expect(s).toMatchObject({ orders: 2, subtotal: 200_000, tax: 38_000, total: 238_000, paymentsTotal: 169_000, receivablesTotal: 69_000 });
    expect(s.byCustomer).toEqual([{ customerId: c.id, name: 'Pedro Mostrador', orders: 2, subtotal: 200_000, tax: 38_000, total: 238_000 }]);
    expect(s.receivables).toEqual([expect.objectContaining({ code: b.code, balance: 69_000 })]);

    const mg = (await admin.req('GET', '/api/admin/reports/margins')).json();
    expect(mg).toMatchObject({ subtotal: 200_000, materialCost: 20_000, margin: 180_000, marginPct: 90 });
    expect(mg.orders.find((o: { code: string }) => o.code === b.code)).toMatchObject({ noCuts: true, materialCost: 0 });
  });

  it('valida el rango de fechas', async () => {
    expect((await admin.req('GET', '/api/admin/reports/sales?from=2026-02-01&to=2026-01-01')).statusCode).toBe(400);
    expect((await admin.req('GET', '/api/admin/reports/sales?from=hoy')).statusCode).toBe(400);
    const res = await admin.req('GET', '/api/admin/reports/sales?from=2020-01-01&to=2020-01-31');
    expect(res.json()).toMatchObject({ range: { from: '2020-01-01', to: '2020-01-31' }, orders: 0 });
  });
});

describe('respaldo', () => {
  let dir = '';
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('copia consistente de la BD y de las fotos; restaurarla recupera todo; rota copias viejas', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinilos-bk-'));
    // Datos: inventario con un corte y una foto de cliente.
    const m = await material({ costPerM2: 1000 });
    const r = (await admin.req('POST', '/api/admin/units', { materialId: m.id, widthMm: 1000, lengthMm: 1000 })).json().unit;
    await emp.req('POST', '/api/staff/cuts', { unitId: r.id, method: 'MEASURED', lengthMm: 100 });
    await seedUser(ctx, 'CLIENT', 'cli@test.co');
    const cli = new Agent(ctx.app);
    await cli.login('cli@test.co');
    const jpg = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await cli.upload('/api/client/quote-requests', { vehicleDesc: 'Moto prueba', description: 'Descripción de prueba' }, [{ buffer: jpg }]);

    const r1 = createBackup(ctx.db, { backupDir: dir, uploadsDir: ctx.uploadsDir, keep: 2, now: new Date('2026-01-01T00:00:00Z') });
    expect(r1).toMatchObject({ photosCopied: 1, photosTotal: 1, removed: [] });

    // "Restaurar": abrir la copia como BD activa.
    const restored = openDb(r1.dbFile);
    const q = (sql: string) => restored.$client.prepare(sql).get();
    expect(q('SELECT count(*) AS n FROM users')).toEqual({ n: 3 });
    expect(q('SELECT count(*) AS n FROM cuts')).toEqual({ n: 1 });
    expect(q('SELECT count(*) AS n FROM attachments')).toEqual({ n: 1 });
    expect(q(`SELECT count(*) AS n FROM inventory_units u WHERE balance_mm2 <> (SELECT sum(area_mm2) FROM inventory_movements m WHERE m.unit_id = u.id)`)).toEqual({ n: 0 });
    const key = (q('SELECT storage_key AS k FROM attachments') as { k: string }).k;
    expect(fs.existsSync(path.join(dir, 'uploads', key))).toBe(true);
    // Los triggers de inmutabilidad viajan con la copia.
    expect(() => restored.$client.prepare('DELETE FROM inventory_movements').run()).toThrow(/inmutable/);
    restored.$client.close();

    // Segunda y tercera copia: las fotos no se vuelven a copiar y se conservan solo 2 copias de BD.
    const r2 = createBackup(ctx.db, { backupDir: dir, uploadsDir: ctx.uploadsDir, keep: 2, now: new Date('2026-01-02T00:00:00Z') });
    expect(r2.photosCopied).toBe(0);
    const r3 = createBackup(ctx.db, { backupDir: dir, uploadsDir: ctx.uploadsDir, keep: 2, now: new Date('2026-01-03T00:00:00Z') });
    expect(r3.removed).toEqual([path.basename(r1.dbFile)]);
    expect(fs.readdirSync(path.join(dir, 'db'))).toHaveLength(2);
  });
});
