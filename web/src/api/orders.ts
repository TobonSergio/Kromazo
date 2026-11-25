/** Tipos de la API de clientes, catálogo, solicitudes y pedidos (Fase 3). Dinero en pesos; cantidades en milésimas. */

export type OrderStatus = 'COTIZADO' | 'APROBADO' | 'EN_PROCESO' | 'TERMINADO' | 'ENTREGADO' | 'CANCELADO';
export type RequestStatus = 'NUEVA' | 'COTIZADA' | 'DESCARTADA';
export type PricingUnit = 'UNIDAD' | 'METRO_LINEAL' | 'M2' | 'GLOBAL';
export type DocumentType = 'CC' | 'NIT' | 'CE' | 'PASAPORTE' | 'OTRO';
export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO';
export type TaxRate = 0 | 500 | 1900;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  COTIZADO: 'Cotizado', APROBADO: 'Aprobado', EN_PROCESO: 'En proceso',
  TERMINADO: 'Terminado', ENTREGADO: 'Entregado', CANCELADO: 'Cancelado',
};
/** Cómo lo entiende el cliente. */
export const ORDER_STATUS_CLIENT: Record<OrderStatus, string> = {
  COTIZADO: 'Cotización por responder', APROBADO: 'Aprobado, en cola', EN_PROCESO: 'En el taller',
  TERMINADO: 'Listo para recoger', ENTREGADO: 'Entregado', CANCELADO: 'Cancelado',
};
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { NUEVA: 'Nueva', COTIZADA: 'Cotizada', DESCARTADA: 'Descartada' };
export const UNIT_LABEL: Record<PricingUnit, string> = { UNIDAD: 'unidad', METRO_LINEAL: 'metro', M2: 'm²', GLOBAL: 'global' };
export const DOC_LABEL: Record<DocumentType, string> = { CC: 'Cédula', NIT: 'NIT', CE: 'Cédula de extranjería', PASAPORTE: 'Pasaporte', OTRO: 'Otro' };
export const PAYMENT_LABEL: Record<PaymentMethod, string> = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', OTRO: 'Otro' };
export const TAX_LABEL: Record<TaxRate, string> = { 0: 'Sin IVA', 500: 'IVA 5 %', 1900: 'IVA 19 %' };

/** Siguientes estados que ofrece la interfaz (el servidor valida de nuevo). */
export const NEXT_STATUS: Record<OrderStatus, { to: OrderStatus; label: string; adminOnly?: boolean; danger?: boolean }[]> = {
  COTIZADO: [{ to: 'APROBADO', label: 'Marcar aprobado (el cliente aceptó)', adminOnly: true }, { to: 'CANCELADO', label: 'Cancelar', adminOnly: true, danger: true }],
  APROBADO: [{ to: 'EN_PROCESO', label: 'Empezar trabajo' }, { to: 'CANCELADO', label: 'Cancelar', adminOnly: true, danger: true }],
  EN_PROCESO: [{ to: 'TERMINADO', label: 'Marcar terminado' }, { to: 'CANCELADO', label: 'Cancelar', adminOnly: true, danger: true }],
  TERMINADO: [{ to: 'ENTREGADO', label: 'Entregar al cliente' }, { to: 'EN_PROCESO', label: 'Volver a proceso' }],
  ENTREGADO: [],
  CANCELADO: [],
};

export interface Photo { id: number; url: string; width: number; height: number; source: 'REQUEST' | 'ORDER'; createdAt: string }

export interface CatalogItem {
  id: number; name: string; description: string | null; kind: 'PRODUCTO' | 'SERVICIO'; pricingUnit: PricingUnit;
  unitPrice: number; taxRateBp: TaxRate;
}
export interface CatalogItemAdmin extends CatalogItem {
  materialId: number | null; isPublic: boolean; isActive: boolean; sortOrder: number; createdAt: string;
}

export interface CustomerClient {
  id: number; fullName: string; phone: string | null; email: string | null;
  documentType: DocumentType | null; documentNumber: string | null; nitCheckDigit: number | null; billingEmail: string | null;
}
export interface CustomerAdmin extends CustomerClient {
  userId: number | null; hasAccount: boolean; notes: string | null; orderCount: number; createdAt: string;
}

