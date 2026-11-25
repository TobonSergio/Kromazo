import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Agent, seedUser, setup, type TestCtx } from './helpers.js';
import { computeLine, computeTotals, mulDivRound } from '../src/lib/money.js';
import { nitCheckDigit } from '../src/modules/customers/service.js';

let ctx: TestCtx;
let admin: Agent;
let emp: Agent;
let cli: Agent;
let other: Agent;

beforeEach(async () => {
  ctx = await setup();
  await seedUser(ctx, 'ADMIN', 'admin@test.co');
  await seedUser(ctx, 'EMPLOYEE', 'emp@test.co');
  await seedUser(ctx, 'CLIENT', 'cli@test.co');
  await seedUser(ctx, 'CLIENT', 'otro@test.co');
  [admin, emp, cli, other] = [new Agent(ctx.app), new Agent(ctx.app), new Agent(ctx.app), new Agent(ctx.app)];
  await admin.login('admin@test.co');
  await emp.login('emp@test.co');
  await cli.login('cli@test.co');
  await other.login('otro@test.co');
});
afterEach(async () => {
  await ctx.app.close();
});

/** JPG con EXIF: autor y ubicación GPS, como los de un celular. */
async function phoneJpeg(width = 3000, height = 1500) {
  return sharp({ create: { width, height, channels: 3, background: '#c03030' } })
    .jpeg()
    .withExif({ IFD0: { Artist: 'SECRETO-AUTOR' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '4/1 36/1 0/1' } })
    .toBuffer();
}
const png = () => sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }).png().toBuffer();

const fields = { vehicleDesc: 'Pulsar NS200 negra 2022', description: 'Quiero un wrap mate completo del tanque y tapas.' };

async function newRequest(a: Agent = cli) {
  const res = await a.upload('/api/client/quote-requests', fields, [{ buffer: await phoneJpeg() }]);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request as { id: number; photos: { id: number; url: string; width: number; height: number }[] };
}

const quoteItems = [
  { description: 'Wrap tanque', pricingUnit: 'GLOBAL', quantityMilli: 1000, unitPrice: 250_000, taxRateBp: 1900 },
  { description: 'Vinilo extra', pricingUnit: 'METRO_LINEAL', quantityMilli: 1500, unitPrice: 33_333, discount: 1_000, taxRateBp: 1900 },
];

