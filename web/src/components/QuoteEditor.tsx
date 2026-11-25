import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { CatalogItemAdmin, OrderItem, PricingUnit, TaxRate } from '../api/orders';
import { TAX_LABEL, UNIT_LABEL, computeLine } from '../api/orders';
import { useApi } from './useApi';
import { ErrorMsg, NumField, errorText } from './Field';
import { fmtMoney, parseDecimal } from '../units';

interface Line {
  key: number;
  catalogItemId: number | null;
  description: string;
  pricingUnit: PricingUnit;
  qty: string;
  price: string;
  discount: string;
  tax: TaxRate;
}

export interface QuoteHeader {
  vehicleDesc: string;
  description: string;
  internalNotes: string;
  quoteValidUntil: string;
}

let seq = 0;
const blank = (tax: TaxRate): Line => ({ key: ++seq, catalogItemId: null, description: '', pricingUnit: 'UNIDAD', qty: '1', price: '', discount: '', tax });
const fromItem = (i: OrderItem): Line => ({
  key: ++seq,
  catalogItemId: i.catalogItemId ?? null,
  description: i.description,
  pricingUnit: i.pricingUnit,
  qty: String(i.quantityMilli / 1000).replace('.', ','),
  price: String(i.unitPrice),
  discount: i.discount ? String(i.discount) : '',
  tax: i.taxRateBp,
});
const int = (v: string) => (v.trim() === '' ? 0 : Math.round(parseDecimal(v)));

/** Editor de cotización con cálculo en vivo (mismo cálculo que el servidor). */
export function QuoteEditor({
  initialHeader,
  initialItems,
  submitLabel,
  onSubmit,
}: {
  initialHeader: QuoteHeader;
  initialItems?: OrderItem[];
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const catalog = useApi<{ items: CatalogItemAdmin[] }>('/api/admin/catalog');
  const settings = useApi<{ settings: { defaultTaxRateBp: TaxRate } }>('/api/admin/settings');
  const defaultTax = settings.data?.settings.defaultTaxRateBp ?? 0;
  const [header, setHeader] = useState(initialHeader);
  const [lines, setLines] = useState<Line[]>(() => (initialItems?.length ? initialItems.map(fromItem) : [blank(0)]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Las líneas nuevas toman el IVA por defecto en cuanto se conoce la configuración.
  useEffect(() => {
    if (!settings.data || initialItems?.length) return;
    setLines((ls) => ls.map((l) => (l.description === '' && l.price === '' ? { ...l, tax: defaultTax } : l)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const computed = useMemo(
    () =>
      lines.map((l) => {
        const quantityMilli = Math.round(parseDecimal(l.qty) * 1000) || 0;
        return { ...computeLine({ quantityMilli, unitPrice: int(l.price), discount: int(l.discount), taxRateBp: l.tax }), quantityMilli };
      }),
    [lines],
  );
  const subtotal = computed.reduce((a, c) => a + c.lineTotal, 0);
  const tax = computed.reduce((a, c) => a + c.taxAmount, 0);

  function pickCatalog(key: number, id: string) {
    const item = catalog.data?.items.find((c) => c.id === Number(id));
    if (!item) return set(key, { catalogItemId: null });
    set(key, { catalogItemId: item.id, description: item.name, pricingUnit: item.pricingUnit, price: String(item.unitPrice), tax: item.taxRateBp });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const items = lines.map((l, i) => ({
      catalogItemId: l.catalogItemId,
      description: l.description,
      pricingUnit: l.pricingUnit,
      quantityMilli: computed[i]!.quantityMilli,
      unitPrice: int(l.price),
      discount: int(l.discount),
      taxRateBp: l.tax,
    }));
    if (items.some((i) => i.quantityMilli <= 0)) return setError('Revisa las cantidades.');
    setBusy(true);
    try {
      await onSubmit({
        vehicleDesc: header.vehicleDesc,
        description: header.description,
        internalNotes: header.internalNotes,
        quoteValidUntil: header.quoteValidUntil || null,
        items,
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const activeCatalog = catalog.data?.items.filter((c) => c.isActive) ?? [];

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>Moto</span><input maxLength={120} value={header.vehicleDesc} onChange={(e) => setHeader({ ...header, vehicleDesc: e.target.value })} /></label>
        <label className="field"><span>Válida hasta</span><input type="date" value={header.quoteValidUntil} onChange={(e) => setHeader({ ...header, quoteValidUntil: e.target.value })} /></label>
      </div>
      <label className="field">
        <span>Descripción del trabajo (la ve el cliente)</span>
        <textarea rows={3} maxLength={2000} value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} />
      </label>

      <div className="stack">
        {lines.map((l, i) => (
          <div key={l.key} className="card stack quote-line">
            <div className="row">
              <select aria-label="Del catálogo" value={l.catalogItemId ?? ''} onChange={(e) => pickCatalog(l.key, e.target.value)}>
                <option value="">Línea libre</option>
                {activeCatalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="grow" required maxLength={200} placeholder="Descripción" value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} />
              {lines.length > 1 && <button type="button" aria-label="Quitar línea" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>✕</button>}
            </div>
            <div className="row">
              <NumField label="Cantidad" value={l.qty} onChange={(qty) => set(l.key, { qty })} required />
              <label className="field">
                <span>Unidad</span>
                <select value={l.pricingUnit} onChange={(e) => set(l.key, { pricingUnit: e.target.value as PricingUnit })}>
                  {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <NumField label="Precio unitario (sin IVA)" value={l.price} onChange={(price) => set(l.key, { price })} required />
              <NumField label="Descuento ($)" value={l.discount} onChange={(discount) => set(l.key, { discount })} />
              <label className="field">
                <span>IVA</span>
                <select value={l.tax} onChange={(e) => set(l.key, { tax: Number(e.target.value) as TaxRate })}>
                  {Object.entries(TAX_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <div className="right small">
              {computed[i]!.lineTotal < 0 ? <span className="error">El descuento supera la línea</span> : <>Línea: <strong>{fmtMoney(computed[i]!.lineTotal)}</strong>{computed[i]!.taxAmount > 0 && <> + IVA {fmtMoney(computed[i]!.taxAmount)}</>}</>}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setLines([...lines, blank(defaultTax)])}>+ Agregar línea</button>
      </div>

      <div className="totals card">
        <span>Subtotal</span><span>{fmtMoney(subtotal)}</span>
        <span>IVA</span><span>{fmtMoney(tax)}</span>
        <strong>Total</strong><strong>{fmtMoney(subtotal + tax)}</strong>
      </div>

      <label className="field">
        <span>Notas internas (el cliente no las ve)</span>
        <textarea rows={2} maxLength={2000} value={header.internalNotes} onChange={(e) => setHeader({ ...header, internalNotes: e.target.value })} />
      </label>
      <ErrorMsg error={error} />
      <button className="primary big" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</button>
    </form>
  );
}
