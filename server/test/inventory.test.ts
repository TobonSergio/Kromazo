import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Agent, seedUser, setup, type TestCtx } from './helpers.js';
import { cuts, inventoryMovements, inventoryUnits, physicalCounts } from '../src/db/schema.js';
import { distributeProportionally, reconcile } from '../src/modules/inventory/reconcile.js';

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
  checkInvariants();
  await ctx.app.close();
});

/** Se verifica al final de CADA prueba. */
function checkInvariants() {
  const c = ctx.db.$client;
  const bad = c
    .prepare(
      `SELECT u.code, u.balance_mm2, coalesce(sum(m.area_mm2),0) AS s FROM inventory_units u
       LEFT JOIN inventory_movements m ON m.unit_id = u.id GROUP BY u.id HAVING u.balance_mm2 <> s`,
    )
    .all();
  expect(bad, 'saldo = suma de movimientos').toEqual([]);
  const badCounts = c
    .prepare(
      `SELECT p.id FROM physical_counts p
       LEFT JOIN cuts k ON k.reconciled_count_id = p.id
       GROUP BY p.id HAVING coalesce(sum(k.reconciled_area_mm2 - k.cut_area_mm2), 0) <> -p.freehand_adjust_mm2`,
    )
    .all();
  expect(badCounts, 'Σ(conciliado − estimado) = −ajuste a pulso, sin perder mm²').toEqual([]);
}