async function quoteFromRequest(requestId: number) {
  const res = await admin.req('POST', '/api/admin/orders', { quoteRequestId: requestId, items: quoteItems, internalNotes: 'Cliente difícil' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().order as { id: number; code: string; total: number };
}

describe('dinero (funciones puras)', () => {
  it('redondea mitad hacia arriba y calcula IVA por línea sobre la base descontada', () => {
    expect(mulDivRound(1500, 33_333, 1000)).toBe(50_000); // 49.999,5 → 50.000
    expect(computeLine({ quantityMilli: 1500, unitPrice: 33_333, discount: 1000, taxRateBp: 1900 })).toEqual({
      gross: 50_000,
      lineTotal: 49_000,
      taxAmount: 9_310,
    });
    const lines = quoteItems.map((l) => ({ discount: 0, ...l, ...computeLine({ discount: 0, ...l }) }));
    expect(computeTotals(lines)).toEqual({ subtotal: 299_000, discount: 1_000, taxTotal: 56_810, total: 355_810 });
  });

  it('dígito de verificación del NIT', () => {
    expect(nitCheckDigit('800197268')).toBe(4); // NIT de la DIAN: 800.197.268-4
    expect(nitCheckDigit('860.034.313')).toBe(7);
  });
});

describe('catálogo público', () => {
  it('muestra sin sesión solo lo público y activo, sin datos internos', async () => {
    await admin.req('POST', '/api/admin/catalog', { name: 'Wrap completo', kind: 'SERVICIO', pricingUnit: 'GLOBAL', unitPrice: 900_000 });
    await admin.req('POST', '/api/admin/catalog', { name: 'Interno', kind: 'PRODUCTO', pricingUnit: 'UNIDAD', unitPrice: 1, isPublic: false });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/public/catalog' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: { name: string }) => i.name)).toEqual(['Wrap completo']);
    expect(res.body).not.toMatch(/materialId|isPublic|cost/);
  });

  it('cambiar un precio queda en auditoría con el precio anterior', async () => {
    const c = (await admin.req('POST', '/api/admin/catalog', { name: 'Calca', kind: 'PRODUCTO', pricingUnit: 'UNIDAD', unitPrice: 10_000 })).json().item;
    await admin.req('PATCH', `/api/admin/catalog/${c.id}`, { unitPrice: 12_000 });
    const log = ctx.db.$client.prepare("SELECT details_json FROM audit_log WHERE action = 'catalog.update'").get() as { details_json: string };
    expect(JSON.parse(log.details_json)).toMatchObject({ unitPrice: 12_000, previousUnitPrice: 10_000 });
  });
});

describe('solicitudes de cotización con fotos', () => {
  it('re-codifica la foto a JPG de máx. 2000 px y elimina EXIF y GPS', async () => {
    const original = await phoneJpeg();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const r = await newRequest();
    expect(r.photos).toHaveLength(1);
    expect(r.photos[0]).toMatchObject({ width: 2000, height: 1000 });

    const files = fs.readdirSync(ctx.uploadsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}\.jpg$/); // nombre aleatorio, nunca el original
    const stored = fs.readFileSync(path.join(ctx.uploadsDir, files[0]!));
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(stored.includes(Buffer.from('SECRETO-AUTOR'))).toBe(false);

    const served = await cli.req('GET', r.photos[0]!.url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.rawPayload.equals(stored)).toBe(true);
  });

  it('acepta PNG (lo convierte a JPG)', async () => {
    const res = await cli.upload('/api/client/quote-requests', fields, [{ buffer: await png(), filename: 'x.png', type: 'image/png' }]);
    expect(res.statusCode, res.body).toBe(201);
  });

  it('rechaza archivos que no son imagen aunque digan .jpg', async () => {
    const fake = Buffer.from('<?php system($_GET["c"]); ?>'.padEnd(2000, ' '));
    const res = await cli.upload('/api/client/quote-requests', fields, [{ buffer: fake, filename: 'moto.jpg', type: 'image/jpeg' }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_IMAGE');
    expect(fs.readdirSync(ctx.uploadsDir)).toHaveLength(0);
  });

  it('da un mensaje claro con fotos HEIC', async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(200)]);
    const res = await cli.upload('/api/client/quote-requests', fields, [{ buffer: heic, filename: 'IMG_1.HEIC' }]);
    expect(res.json().error).toBe('HEIC_UNSUPPORTED');
  });

  it('rechaza más de 5 fotos, fotos de más de 10 MB y solicitudes sin foto', async () => {
    const img = await phoneJpeg(100, 100);
    const six = await cli.upload('/api/client/quote-requests', fields, Array.from({ length: 6 }, () => ({ buffer: img })));
    expect(six.statusCode).toBe(413);
    const big = await cli.upload('/api/client/quote-requests', fields, [{ buffer: Buffer.concat([img, Buffer.alloc(10 * 1024 * 1024)]) }]);
    expect(big.statusCode).toBe(413);
    expect((await cli.upload('/api/client/quote-requests', fields, [])).statusCode).toBe(400);
    expect(fs.readdirSync(ctx.uploadsDir)).toHaveLength(0);
  });

  it('valida los campos del formulario', async () => {
    const res = await cli.upload('/api/client/quote-requests', { vehicleDesc: 'x', description: 'corto' }, [{ buffer: await phoneJpeg(100, 100) }]);
    expect(res.statusCode).toBe(400);
  });

  it('exige el token CSRF también en la subida de archivos', async () => {
    const res = await cli.upload('/api/client/quote-requests', fields, [{ buffer: await phoneJpeg(100, 100) }], { csrf: false });
    expect(res.statusCode).toBe(403);
  });

  it('las rutas que no son de subida siguen rechazando multipart', async () => {
    const res = await admin.upload('/api/admin/catalog', { name: 'x' }, []);
    expect(res.statusCode).toBe(415);
  });

  it('límite de solicitudes abiertas por cliente', async () => {
    for (let i = 0; i < 3; i++) await newRequest();
    const res = await cli.upload('/api/client/quote-requests', fields, [{ buffer: await phoneJpeg(100, 100) }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('TOO_MANY_OPEN');
  });

  it('un cliente no ve la solicitud ni las fotos de otro (404); el personal sí; anónimo 401', async () => {
    const r = await newRequest();
    expect((await other.req('GET', `/api/client/quote-requests/${r.id}`)).statusCode).toBe(404);
    expect((await other.req('GET', r.photos[0]!.url)).statusCode).toBe(404);
    expect((await other.req('POST', `/api/client/quote-requests/${r.id}/withdraw`)).statusCode).toBe(404);
    expect((await emp.req('GET', r.photos[0]!.url)).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: r.photos[0]!.url })).statusCode).toBe(401);
    expect((await other.req('GET', '/api/client/quote-requests')).json().requests).toHaveLength(0);
  });

  it('el empleado ve las solicitudes y el contacto del cliente', async () => {
    const r = await newRequest();
    const res = await emp.req('GET', `/api/staff/quote-requests/${r.id}`);
    expect(res.json().request.customer).toMatchObject({ fullName: 'Usuario CLIENT' });
  });

  it('el admin descarta con motivo y el cliente lo ve', async () => {
    const r = await newRequest();
    expect((await admin.req('POST', `/api/admin/quote-requests/${r.id}/discard`, { reason: 'No trabajamos ese modelo' })).statusCode).toBe(200);
    const mine = await cli.req('GET', `/api/client/quote-requests/${r.id}`);
    expect(mine.json().request).toMatchObject({ status: 'DESCARTADA', discardReason: 'No trabajamos ese modelo' });
  });
});

