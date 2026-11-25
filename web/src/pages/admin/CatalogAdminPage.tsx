import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { CatalogItemAdmin, PricingUnit, TaxRate } from '../../api/orders';
import { TAX_LABEL, UNIT_LABEL } from '../../api/orders';
import { ErrorMsg, NumField, errorText } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { fmtMoney, parseDecimal } from '../../units';

export function CatalogAdminPage() {
  const list = useApi<{ items: CatalogItemAdmin[] }>('/api/admin/catalog');
  const [editing, setEditing] = useState<CatalogItemAdmin | 'new' | null>(null);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Catálogo</h1>
        <div className="row">
          <Link to="/catalogo" className="button">Ver como cliente</Link>
          <button className="primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>Nuevo ítem</button>
        </div>
      </div>
      <p className="muted small">Lo marcado como público se ve sin iniciar sesión, como vitrina. Al cotizar, puedes elegir un ítem y se llenan su nombre, precio e IVA.</p>
      {editing && (
        <CatalogForm
          item={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            void list.reload();
          }}
        />
      )}
      <ErrorMsg error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Precio</th><th>IVA</th><th>Público</th><th></th></tr></thead>
          <tbody>
            {list.data?.items.map((i) => (
              <tr key={i.id} className={i.isActive ? '' : 'inactive'}>
                <td>{i.name}</td>
                <td>{i.kind === 'SERVICIO' ? 'Servicio' : 'Producto'}</td>
                <td>{fmtMoney(i.unitPrice)} <small className="muted">/ {UNIT_LABEL[i.pricingUnit]}</small></td>
                <td>{TAX_LABEL[i.taxRateBp]}</td>
                <td>{i.isPublic ? 'Sí' : 'No'}</td>
                <td className="actions"><button onClick={() => setEditing(i)}>Editar</button></td>
              </tr>
            ))}
            {list.data?.items.length === 0 && <tr><td colSpan={6} className="muted center">Aún no hay ítems.</td></tr>}
          </tbody>
        </table>
      </div>
      <QuoteSettings />
    </div>
  );
}

function CatalogForm({ item, onDone }: { item: CatalogItemAdmin | null; onDone: () => void }) {
  const [f, setF] = useState({
    name: item?.name ?? '',
    description: item?.description ?? '',
    kind: item?.kind ?? 'SERVICIO',
    pricingUnit: (item?.pricingUnit ?? 'GLOBAL') as PricingUnit,
    unitPrice: item ? String(item.unitPrice) : '',
    taxRateBp: (item?.taxRateBp ?? 0) as TaxRate,
    isPublic: item?.isPublic ?? true,
    isActive: item?.isActive ?? true,
    sortOrder: String(item?.sortOrder ?? 0),
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...f,
      unitPrice: Math.round(parseDecimal(f.unitPrice)),
      sortOrder: Math.round(parseDecimal(f.sortOrder)) || 0,
    };
    try {
      if (item) await api('PATCH', `/api/admin/catalog/${item.id}`, body);
      else await api('POST', '/api/admin/catalog', body);
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>Nombre</span><input required minLength={2} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">
          <span>Tipo</span>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'SERVICIO' | 'PRODUCTO' })}>
            <option value="SERVICIO">Servicio</option>
            <option value="PRODUCTO">Producto</option>
          </select>
        </label>
        <label className="field">
          <span>Se cobra por</span>
          <select value={f.pricingUnit} onChange={(e) => setF({ ...f, pricingUnit: e.target.value as PricingUnit })}>
            {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <NumField label="Precio sin IVA ($)" hint="0 = «precio según cotización»" value={f.unitPrice} onChange={(unitPrice) => setF({ ...f, unitPrice })} required />
        <label className="field">
          <span>IVA</span>
          <select value={f.taxRateBp} onChange={(e) => setF({ ...f, taxRateBp: Number(e.target.value) as TaxRate })}>
            {Object.entries(TAX_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <NumField label="Orden" value={f.sortOrder} onChange={(sortOrder) => setF({ ...f, sortOrder })} />
      </div>
      <label className="field"><span>Descripción</span><textarea rows={2} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="row small">
        <label><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Visible en el catálogo público</label>
        <label><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Activo</label>
      </div>
      <ErrorMsg error={error} />
      <div className="row">
        <button className="primary">Guardar</button>
        <button type="button" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}

interface QuoteSettingsData { defaultTaxRateBp: TaxRate; quoteValidDays: number; maxOpenQuoteRequests: number; quoteRequestsPerDay: number }

function QuoteSettings() {
  const s = useApi<{ settings: QuoteSettingsData }>('/api/admin/settings');
  const [f, setF] = useState<{ tax: TaxRate; days: string; open: string; perDay: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (s.data) {
      const d = s.data.settings;
      setF({ tax: d.defaultTaxRateBp, days: String(d.quoteValidDays), open: String(d.maxOpenQuoteRequests), perDay: String(d.quoteRequestsPerDay) });
    }
  }, [s.data]);
  if (!f) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('PATCH', '/api/admin/settings', {
        defaultTaxRateBp: f!.tax,
        quoteValidDays: Math.round(parseDecimal(f!.days)),
        maxOpenQuoteRequests: Math.round(parseDecimal(f!.open)),
        quoteRequestsPerDay: Math.round(parseDecimal(f!.perDay)),
      });
      setError(null);
      setMsg('Guardado.');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Cotizaciones</h2>
      <div className="form-grid">
        <label className="field">
          <span>IVA por defecto</span>
          <select value={f.tax} onChange={(e) => setF({ ...f, tax: Number(e.target.value) as TaxRate })}>
            {Object.entries(TAX_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <small className="muted">Confírmalo con el contador: depende de si el negocio es responsable de IVA.</small>
        </label>
        <NumField label="Días de validez" value={f.days} onChange={(days) => setF({ ...f, days })} required />
        <NumField label="Solicitudes abiertas por cliente" value={f.open} onChange={(open) => setF({ ...f, open })} required />
        <NumField label="Solicitudes por cliente al día" value={f.perDay} onChange={(perDay) => setF({ ...f, perDay })} required />
      </div>
      <ErrorMsg error={error ?? s.error} />
      {msg && <p className="ok">{msg}</p>}
      <button className="primary">Guardar</button>
    </form>
  );
}