async function newMaterial(extra: Record<string, unknown> = {}) {
  const r = await admin.req('POST', '/api/admin/materials', {
    brand: '3M',
    line: '2080',
    color: 'Negro',
    finish: 'MATE',
    type: 'WRAP',
    costPerM2: 40000,
    ...extra,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().material as { id: number; sku: string };
}

/** Rollo de 1,52 m × 10 m = 15,2 m². */
async function newRoll(materialId: number, extra: Record<string, unknown> = {}) {
  const r = await admin.req('POST', '/api/admin/units', { materialId, widthMm: 1520, lengthMm: 10_000, ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().unit as { id: number; code: string; balanceMm2: number };
}

const cut = (a: Agent, body: Record<string, unknown>) => a.req('POST', '/api/staff/cuts', body);
const unitRow = (id: number) => ctx.db.select().from(inventoryUnits).where(eq(inventoryUnits.id, id)).get()!;
const sizes = () => ctx.db.$client.prepare('SELECT id, ref_area_mm2 AS area FROM freehand_sizes ORDER BY sort_order').all() as { id: number; area: number }[];

describe('materiales y rollos', () => {
  it('crea material con referencia automática y un rollo con código R-001', async () => {
    const m = await newMaterial();
    expect(m.sku).toBe('M-001');
    const r = await newRoll(m.id);
    expect(r.code).toBe('R-001');
    expect(r.balanceMm2).toBe(15_200_000);
    expect((await newRoll(m.id)).code).toBe('R-002');
    const mov = ctx.db.select().from(inventoryMovements).where(eq(inventoryMovements.unitId, r.id)).all();
    expect(mov.map((x) => [x.type, x.areaMm2])).toEqual([['INITIAL_IN', 15_200_000]]);
  });

  it('el nombre del material no repite el acabado si el color ya lo incluye', async () => {
    await newMaterial({ sku: 'C1', brand: 'Genérico', line: null, color: 'Fibra de carbono', finish: 'CARBONO' });
    const labels = (await admin.req('GET', '/api/admin/materials')).json().materials.map((m: { label: string }) => m.label);
    expect(labels).toContain('Genérico Fibra de carbono');
  });

  it('rechaza un código de rollo repetido', async () => {
    const m = await newMaterial();
    await newRoll(m.id, { code: 'neg-01' });
    const dup = await admin.req('POST', '/api/admin/units', { materialId: m.id, widthMm: 1520, lengthMm: 1000, code: 'NEG-01' });
    expect(dup.statusCode).toBe(409);
  });
});

describe('corte medido', () => {
  it('descuenta el área, crea retazos y calcula el desperdicio (conservación del área)', async () => {
    const m = await newMaterial();
    const r = await newRoll(m.id);
    // 1520 × 800 = 1.216.000; usado 700.000; retazo 600 × 500 = 300.000 → desperdicio 216.000
    const res = await cut(emp, {
      unitId: r.id,
      method: 'MEASURED',
      lengthMm: 800,
      usedAreaMm2: 700_000,
      remnants: [{ widthMm: 600, lengthMm: 500 }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.cut).toMatchObject({ cutAreaMm2: 1_216_000, usedAreaMm2: 700_000, remnantAreaMm2: 300_000, wasteAreaMm2: 216_000 });
    expect(body.unit.balanceMm2).toBe(15_200_000 - 1_216_000);
    expect(body.remnants).toHaveLength(1);
    expect(body.remnants[0]).toMatchObject({ code: 'RZ-001', kind: 'REMNANT', balanceMm2: 300_000, widthMm: 500, initialLengthMm: 600, parentCode: 'R-001' });
    expect(body.cut.remnantCodes).toEqual(['RZ-001']);
  });

  it('sin área usada, todo lo que no es retazo cuenta como usado', async () => {
    const r = await newRoll((await newMaterial()).id);
    const res = await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 1000 });
    expect(res.json().cut).toMatchObject({ cutAreaMm2: 1_520_000, usedAreaMm2: 1_520_000, wasteAreaMm2: 0 });
  });

  it('un retazo se puede volver a cortar', async () => {
    const r = await newRoll((await newMaterial()).id);
    const first = await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 1000, remnants: [{ widthMm: 1000, lengthMm: 600 }] });
    const rz = first.json().remnants[0];
    const again = await cut(emp, { unitId: rz.id, method: 'MEASURED', lengthMm: 300, widthMm: 600 });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().unit.balanceMm2).toBe(600_000 - 180_000);
    // Un corte que no cabe en el retazo se rechaza.
    expect((await cut(emp, { unitId: rz.id, method: 'MEASURED', lengthMm: 1100, widthMm: 100 })).statusCode).toBe(400);
  });

  it('rechaza: corte mayor que el saldo (sin stock negativo), retazos mayores que el corte, ancho mayor que el rollo', async () => {
    const r = await newRoll((await newMaterial()).id, { lengthMm: 1000 });
    const over = await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 1001 });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toBe('INSUFFICIENT_STOCK');
    expect((await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 100, remnants: [{ widthMm: 1520, lengthMm: 200 }] })).statusCode).toBe(400);
    expect((await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 100, usedAreaMm2: 152_001 })).statusCode).toBe(400);
    expect((await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 100, widthMm: 1600 })).statusCode).toBe(400);
    expect(unitRow(r.id).balanceMm2).toBe(1_520_000);
    expect(ctx.db.select().from(cuts).all()).toHaveLength(0); // nada quedó a medias
  });

  it('al llegar a 0 con cortes medidos, la unidad queda AGOTADA y ya no se puede cortar', async () => {
    const r = await newRoll((await newMaterial()).id, { lengthMm: 1000 });
    const res = await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 1000 });
    expect(res.json().unit.status).toBe('DEPLETED');
    expect((await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 1 })).json().error).toBe('UNIT_NOT_ACTIVE');
  });
});