describe('cotización → pedido', () => {
  it('flujo completo: cotizar la solicitud, el cliente acepta, el taller trabaja y entrega', async () => {
    const r = await newRequest();
    const o = await quoteFromRequest(r.id);
    expect(o.code).toBe('T-0001');
    expect(o.total).toBe(355_810);
    expect((await cli.req('GET', `/api/client/quote-requests/${r.id}`)).json().request).toMatchObject({
      status: 'COTIZADA',
      order: { id: o.id, code: 'T-0001', status: 'COTIZADO' },
    });
    // No se puede cotizar dos veces la misma solicitud.
    expect((await admin.req('POST', '/api/admin/orders', { quoteRequestId: r.id, items: quoteItems })).statusCode).toBe(400);

    const view = await cli.req('GET', `/api/client/orders/${o.id}`);
    expect(view.json()).toMatchObject({ canRespond: true, expired: false });
    expect(view.json().photos).toHaveLength(1); // ve sus fotos de la solicitud
    expect((await cli.req('POST', `/api/client/orders/${o.id}/accept`)).json().order.status).toBe('APROBADO');

    for (const to of ['EN_PROCESO', 'TERMINADO', 'ENTREGADO']) {
      const res = await emp.req('POST', `/api/staff/orders/${o.id}/status`, { to });
      expect(res.statusCode, `${to}: ${res.body}`).toBe(200);
    }
    const hist = (await admin.req('GET', `/api/admin/orders/${o.id}`)).json().history;
    expect(hist.map((h: { toStatus: string }) => h.toStatus)).toEqual(['COTIZADO', 'APROBADO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO']);
  });

  it('transiciones inválidas y permisos', async () => {
    const o = await quoteFromRequest((await newRequest()).id);
    // El empleado no aprueba cotizaciones ni cancela.
    expect((await emp.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'APROBADO' })).statusCode).toBe(403);
    // Saltar estados no se permite.
    expect((await admin.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'ENTREGADO' })).json().error).toBe('INVALID_TRANSITION');
    await admin.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'APROBADO' });
    expect((await emp.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'CANCELADO', note: 'x' })).statusCode).toBe(403);
    // Cancelar exige motivo.
    expect((await admin.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'CANCELADO' })).statusCode).toBe(400);
    expect((await admin.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'CANCELADO', note: 'El cliente desistió' })).statusCode).toBe(200);
    // Un pedido cancelado no se reabre.
    expect((await admin.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'EN_PROCESO' })).statusCode).toBe(409);
    // El cliente no usa la ruta del personal.
    expect((await cli.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'APROBADO' })).statusCode).toBe(403);
  });

  it('el cliente rechaza; no puede responder dos veces ni la cotización de otro', async () => {
    const o = await quoteFromRequest((await newRequest()).id);
    expect((await other.req('POST', `/api/client/orders/${o.id}/accept`)).statusCode).toBe(404);
    expect((await cli.req('POST', `/api/client/orders/${o.id}/reject`, { reason: 'Muy caro' })).json().order.status).toBe('CANCELADO');
    expect((await cli.req('POST', `/api/client/orders/${o.id}/accept`)).statusCode).toBe(409);
  });

  it('una cotización vencida no se puede aceptar; el admin puede renovarla', async () => {
    const o = await quoteFromRequest((await newRequest()).id);
    await admin.req('PUT', `/api/admin/orders/${o.id}/quote`, { items: quoteItems, quoteValidUntil: '2020-01-01' });
    expect((await cli.req('GET', `/api/client/orders/${o.id}`)).json().expired).toBe(true);
    expect((await cli.req('POST', `/api/client/orders/${o.id}/accept`)).json().error).toBe('QUOTE_EXPIRED');
    await admin.req('PUT', `/api/admin/orders/${o.id}/quote`, { items: quoteItems, quoteValidUntil: '2099-12-31' });
    expect((await cli.req('POST', `/api/client/orders/${o.id}/accept`)).statusCode).toBe(200);
  });

  it('después de aprobada, la cotización no se puede modificar', async () => {
    const o = await quoteFromRequest((await newRequest()).id);
    await cli.req('POST', `/api/client/orders/${o.id}/accept`);
    const res = await admin.req('PUT', `/api/admin/orders/${o.id}/quote`, { items: [{ description: 'x', quantityMilli: 1000, unitPrice: 1 }] });
    expect(res.json().error).toBe('NOT_EDITABLE');
  });

  it('cotización para un cliente del local (sin cuenta) usando el catálogo y el IVA por defecto', async () => {
    await admin.req('PATCH', '/api/admin/settings', { defaultTaxRateBp: 1900 });
    const c = (await admin.req('POST', '/api/admin/customers', { fullName: 'Pedro Mostrador', phone: '3001234567', documentType: 'NIT', documentNumber: '800.197.268' })).json().customer;
    expect(c).toMatchObject({ hasAccount: false, documentNumber: '800197268', nitCheckDigit: 4 });
    const cat = (await admin.req('POST', '/api/admin/catalog', { name: 'Calca tanque', kind: 'PRODUCTO', pricingUnit: 'UNIDAD', unitPrice: 20_000 })).json().item;
    const res = await admin.req('POST', '/api/admin/orders', { customerId: c.id, items: [{ catalogItemId: cat.id, quantityMilli: 2000 }, { description: 'Instalación', quantityMilli: 1000, unitPrice: 10_000 }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().items.map((i: { description: string; taxRateBp: number }) => [i.description, i.taxRateBp])).toEqual([
      ['Calca tanque', 0], // el ítem del catálogo trae su propio IVA (0)
      ['Instalación', 1900], // la línea libre toma el IVA por defecto
    ]);
    expect(res.json().order).toMatchObject({ subtotal: 50_000, taxTotal: 1_900, total: 51_900 });
  });

  it('rechaza un descuento mayor que la línea', async () => {
    const r = await newRequest();
    const res = await admin.req('POST', '/api/admin/orders', { quoteRequestId: r.id, items: [{ description: 'x', quantityMilli: 1000, unitPrice: 100, discount: 101 }] });
    expect(res.statusCode).toBe(400);
  });
});

