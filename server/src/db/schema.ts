import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * Fase 1: usuarios, sesiones, clientes y auditoría.
 * Fase 2: materiales, unidades de inventario (rollos y retazos), movimientos, cortes y conteos.
 * Fechas: texto ISO-8601 en UTC (comparables lexicográficamente).
 * Dinero: pesos enteros. Medidas: mm / mm² enteros.
 */

export const ROLES = ['ADMIN', 'EMPLOYEE', 'CLIENT'] as const;
export type Role = (typeof ROLES)[number];

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: text('locked_until'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    // El email se guarda normalizado (minúsculas, sin espacios) por la aplicación.
    uniqueIndex('users_email_unique').on(t.email),
    check('users_role_check', sql`${t.role} IN ('ADMIN','EMPLOYEE','CLIENT')`),
    check('users_email_lower', sql`${t.email} = lower(trim(${t.email}))`),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 (hex) del token. El token en claro solo existe en la cookie del navegador. */
    idHash: text('id_hash').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    createdAt: text('created_at').notNull().default(now),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const DOCUMENT_TYPES = ['CC', 'NIT', 'CE', 'PASAPORTE', 'OTRO'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Cliente del negocio. Puede existir sin cuenta (quien llega al local) o vinculado a un usuario. */
export const customers = sqliteTable(
  'customers',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    email: text('email'),
    // Datos para facturar (opcionales hasta la Fase 5, ver ARQUITECTURA §1.4)
    documentType: text('document_type', { enum: DOCUMENT_TYPES }),
    documentNumber: text('document_number'),
    /** Dígito de verificación del NIT; lo calcula el sistema. */
    nitCheckDigit: integer('nit_check_digit'),
    billingEmail: text('billing_email'),
    /** Notas internas: el cliente nunca las ve. */
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('customers_user_unique').on(t.userId),
    check('customers_doc_type_check', sql`${t.documentType} IS NULL OR ${t.documentType} IN ('CC','NIT','CE','PASAPORTE','OTRO')`),
    check('customers_nit_dv_check', sql`${t.nitCheckDigit} IS NULL OR (${t.nitCheckDigit} BETWEEN 0 AND 9 AND ${t.documentType} = 'NIT')`),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: integer('entity_id'),
    detailsJson: text('details_json'),
    ip: text('ip'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
);

/** Valores configurables por el admin (clave → valor en texto). Ver lib/settings.ts. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

// ============ MATERIALES E INVENTARIO (Fase 2) ============

export const FINISHES = [
  'MATE',
  'BRILLANTE',
  'SATINADO',
  'METALIZADO',
  'CROMADO',
  'CARBONO',
  'TORNASOL',
  'REFLECTIVO',
  'TRANSPARENTE',
  'OTRO',
] as const;
export const MATERIAL_TYPES = ['VINILO_CORTE', 'VINILO_IMPRESION', 'WRAP', 'LAMINADO', 'CALCA', 'OTRO'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

/** "Referencia": qué es el material, no cuánto hay. */
export const materials = sqliteTable(
  'materials',
  {
    id: integer('id').primaryKey(),
    sku: text('sku').notNull(),
    brand: text('brand').notNull(),
    line: text('line'),
    color: text('color').notNull(),
    finish: text('finish', { enum: FINISHES }).notNull(),
    type: text('type', { enum: MATERIAL_TYPES }).notNull(),
    /** Opcional: habilita el conteo por peso. */
    gramsPerM2: integer('grams_per_m2'),
    /** Costo por m² en pesos. Solo lo ve el admin. */
    costPerM2: integer('cost_per_m2'),
    minStockMm2: integer('min_stock_mm2').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('materials_sku_unique').on(t.sku),
    check(
      'materials_finish_check',
      sql`${t.finish} IN ('MATE','BRILLANTE','SATINADO','METALIZADO','CROMADO','CARBONO','TORNASOL','REFLECTIVO','TRANSPARENTE','OTRO')`,
    ),
    check(
      'materials_type_check',
      sql`${t.type} IN ('VINILO_CORTE','VINILO_IMPRESION','WRAP','LAMINADO','CALCA','OTRO')`,
    ),
    check('materials_gsm_check', sql`${t.gramsPerM2} IS NULL OR ${t.gramsPerM2} > 0`),
    check('materials_cost_check', sql`${t.costPerM2} IS NULL OR ${t.costPerM2} >= 0`),
    check('materials_min_stock_check', sql`${t.minStockMm2} >= 0`),
  ],
);

export const UNIT_KINDS = ['ROLL', 'REMNANT'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];
export const UNIT_STATUSES = ['ACTIVE', 'DEPLETED', 'DISCARDED'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** Rollo o retazo físico, con su etiqueta. */
export const inventoryUnits = sqliteTable(
  'inventory_units',
  {
    id: integer('id').primaryKey(),
    code: text('code').notNull(),
    materialId: integer('material_id')
      .notNull()
      .references(() => materials.id),
    kind: text('kind', { enum: UNIT_KINDS }).notNull(),
    widthMm: integer('width_mm').notNull(),
    initialLengthMm: integer('initial_length_mm').notNull(),
    /** Peso del tubo (solo rollos), para el conteo por peso. */
    coreWeightG: integer('core_weight_g'),
    parentUnitId: integer('parent_unit_id').references((): AnySQLiteColumn => inventoryUnits.id),
    sourceCutId: integer('source_cut_id').references((): AnySQLiteColumn => cuts.id),
    /** Compra de la que salió el rollo (Fase 4). */
    purchaseLineId: integer('purchase_line_id').references((): AnySQLiteColumn => purchaseLines.id),
    location: text('location'),
    status: text('status', { enum: UNIT_STATUSES }).notNull().default('ACTIVE'),
    /** Caché de SUM(inventory_movements.area_mm2); se actualiza en la misma transacción. */
    balanceMm2: integer('balance_mm2').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('units_code_unique').on(t.code),
    index('units_material_status_idx').on(t.materialId, t.status),
    check('units_kind_check', sql`${t.kind} IN ('ROLL','REMNANT')`),
    check('units_status_check', sql`${t.status} IN ('ACTIVE','DEPLETED','DISCARDED')`),
    check('units_width_check', sql`${t.widthMm} > 0`),
    check('units_length_check', sql`${t.initialLengthMm} > 0`),
    check('units_core_check', sql`${t.coreWeightG} IS NULL OR ${t.coreWeightG} >= 0`),
    check('units_balance_check', sql`${t.balanceMm2} >= 0`),
  ],
);

export const MOVEMENT_TYPES = [
  'INITIAL_IN', // alta manual de un rollo: inventario inicial o entrada sin compra (+)
  'PURCHASE_IN', // entrada por compra (+), Fase 4
  'REMNANT_IN', // alta de un retazo generado por un corte (+)
  'CUT_OUT', // salida por corte (−); el desglose está en cuts
  'FREEHAND_ADJUST', // parte de un conteo atribuida a cortes a pulso (±)
  'COUNT_ADJUST', // diferencia no explicada contra un conteo físico (±)
  'MANUAL_ADJUST', // corrección con motivo (±)
  'DISCARD', // baja del saldo restante (−)
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Libro inmutable (triggers en la migración): única fuente de verdad del stock. */
export const inventoryMovements = sqliteTable(
  'inventory_movements',
  {
    id: integer('id').primaryKey(),
    unitId: integer('unit_id')
      .notNull()
      .references(() => inventoryUnits.id),
    type: text('type', { enum: MOVEMENT_TYPES }).notNull(),
    /** Con signo. */
    areaMm2: integer('area_mm2').notNull(),
    cutId: integer('cut_id').references((): AnySQLiteColumn => cuts.id),
    countId: integer('count_id').references((): AnySQLiteColumn => physicalCounts.id),
    reason: text('reason'),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('movements_unit_idx').on(t.unitId),
    index('movements_created_idx').on(t.createdAt),
    check(
      'movements_type_check',
      sql`${t.type} IN ('INITIAL_IN','PURCHASE_IN','REMNANT_IN','CUT_OUT','FREEHAND_ADJUST','COUNT_ADJUST','MANUAL_ADJUST','DISCARD')`,
    ),
    check('movements_area_check', sql`${t.areaMm2} <> 0`),
    check(
      'movements_sign_check',
      sql`(${t.type} IN ('INITIAL_IN','PURCHASE_IN','REMNANT_IN') AND ${t.areaMm2} > 0) OR (${t.type} IN ('CUT_OUT','DISCARD') AND ${t.areaMm2} < 0) OR ${t.type} IN ('FREEHAND_ADJUST','COUNT_ADJUST','MANUAL_ADJUST')`,
    ),
  ],
);

/** Tallas para cortes a pulso (las configura el admin). */
export const freehandSizes = sqliteTable(
  'freehand_sizes',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    refAreaMm2: integer('ref_area_mm2').notNull(),
    /** NULL = aplica a todos los tipos de material. */
    materialType: text('material_type', { enum: MATERIAL_TYPES }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [check('freehand_area_check', sql`${t.refAreaMm2} > 0`)],
);

export const CUT_METHODS = ['MEASURED', 'FREEHAND'] as const;
export type CutMethod = (typeof CUT_METHODS)[number];

/** El evento central. Ver docs/ARQUITECTURA.md §1 y §1.1. */
export const cuts = sqliteTable(
  'cuts',
  {
    id: integer('id').primaryKey(),
    unitId: integer('unit_id')
      .notNull()
      .references((): AnySQLiteColumn => inventoryUnits.id),
    method: text('method', { enum: CUT_METHODS }).notNull(),
    cutLengthMm: integer('cut_length_mm'),
    cutWidthMm: integer('cut_width_mm'),
    freehandSizeId: integer('freehand_size_id').references(() => freehandSizes.id),
    /** Trabajo al que se cargó el material (Fase 3). NULL = muestra o uso interno. */
    orderId: integer('order_id').references((): AnySQLiteColumn => orders.id),
    /** MEASURED: exacta. FREEHAND: estimada. */
    cutAreaMm2: integer('cut_area_mm2').notNull(),
    usedAreaMm2: integer('used_area_mm2').notNull(),
    remnantAreaMm2: integer('remnant_area_mm2').notNull().default(0),
    wasteAreaMm2: integer('waste_area_mm2').notNull(),
    reconciledCountId: integer('reconciled_count_id').references((): AnySQLiteColumn => physicalCounts.id),
    /** Área real atribuida en la conciliación (solo FREEHAND). */
    reconciledAreaMm2: integer('reconciled_area_mm2'),
    notes: text('notes'),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('cuts_pending_idx').on(t.unitId, t.method, t.reconciledCountId),
    index('cuts_created_idx').on(t.createdAt),
    check('cuts_method_check', sql`${t.method} IN ('MEASURED','FREEHAND')`),
    check('cuts_length_check', sql`${t.cutLengthMm} IS NULL OR ${t.cutLengthMm} > 0`),
    check('cuts_width_check', sql`${t.cutWidthMm} IS NULL OR ${t.cutWidthMm} > 0`),
    check('cuts_area_check', sql`${t.cutAreaMm2} > 0`),
    check('cuts_used_check', sql`${t.usedAreaMm2} >= 0`),
    check('cuts_remnant_check', sql`${t.remnantAreaMm2} >= 0`),
    check('cuts_waste_check', sql`${t.wasteAreaMm2} >= 0`),
    check(
      'cuts_measured_check',
      sql`${t.method} = 'FREEHAND' OR (${t.cutLengthMm} IS NOT NULL AND ${t.cutWidthMm} IS NOT NULL AND ${t.cutAreaMm2} = ${t.cutLengthMm} * ${t.cutWidthMm})`,
    ),
    check('cuts_freehand_waste_check', sql`${t.method} = 'MEASURED' OR ${t.wasteAreaMm2} = 0`),
    check(
      'cuts_measured_no_freehand_check',
      sql`${t.method} = 'FREEHAND' OR (${t.freehandSizeId} IS NULL AND ${t.reconciledCountId} IS NULL)`,
    ),
    check(
      'cuts_conservation_check',
      sql`${t.usedAreaMm2} + ${t.remnantAreaMm2} + ${t.wasteAreaMm2} = ${t.cutAreaMm2}`,
    ),
  ],
);

export const COUNT_METHODS = ['LENGTH', 'WEIGHT'] as const;

/** Cada medición física de una unidad. */
export const physicalCounts = sqliteTable(
  'physical_counts',
  {
    id: integer('id').primaryKey(),
    unitId: integer('unit_id')
      .notNull()
      .references((): AnySQLiteColumn => inventoryUnits.id),
    method: text('method', { enum: COUNT_METHODS }).notNull(),
    measuredLengthMm: integer('measured_length_mm'),
    measuredWeightG: integer('measured_weight_g'),
    computedAreaMm2: integer('computed_area_mm2').notNull(),
    systemAreaMm2: integer('system_area_mm2').notNull(),
    /** Parte de la diferencia atribuida a cortes a pulso (con signo). */
    freehandAdjustMm2: integer('freehand_adjust_mm2').notNull().default(0),
    /** Resto: faltante (−) o sobrante (+) no explicado. */
    unexplainedMm2: integer('unexplained_mm2').notNull().default(0),
    notes: text('notes'),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('counts_unit_idx').on(t.unitId),
    check('counts_method_check', sql`${t.method} IN ('LENGTH','WEIGHT')`),
    check('counts_computed_check', sql`${t.computedAreaMm2} >= 0`),
    check(
      'counts_split_check',
      sql`${t.freehandAdjustMm2} + ${t.unexplainedMm2} = ${t.computedAreaMm2} - ${t.systemAreaMm2}`,
    ),
  ],
);

// ============ CATÁLOGO, COTIZACIONES Y PEDIDOS (Fase 3) ============

export const CATALOG_KINDS = ['PRODUCTO', 'SERVICIO'] as const;
export const PRICING_UNITS = ['UNIDAD', 'METRO_LINEAL', 'M2', 'GLOBAL'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];
/** Tarifas de IVA en centésimas de punto porcentual: 1900 = 19 %. */
export const TAX_RATES_BP = [0, 500, 1900] as const;

export const catalogItems = sqliteTable(
  'catalog_items',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind', { enum: CATALOG_KINDS }).notNull(),
    pricingUnit: text('pricing_unit', { enum: PRICING_UNITS }).notNull(),
    /** Precio de referencia sin IVA, en pesos. */
    unitPrice: integer('unit_price').notNull(),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    materialId: integer('material_id').references(() => materials.id),
    /** Visible en el catálogo público (sin iniciar sesión). */
    isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    check('catalog_kind_check', sql`${t.kind} IN ('PRODUCTO','SERVICIO')`),
    check('catalog_unit_check', sql`${t.pricingUnit} IN ('UNIDAD','METRO_LINEAL','M2','GLOBAL')`),
    check('catalog_price_check', sql`${t.unitPrice} >= 0`),
    check('catalog_tax_check', sql`${t.taxRateBp} IN (0, 500, 1900)`),
  ],
);

export const QUOTE_REQUEST_STATUSES = ['NUEVA', 'COTIZADA', 'DESCARTADA'] as const;
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

/** Lo que pide el cliente desde la web, con fotos (ARQUITECTURA §1.3). No es un pedido. */
export const quoteRequests = sqliteTable(
  'quote_requests',
  {
    id: integer('id').primaryKey(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    status: text('status', { enum: QUOTE_REQUEST_STATUSES }).notNull().default('NUEVA'),
    vehicleDesc: text('vehicle_desc').notNull(),
    description: text('description').notNull(),
    /** Visible para el cliente si se descarta. */
    discardReason: text('discard_reason'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('quote_requests_status_idx').on(t.status, t.createdAt),
    index('quote_requests_customer_idx').on(t.customerId),
    check('quote_requests_status_check', sql`${t.status} IN ('NUEVA','COTIZADA','DESCARTADA')`),
  ],
);

export const ORDER_STATUSES = ['COTIZADO', 'APROBADO', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO', 'CANCELADO'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Cotización y pedido son el mismo registro en distintos estados. */
export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey(),
    code: text('code').notNull(),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    quoteRequestId: integer('quote_request_id').references(() => quoteRequests.id),
    status: text('status', { enum: ORDER_STATUSES }).notNull(),
    vehicleDesc: text('vehicle_desc'),
    /** Lo que ve el cliente. */
    description: text('description'),
    /** Solo personal del local. */
    internalNotes: text('internal_notes'),
    /** Suma de líneas sin IVA (ya con su descuento). */
    subtotal: integer('subtotal').notNull().default(0),
    /** Suma de descuentos de las líneas (informativo). */
    discount: integer('discount').notNull().default(0),
    taxTotal: integer('tax_total').notNull().default(0),
    /** subtotal + tax_total */
    total: integer('total').notNull().default(0),
    invoiceNumber: text('invoice_number'),
    invoiceCufe: text('invoice_cufe'),
    /** Fecha (AAAA-MM-DD) hasta la que el cliente puede aceptar la cotización. */
    quoteValidUntil: text('quote_valid_until'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('orders_code_unique').on(t.code),
    uniqueIndex('orders_quote_request_unique').on(t.quoteRequestId),
    index('orders_customer_status_idx').on(t.customerId, t.status),
    index('orders_status_idx').on(t.status, t.createdAt),
    check(
      'orders_status_check',
      sql`${t.status} IN ('COTIZADO','APROBADO','EN_PROCESO','TERMINADO','ENTREGADO','CANCELADO')`,
    ),
    check('orders_totals_check', sql`${t.total} = ${t.subtotal} + ${t.taxTotal} AND ${t.subtotal} >= 0 AND ${t.taxTotal} >= 0 AND ${t.discount} >= 0`),
  ],
);

export const orderItems = sqliteTable(
  'order_items',
  {
    id: integer('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    catalogItemId: integer('catalog_item_id').references(() => catalogItems.id),
    /** Copia del nombre al cotizar (el catálogo puede cambiar después). */
    description: text('description').notNull(),
    pricingUnit: text('pricing_unit', { enum: PRICING_UNITS }).notNull(),
    /** 1500 = 1,5 (unidades, m o m²). */
    quantityMilli: integer('quantity_milli').notNull(),
    /** Precio unitario sin IVA, fijado al cotizar. */
    unitPrice: integer('unit_price').notNull(),
    discount: integer('discount').notNull().default(0),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxAmount: integer('tax_amount').notNull().default(0),
    /** round(cantidad × precio) − descuento, sin IVA. */
    lineTotal: integer('line_total').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    check('order_items_qty_check', sql`${t.quantityMilli} > 0`),
    check('order_items_price_check', sql`${t.unitPrice} >= 0 AND ${t.discount} >= 0 AND ${t.lineTotal} >= 0`),
    check('order_items_tax_check', sql`${t.taxRateBp} IN (0, 500, 1900) AND ${t.taxAmount} >= 0`),
  ],
);

export const orderStatusHistory = sqliteTable(
  'order_status_history',
  {
    id: integer('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    fromStatus: text('from_status', { enum: ORDER_STATUSES }),
    toStatus: text('to_status', { enum: ORDER_STATUSES }).notNull(),
    note: text('note'),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('order_history_order_idx').on(t.orderId)],
);

export const PAYMENT_METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO'] as const;

export const payments = sqliteTable(
  'payments',
  {
    id: integer('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    amount: integer('amount').notNull(),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    note: text('note'),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    index('payments_order_idx').on(t.orderId),
    check('payments_amount_check', sql`${t.amount} > 0`),
    check('payments_method_check', sql`${t.method} IN ('EFECTIVO','TRANSFERENCIA','TARJETA','OTRO')`),
  ],
);

/** Fotos re-codificadas a JPG, sin EXIF ni GPS. Se guardan fuera de la carpeta pública. */
export const attachments = sqliteTable(
  'attachments',
  {
    id: integer('id').primaryKey(),
    quoteRequestId: integer('quote_request_id').references(() => quoteRequests.id),
    /** Fotos que agrega el local (antes/después del trabajo). */
    orderId: integer('order_id').references(() => orders.id),
    /** Nombre aleatorio en disco; nunca el nombre original. */
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    widthPx: integer('width_px').notNull(),
    heightPx: integer('height_px').notNull(),
    uploadedBy: integer('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('attachments_key_unique').on(t.storageKey),
    index('attachments_request_idx').on(t.quoteRequestId),
    index('attachments_order_idx').on(t.orderId),
    check('attachments_mime_check', sql`${t.mimeType} = 'image/jpeg'`),
    check('attachments_owner_check', sql`${t.quoteRequestId} IS NOT NULL OR ${t.orderId} IS NOT NULL`),
  ],
);

// ============ COMPRAS (Fase 4) ============

export const suppliers = sqliteTable('suppliers', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(now),
});

/** Una compra confirmada. No se edita: los errores se corrigen con ajustes de inventario. */
export const purchases = sqliteTable(
  'purchases',
  {
    id: integer('id').primaryKey(),
    supplierId: integer('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    invoiceRef: text('invoice_ref'),
    /** Fecha de la compra (AAAA-MM-DD). */
    purchasedAt: text('purchased_at').notNull(),
    total: integer('total').notNull(),
    notes: text('notes'),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('purchases_date_idx').on(t.purchasedAt), check('purchases_total_check', sql`${t.total} >= 0`)],
);

export const purchaseLines = sqliteTable(
  'purchase_lines',
  {
    id: integer('id').primaryKey(),
    purchaseId: integer('purchase_id')
      .notNull()
      .references(() => purchases.id),
    materialId: integer('material_id')
      .notNull()
      .references(() => materials.id),
    rolls: integer('rolls').notNull(),
    widthMm: integer('width_mm').notNull(),
    /** Largo de cada rollo. */
    lengthMm: integer('length_mm').notNull(),
    /** Costo de cada rollo, en pesos. */
    unitCost: integer('unit_cost').notNull(),
  },
  (t) => [
    index('purchase_lines_purchase_idx').on(t.purchaseId),
    check('purchase_lines_check', sql`${t.rolls} > 0 AND ${t.widthMm} > 0 AND ${t.lengthMm} > 0 AND ${t.unitCost} >= 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type QuoteRequest = typeof quoteRequests.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Material = typeof materials.$inferSelect;
export type InventoryUnit = typeof inventoryUnits.$inferSelect;
export type Cut = typeof cuts.$inferSelect;
export type FreehandSize = typeof freehandSizes.$inferSelect;
export type PhysicalCount = typeof physicalCounts.$inferSelect;
