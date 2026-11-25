/** Tipos de la API de inventario (Fase 2). Medidas en mm y mm², dinero en pesos. */

export type Finish =
  | 'MATE' | 'BRILLANTE' | 'SATINADO' | 'METALIZADO' | 'CROMADO'
  | 'CARBONO' | 'TORNASOL' | 'REFLECTIVO' | 'TRANSPARENTE' | 'OTRO';
export type MaterialType = 'VINILO_CORTE' | 'VINILO_IMPRESION' | 'WRAP' | 'LAMINADO' | 'CALCA' | 'OTRO';
export type UnitKind = 'ROLL' | 'REMNANT';
export type UnitStatus = 'ACTIVE' | 'DEPLETED' | 'DISCARDED';
export type MovementType =
  | 'INITIAL_IN' | 'PURCHASE_IN' | 'REMNANT_IN' | 'CUT_OUT'
  | 'FREEHAND_ADJUST' | 'COUNT_ADJUST' | 'MANUAL_ADJUST' | 'DISCARD';

export const FINISH_LABEL: Record<Finish, string> = {
  MATE: 'Mate', BRILLANTE: 'Brillante', SATINADO: 'Satinado', METALIZADO: 'Metalizado', CROMADO: 'Cromado',
  CARBONO: 'Carbono', TORNASOL: 'Tornasol', REFLECTIVO: 'Reflectivo', TRANSPARENTE: 'Transparente', OTRO: 'Otro',
};
export const TYPE_LABEL: Record<MaterialType, string> = {
  VINILO_CORTE: 'Vinilo de corte', VINILO_IMPRESION: 'Vinilo de impresión', WRAP: 'Wrap',
  LAMINADO: 'Laminado', CALCA: 'Calca', OTRO: 'Otro',
};
export const STATUS_LABEL: Record<UnitStatus, string> = { ACTIVE: 'Activo', DEPLETED: 'Agotado', DISCARDED: 'De baja' };
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  INITIAL_IN: 'Alta manual', PURCHASE_IN: 'Compra', REMNANT_IN: 'Retazo creado', CUT_OUT: 'Corte',
  FREEHAND_ADJUST: 'Conciliación a pulso', COUNT_ADJUST: 'Diferencia de conteo', MANUAL_ADJUST: 'Ajuste manual', DISCARD: 'Baja',
};

export interface StockSummary { rollsMm2: number; remnantsMm2: number; activeUnits: number }

export interface Material {
  id: number; sku: string; label: string; brand: string; line: string | null; color: string;
  finish: Finish; type: MaterialType; gramsPerM2: number | null; minStockMm2: number; isActive: boolean;
  stock: StockSummary; lowStock: boolean;
}
export interface AdminMaterial extends Material { costPerM2: number | null; stockValue: number | null }

export interface Unit {
  id: number; code: string; kind: UnitKind; materialId: number; materialLabel: string; materialType: MaterialType;
  widthMm: number; initialLengthMm: number; coreWeightG: number | null; balanceMm2: number; approxLengthMm: number;
  status: UnitStatus; location: string | null; parentUnitId: number | null; parentCode: string | null;
  pendingFreehand: { count: number; areaMm2: number }; needsCount: boolean; createdAt: string;
}

export interface CutView {
  id: number; unitId: number; unitCode: string; materialLabel: string; method: 'MEASURED' | 'FREEHAND';
  cutLengthMm: number | null; cutWidthMm: number | null; sizeName: string | null;
  cutAreaMm2: number; usedAreaMm2: number; remnantAreaMm2: number; wasteAreaMm2: number;
  reconciled: boolean; reconciledAreaMm2: number | null; notes: string | null; userName: string; createdAt: string;
  remnantCodes: string[];
  orderId: number | null;
  orderCode: string | null;
}

export interface Movement {
  id: number; type: MovementType; areaMm2: number; cutId: number | null; countId: number | null;
  reason: string | null; userName: string; createdAt: string;
}

export interface FreehandSize {
  id: number; name: string; refAreaMm2: number; materialType: MaterialType | null; sortOrder: number; isActive: boolean;
}

export interface PhysicalCount {
  id: number; method: 'LENGTH' | 'WEIGHT'; measuredLengthMm: number | null; measuredWeightG: number | null;
  computedAreaMm2: number; systemAreaMm2: number; freehandAdjustMm2: number; unexplainedMm2: number;
  notes: string | null; userName: string; createdAt: string;
}

export interface InventorySettings { freehandTolerancePct: number; freehandPendingAlert: number }