describe('pagos y factura', () => {
  it('registra abonos sin superar el total y guarda el número de factura', async () => {
    const o = await quoteFromRequest((await newRequest()).id);
    await cli.req('POST', `/api/client/orders/${o.id}/accept`);
    expect((await admin.req('POST', `/api/admin/orders/${o.id}/payments`, { amount: 200_000, method: 'TRANSFERENCIA' })).json()).toMatchObject({ paid: 200_000, balance: 155_810 });
    expect((await admin.req('POST', `/api/admin/orders/${o.id}/payments`, { amount: 155_811, method: 'EFECTIVO' })).json().error).toBe('OVERPAYMENT');
    expect((await emp.req('POST', `/api/admin/orders/${o.id}/payments`, { amount: 1, method: 'EFECTIVO' })).statusCode).toBe(403);
    await admin.req('PATCH', `/api/admin/orders/${o.id}`, { invoiceNumber: 'FE-1001' });
    const mine = (await cli.req('GET', `/api/client/orders/${o.id}`)).json();
    expect(mine).toMatchObject({ paid: 200_000, balance: 155_810, order: { invoiceNumber: 'FE-1001' } });
  });
});

describe('material cargado al trabajo', () => {
  async function rollWithCost() {
    const m = (await admin.req('POST', '/api/admin/materials', { brand: '3M', color: 'Negro', finish: 'MATE', type: 'WRAP', costPerM2: 40_000 })).json().material;
    return (await admin.req('POST', '/api/admin/units', { materialId: m.id, widthMm: 1000, lengthMm: 10_000 })).json().unit;
  }

  it('el corte se vincula a un pedido aprobado; el admin ve costo y margen, el empleado no', async () => {
    const unit = await rollWithCost();
    const o = await quoteFromRequest((await newRequest()).id);
    // Cotizado: aún no se le puede cargar material.
    expect((await emp.req('POST', '/api/staff/cuts', { unitId: unit.id, orderId: o.id, method: 'MEASURED', lengthMm: 500 })).json().error).toBe('ORDER_NOT_ACTIVE');
    await cli.req('POST', `/api/client/orders/${o.id}/accept`);
    // 1000 × 500 = 0,5 m², retazo 0,1 m² vuelve al stock → consumo 0,4 m² × 40.000 = 16.000
    const cut = await emp.req('POST', '/api/staff/cuts', { unitId: unit.id, orderId: o.id, method: 'MEASURED', lengthMm: 500, remnants: [{ widthMm: 500, lengthMm: 200 }] });
    expect(cut.statusCode, cut.body).toBe(201);
    expect(cut.json().cut.orderCode).toBe(o.code);

    const adminView = (await admin.req('GET', `/api/admin/orders/${o.id}`)).json();
    expect(adminView).toMatchObject({ materialCost: 16_000, materialCostEstimated: false, margin: 299_000 - 16_000 });

    const staffView = await emp.req('GET', `/api/staff/orders/${o.id}`);
    expect(staffView.json().cuts[0]).toMatchObject({ consumedAreaMm2: 400_000 });
    expect(staffView.body).not.toMatch(/cost|price|total|margin|paid|balance/i);
  });

  it('un corte a pulso sin conciliar marca el costo como estimado', async () => {
    const unit = await rollWithCost();
    const o = await quoteFromRequest((await newRequest()).id);
    await admin.req('POST', `/api/staff/orders/${o.id}/status`, { to: 'APROBADO' });
    await emp.req('POST', '/api/staff/cuts', { unitId: unit.id, orderId: o.id, method: 'FREEHAND', approxAreaMm2: 250_000 });
    expect((await admin.req('GET', `/api/admin/orders/${o.id}`)).json()).toMatchObject({ materialCost: 10_000, materialCostEstimated: true });
  });
});