describe('corte a pulso', () => {
  it('con talla: descuenta el área de referencia, sin desperdicio, y queda pendiente de conciliar', async () => {
    const r = await newRoll((await newMaterial()).id);
    const mediano = sizes()[1]!;
    const res = await cut(emp, { unitId: r.id, method: 'FREEHAND', sizeId: mediano.id });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().cut).toMatchObject({ method: 'FREEHAND', cutAreaMm2: 250_000, wasteAreaMm2: 0, reconciled: false });
    expect(res.json().unit.pendingFreehand).toEqual({ count: 1, areaMm2: 250_000 });
  });

  it('con área o largo aproximado; exige exactamente una forma de estimar', async () => {
    const r = await newRoll((await newMaterial()).id);
    expect((await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 120_000 })).json().cut.cutAreaMm2).toBe(120_000);
    expect((await cut(emp, { unitId: r.id, method: 'FREEHAND', lengthMm: 300, widthMm: 400 })).json().cut.cutAreaMm2).toBe(120_000);
    expect((await cut(emp, { unitId: r.id, method: 'FREEHAND', lengthMm: 100 })).json().cut.cutAreaMm2).toBe(152_000);
    expect((await cut(emp, { unitId: r.id, method: 'FREEHAND' })).statusCode).toBe(400);
    expect((await cut(emp, { unitId: r.id, method: 'FREEHAND', sizeId: sizes()[0]!.id, approxAreaMm2: 5 })).statusCode).toBe(400);
    // El desperdicio no se separa en cortes a pulso.
    expect((await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 1000, usedAreaMm2: 10 })).statusCode).toBe(400);
  });

  it('una talla de otro tipo de material no aplica', async () => {
    const r = await newRoll((await newMaterial()).id);
    const s = await admin.req('POST', '/api/admin/freehand-sizes', { name: 'Calca', refAreaMm2: 10_000, materialType: 'CALCA' });
    expect((await cut(emp, { unitId: r.id, method: 'FREEHAND', sizeId: s.json().size.id })).statusCode).toBe(400);
  });

  it('si el saldo llega a 0 por estimaciones, NO se da por agotada: pide conteo', async () => {
    const r = await newRoll((await newMaterial()).id, { lengthMm: 1000 }); // 1.520.000
    const res = await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 1_520_000 });
    expect(res.json().unit).toMatchObject({ status: 'ACTIVE', balanceMm2: 0, needsCount: true });
  });
});

describe('conteo físico y conciliación', () => {
  it('sin cortes a pulso: toda la diferencia es faltante no explicado', async () => {
    const r = await newRoll((await newMaterial()).id);
    await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 1000 });
    // El sistema espera 9 m de largo; se miden 8,9 m → faltan 100 mm × 1520.
    const res = await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: 8900 });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().count).toMatchObject({ freehandAdjustMm2: 0, unexplainedMm2: -152_000 });
    expect(res.json().unit.balanceMm2).toBe(8900 * 1520);
  });

  it('dentro de la tolerancia: la diferencia se atribuye a los cortes a pulso', async () => {
    const r = await newRoll((await newMaterial()).id);
    await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 304_000 });
    await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 152_000 });
    const system = unitRow(r.id).balanceMm2; // 14.744.000 = 9700 mm × 1520
    // Tolerancia 50 % de 456.000 = 228.000. Faltan 91.200 (60 mm × 1520) → todo atribuible.
    const lengthMm = (system - 91_200) / 1520;
    const res = await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: lengthMm });
    expect(res.json().count).toMatchObject({ freehandAdjustMm2: -91_200, unexplainedMm2: 0 });
    const rec = ctx.db.select().from(cuts).all().map((c) => c.reconciledAreaMm2);
    expect(rec).toEqual([304_000 + 60_800, 152_000 + 30_400]); // proporcional 2:1, gastaron más
    expect(res.json().unit.pendingFreehand.count).toBe(0);
  });

  it('fuera de la tolerancia: lo que excede es faltante no explicado', async () => {
    const r = await newRoll((await newMaterial()).id);
    await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 304_000 });
    const system = unitRow(r.id).balanceMm2;
    // Faltan 456.000 (300 mm × 1520); tolerancia 152.000 → 304.000 sin explicar.
    const res = await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: (system - 456_000) / 1520 });
    expect(res.json().count).toMatchObject({ freehandAdjustMm2: -152_000, unexplainedMm2: -304_000 });
    const movs = ctx.db.select().from(inventoryMovements).where(eq(inventoryMovements.unitId, r.id)).all();
    expect(movs.filter((m) => m.countId !== null).map((m) => [m.type, m.areaMm2])).toEqual([
      ['FREEHAND_ADJUST', -152_000],
      ['COUNT_ADJUST', -304_000],
    ]);
  });

  it('sobrante: los cortes gastaron menos de lo estimado', async () => {
    const r = await newRoll((await newMaterial()).id);
    await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 304_000 });
    const system = unitRow(r.id).balanceMm2;
    const res = await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: (system + 76_000) / 1520 });
    expect(res.json().count).toMatchObject({ freehandAdjustMm2: 76_000, unexplainedMm2: 0 });
    expect(ctx.db.select().from(cuts).get()!.reconciledAreaMm2).toBe(228_000);
  });

  it('un corte conciliado no se vuelve a ajustar en el siguiente conteo', async () => {
    const r = await newRoll((await newMaterial()).id);
    await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 304_000 });
    const s1 = unitRow(r.id).balanceMm2;
    await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: s1 / 1520 });
    const s2 = unitRow(r.id).balanceMm2;
    const res = await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: (s2 - 15_200) / 1520 });
    expect(res.json().count).toMatchObject({ freehandAdjustMm2: 0, unexplainedMm2: -15_200 });
  });

  it('conteo por peso: área = (peso − tubo) / gramaje', async () => {
    const m = await newMaterial({ gramsPerM2: 200 });
    const r = await newRoll(m.id, { coreWeightG: 800 }); // 15,2 m² → 3040 g de vinilo
    const res = await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'WEIGHT', measuredWeightG: 800 + 2000 });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().count.computedAreaMm2).toBe(10_000_000); // 2000 g / 200 g/m² = 10 m²
    expect(res.json().count.unexplainedMm2).toBe(-5_200_000);
  });

  it('conteo por peso exige gramaje y peso del tubo', async () => {
    const sinGramaje = await newRoll((await newMaterial()).id, { coreWeightG: 800 });
    expect((await admin.req('POST', `/api/admin/units/${sinGramaje.id}/counts`, { method: 'WEIGHT', measuredWeightG: 2000 })).json().error).toBe('NO_GSM');
    const sinTubo = await newRoll((await newMaterial({ sku: 'X', gramsPerM2: 200 })).id);
    expect((await admin.req('POST', `/api/admin/units/${sinTubo.id}/counts`, { method: 'WEIGHT', measuredWeightG: 2000 })).json().error).toBe('NO_CORE');
  });

  it('contar 0 deja la unidad agotada; encontrar material la reactiva', async () => {
    const r = await newRoll((await newMaterial()).id);
    expect((await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: 0 })).json().unit.status).toBe('DEPLETED');
    expect((await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: 500 })).json().unit.status).toBe('ACTIVE');
  });
});