export interface QuoteRequest {
  id: number; status: RequestStatus; vehicleDesc: string; description: string; discardReason: string | null;
  createdAt: string; photos: Photo[]; order: { id: number; code: string; status: OrderStatus } | null;
}
export interface QuoteRequestStaff extends QuoteRequest {
  customer: { id: number; fullName: string; phone: string | null; email: string | null };
}

export interface HistoryEntry { id: number; fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; userName?: string; createdAt: string }

export interface OrderItem {
  id: number; catalogItemId?: number | null; description: string; pricingUnit: PricingUnit; quantityMilli: number;
  unitPrice: number; discount: number; taxRateBp: TaxRate; taxAmount: number; lineTotal: number;
}

export interface OrderSummaryStaff {
  id: number; code: string; status: OrderStatus; customerName: string; vehicleDesc: string | null; createdAt: string; updatedAt: string;
}
export interface OrderSummaryAdmin extends OrderSummaryStaff { customerId: number; total: number; paid: number; invoiceNumber: string | null }

export interface OrderCut {
  id: number; unitCode: string; materialLabel: string; method: 'MEASURED' | 'FREEHAND'; consumedAreaMm2: number;
  estimated: boolean; userName: string; createdAt: string; costPerM2?: number | null;
}

export interface OrderStaffDetail {
  order: { id: number; code: string; status: OrderStatus; vehicleDesc: string | null; description: string | null; internalNotes: string | null; quoteRequestId: number | null; createdAt: string };
  customer: { id: number; fullName: string; phone: string | null };
  items: { id: number; description: string; pricingUnit: PricingUnit; quantityMilli: number }[];
  history: HistoryEntry[];
  photos: Photo[];
  cuts: OrderCut[];
}

export interface OrderAdminDetail {
  order: {
    id: number; code: string; status: OrderStatus; customerId: number; quoteRequestId: number | null;
    vehicleDesc: string | null; description: string | null; internalNotes: string | null;
    subtotal: number; discount: number; taxTotal: number; total: number;
    invoiceNumber: string | null; quoteValidUntil: string | null; createdAt: string;
  };
  customer: CustomerAdmin;
  items: OrderItem[];
  history: HistoryEntry[];
  payments: { id: number; amount: number; method: PaymentMethod; note: string | null; userName: string; createdAt: string }[];
  paid: number; balance: number;
  photos: Photo[];
  cuts: OrderCut[];
  materialCost: number; materialCostEstimated: boolean; margin: number;
}

export interface OrderClientDetail {
  order: {
    id: number; code: string; status: OrderStatus; vehicleDesc: string | null; description: string | null;
    subtotal: number; discount: number; taxTotal: number; total: number; invoiceNumber: string | null;
    quoteValidUntil: string | null; quoteRequestId: number | null; createdAt: string;
  };
  items: Omit<OrderItem, 'catalogItemId'>[];
  history: HistoryEntry[];
  payments: { id: number; amount: number; method: PaymentMethod; createdAt: string }[];
  paid: number; balance: number;
  photos: Photo[];
  canRespond: boolean; expired: boolean;
}

export interface OrderSummaryClient {
  id: number; code: string; status: OrderStatus; vehicleDesc: string | null; total: number;
  quoteValidUntil: string | null; createdAt: string; updatedAt: string;
}

// ── Cálculo de líneas: igual que el servidor (server/src/lib/money.ts), para la vista previa ──

const mulDivRound = (a: number, b: number, c: number) => Math.floor((a * b * 2 + c) / (c * 2));
export function computeLine(l: { quantityMilli: number; unitPrice: number; discount: number; taxRateBp: number }) {
  const gross = mulDivRound(l.quantityMilli, l.unitPrice, 1000);
  const lineTotal = gross - l.discount;
  return { gross, lineTotal, taxAmount: lineTotal > 0 ? mulDivRound(lineTotal, l.taxRateBp, 10_000) : 0 };
}

export const fmtQty = (milli: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(milli / 1000);