describe('fotos del local en el pedido', () => {
  it('el personal agrega fotos (antes/después) y el cliente las ve', async () => {
    const o = await quoteFromRequest((await newRequest()).id);
    const res = await emp.upload(`/api/staff/orders/${o.id}/photos`, {}, [{ buffer: await phoneJpeg(800, 600) }]);
    expect(res.statusCode, res.body).toBe(201);
    const photos = (await cli.req('GET', `/api/client/orders/${o.id}`)).json().photos;
    expect(photos.map((p: { source: string }) => p.source)).toEqual(['REQUEST', 'ORDER']);
    expect((await cli.req('GET', photos[1].url)).statusCode).toBe(200);
    expect((await other.req('GET', photos[1].url)).statusCode).toBe(404);
  });
});

describe('lo que cada rol puede ver', () => {
  it('el cliente nunca recibe notas internas, costos ni datos del personal', async () => {
    const o = await quoteFromRequest((await newRequest()).id);
    await admin.req('PATCH', `/api/admin/customers/${(await admin.req('GET', `/api/admin/orders/${o.id}`)).json().customer.id}`, { notes: 'NOTA-PRIVADA' });
    const bodies = [
      (await cli.req('GET', '/api/client/orders')).body,
      (await cli.req('GET', `/api/client/orders/${o.id}`)).body,
      (await cli.req('GET', '/api/client/quote-requests')).body,
      (await cli.req('GET', '/api/client/profile')).body,
    ];
    for (const b of bodies) {
      expect(b).not.toMatch(/internal|Cliente difícil|NOTA-PRIVADA|cost|margin|userName|Usuario ADMIN/i);
    }
  });

  it('el empleado recorre todas sus rutas GET con datos reales y nunca ve dinero', async () => {
    const r = await newRequest();
    const o = await quoteFromRequest(r.id);
    const ids: Record<string, number> = { orders: o.id, 'quote-requests': r.id };
    const routes = ctx.app.apiRoutes.filter((x) => x.access === 'STAFF' && x.method === 'GET' && /orders|quote-requests/.test(x.url));
    expect(routes.length).toBeGreaterThanOrEqual(4);
    for (const route of routes) {
      const kind = route.url.split('/')[3]!;
      const res = await emp.req('GET', route.url.replace(':id', String(ids[kind])));
      expect(res.statusCode, route.url).toBe(200);
      expect(res.body, route.url).not.toMatch(/cost|price|total|margin|paid|balance|discount|tax/i);
    }
  });

  it('el cliente actualiza sus datos de facturación (el NIT calcula su dígito)', async () => {
    const res = await cli.req('PATCH', '/api/client/profile', { documentType: 'NIT', documentNumber: '800197268', billingEmail: 'facturas@empresa.co' });
    expect(res.json().customer).toMatchObject({ documentNumber: '800197268', nitCheckDigit: 4, billingEmail: 'facturas@empresa.co' });
    // No puede cambiar sus notas internas ni otros campos.
    expect((await cli.req('PATCH', '/api/client/profile', { notes: 'x' })).statusCode).toBe(400);
  });

  it('no se puede editar el nombre de un cliente con cuenta desde el admin', async () => {
    const id = (await cli.req('GET', '/api/client/profile')).json().customer.id;
    expect((await admin.req('PATCH', `/api/admin/customers/${id}`, { fullName: 'Otro Nombre' })).json().error).toBe('LINKED_CUSTOMER');
  });
});