describe('ajustes y bajas', () => {
  it('el ajuste exige motivo y no deja saldo negativo', async () => {
    const r = await newRoll((await newMaterial()).id);
    expect((await admin.req('POST', `/api/admin/units/${r.id}/adjust`, { areaMm2: -1000 })).statusCode).toBe(400);
    expect((await admin.req('POST', `/api/admin/units/${r.id}/adjust`, { areaMm2: -16_000_000, reason: 'error de alta' })).statusCode).toBe(409);
    const ok = await admin.req('POST', `/api/admin/units/${r.id}/adjust`, { areaMm2: -200_000, reason: 'Se dañó una punta' });
    expect(ok.json().unit.balanceMm2).toBe(15_000_000);
  });

  it('la baja descuenta el saldo restante y la unidad ya no se puede usar', async () => {
    const r = await newRoll((await newMaterial()).id);
    const res = await admin.req('POST', `/api/admin/units/${r.id}/discard`, { reason: 'Rollo mojado' });
    expect(res.json().unit).toMatchObject({ status: 'DISCARDED', balanceMm2: 0 });
    expect((await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 1 })).statusCode).toBe(409);
  });
});

describe('libro inmutable', () => {
  it('los movimientos y conteos no se pueden modificar ni borrar', async () => {
    const r = await newRoll((await newMaterial()).id);
    await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: 9000 });
    expect(() => ctx.db.update(inventoryMovements).set({ areaMm2: 1 }).run()).toThrow(/inmutable/);
    expect(() => ctx.db.delete(inventoryMovements).run()).toThrow(/inmutable/);
    expect(() => ctx.db.update(physicalCounts).set({ notes: 'x' }).run()).toThrow(/inmutable/);
  });

  it('un corte no se puede borrar ni cambiar su área', async () => {
    const r = await newRoll((await newMaterial()).id);
    await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 100 });
    expect(() => ctx.db.delete(cuts).run()).toThrow();
    expect(() => ctx.db.update(cuts).set({ usedAreaMm2: 1 }).run()).toThrow();
  });

  it('la BD rechaza un corte que no conserva el área', () => {
    expect(() =>
      ctx.db.$client
        .prepare(
          `INSERT INTO cuts (unit_id, method, cut_length_mm, cut_width_mm, cut_area_mm2, used_area_mm2, waste_area_mm2, user_id)
           VALUES (1, 'MEASURED', 10, 10, 100, 50, 0, 1)`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });
});

describe('empleado', () => {
  it('registra cortes y ve stock, pero NUNCA costos', async () => {
    const m = await newMaterial();
    const r = await newRoll(m.id);
    await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 100 });
    const staffGets = ctx.app.apiRoutes.filter(
      (x) => x.access === 'STAFF' && x.method === 'GET' && /^\/api\/staff\/(materials|units|freehand-sizes|cuts)/.test(x.url),
    );
    expect(staffGets.length).toBeGreaterThanOrEqual(4);
    for (const route of staffGets) {
      const res = await emp.req('GET', route.url.replace(':id', String(r.id)));
      expect(res.statusCode, route.url).toBe(200);
      expect(res.body.toLowerCase(), route.url).not.toContain('cost');
      expect(res.body.toLowerCase(), route.url).not.toContain('value');
    }
  });

  it('no puede contar, ajustar, dar de baja ni ver costos', async () => {
    const r = await newRoll((await newMaterial()).id);
    expect((await emp.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: 1 })).statusCode).toBe(403);
    expect((await emp.req('POST', `/api/admin/units/${r.id}/adjust`, { areaMm2: 1, reason: 'abc' })).statusCode).toBe(403);
    expect((await emp.req('POST', `/api/admin/units/${r.id}/discard`, { reason: 'abc' })).statusCode).toBe(403);
    expect((await emp.req('GET', '/api/admin/materials')).statusCode).toBe(403);
  });

  it('cada corte guarda quién lo registró', async () => {
    const r = await newRoll((await newMaterial()).id);
    await cut(emp, { unitId: r.id, method: 'MEASURED', lengthMm: 100 });
    const mine = await emp.req('GET', '/api/staff/cuts?mine=true');
    expect(mine.json().cuts).toHaveLength(1);
    expect(mine.json().cuts[0].userName).toBe('Usuario EMPLOYEE');
    expect((await admin.req('GET', '/api/staff/cuts?mine=true')).json().cuts).toHaveLength(0);
  });
});

describe('configuración', () => {
  it('el admin cambia la tolerancia y se usa en el siguiente conteo', async () => {
    expect((await admin.req('PATCH', '/api/admin/settings', { freehandTolerancePct: 101 })).statusCode).toBe(400);
    expect((await admin.req('PATCH', '/api/admin/settings', { freehandTolerancePct: 0 })).json().settings.freehandTolerancePct).toBe(0);
    const r = await newRoll((await newMaterial()).id);
    await cut(emp, { unitId: r.id, method: 'FREEHAND', approxAreaMm2: 304_000 });
    const system = unitRow(r.id).balanceMm2;
    const res = await admin.req('POST', `/api/admin/units/${r.id}/counts`, { method: 'LENGTH', measuredLengthMm: (system - 15_200) / 1520 });
    expect(res.json().count).toMatchObject({ freehandAdjustMm2: 0, unexplainedMm2: -15_200 });
  });
});

describe('reparto proporcional (función pura)', () => {
  it('suma exactamente el total, con signo', () => {
    expect(distributeProportionally(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(distributeProportionally(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
    expect(distributeProportionally(7, [0, 5, 0])).toEqual([0, 7, 0]);
    expect(distributeProportionally(5, [])).toEqual([]);
  });

  it('no desborda con rollos grandes (usa BigInt)', () => {
    const w = [152_000_000, 76_000_000, 1];
    const parts = distributeProportionally(-99_999_999, w);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-99_999_999);
  });

  it('propiedad: para muchos casos aleatorios, la suma se conserva y nada queda negativo', () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 500; i++) {
      const est = Array.from({ length: 1 + rnd(6) }, () => 1 + rnd(2_000_000));
      const diff = rnd(4_000_000) - 2_000_000;
      const pct = rnd(101);
      const r = reconcile(diff, est, pct);
      expect(r.freehandAdjust + r.unexplained).toBe(diff);
      expect(r.reconciledAreas.reduce((a, b, j) => a + (b - est[j]!), 0) + r.freehandAdjust).toBe(0);
      expect(r.reconciledAreas.every((x) => x >= 0)).toBe(true);
    }
  });
});
