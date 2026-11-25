import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { AdminMaterial } from '../../api/inventory';
import { ErrorMsg, NumField, errorText } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { cmToMm, fmtCm, fmtM, fmtM2, fmtMoney, mToMm, parseDecimal } from '../../units';

interface Supplier { id: number; name: string; phone: string | null; email: string | null; isActive: boolean }
interface PurchaseRow { id: number; supplierName: string; invoiceRef: string | null; purchasedAt: string; total: number; rolls: number; userName: string }
interface PurchaseDetail {
  id: number; supplierName: string; invoiceRef: string | null; purchasedAt: string; total: number; notes: string | null; userName: string;
  lines: { id: number; materialLabel: string; rolls: number; widthMm: number; lengthMm: number; unitCost: number; costPerM2: number; units: { id: number; code: string; status: string }[] }[];
}
interface CreatedResult { purchase: PurchaseDetail; createdCodes: string[]; costChanges: { materialId: number; label: string; before: number | null; after: number }[] }

const todayCo = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

export function PurchasesPage() {
  const list = useApi<{ purchases: PurchaseRow[] }>('/api/admin/purchases');
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreatedResult | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Compras</h1>
        <button className="primary" onClick={() => { setCreating(!creating); setResult(null); }}>{creating ? 'Cerrar' : 'Registrar compra'}</button>
      </div>
      <p className="muted small">
        Al registrar una compra se crea un rollo (con su código) por cada unidad comprada, y se recalcula el costo
        promedio por m² del material. Una compra confirmada no se edita: los errores se corrigen con un ajuste en el rollo.
      </p>

      {creating && <PurchaseForm onDone={(r) => { setCreating(false); setResult(r); void list.reload(); }} />}
      {result && <PurchaseCreated r={result} />}

      <ErrorMsg error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Rollos</th><th>Total</th><th>Registró</th><th></th></tr></thead>
          <tbody>
            {list.data?.purchases.map((p) => (
              <tr key={p.id}>
                <td>{p.purchasedAt}</td>
                <td>{p.supplierName}</td>
                <td>{p.invoiceRef ?? '—'}</td>
                <td>{p.rolls}</td>
                <td>{fmtMoney(p.total)}</td>
                <td>{p.userName}</td>
                <td className="actions"><button onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Ocultar' : 'Ver'}</button></td>
              </tr>
            ))}
            {list.data?.purchases.length === 0 && <tr><td colSpan={7} className="muted center">Aún no hay compras registradas.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <PurchaseView id={open} />}
    </div>
  );
}

function PurchaseView({ id }: { id: number }) {
  const { data, error } = useApi<{ purchase: PurchaseDetail }>(`/api/admin/purchases/${id}`);
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;
  const p = data.purchase;
  return (
    <div className="card stack">
      <h2>Compra del {p.purchasedAt} · {p.supplierName}</h2>
      {p.notes && <p className="pre muted">{p.notes}</p>}
      <PurchaseLines p={p} />
    </div>
  );
}

function PurchaseLines({ p }: { p: PurchaseDetail }) {
  return (
    <ul className="list">
      {p.lines.map((l) => (
        <li key={l.id} className="stack">
          <strong>{l.rolls} × {l.materialLabel}</strong>
          <span className="muted small">
            {fmtCm(l.widthMm)} × {fmtM(l.lengthMm)} · {fmtMoney(l.unitCost)} c/u · {fmtMoney(l.costPerM2)}/m²
          </span>
          <span className="small">
            {l.units.map((u, i) => <span key={u.id}>{i > 0 && ', '}<Link to={`/stock/${u.id}`}>{u.code}</Link></span>)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PurchaseCreated({ r }: { r: CreatedResult }) {
  return (
    <div className="card stack done">
      <h2>✓ Compra registrada: {r.createdCodes.length} {r.createdCodes.length === 1 ? 'rollo' : 'rollos'}</h2>
      <p>Escribe estos códigos en los tubos:</p>
      <p className="label-code">{r.createdCodes.join('  ')}</p>
      <PurchaseLines p={r.purchase} />
      {r.costChanges.map((c) => (
        <p key={c.materialId} className="muted small">
          Costo promedio de {c.label}: {c.before === null ? 'sin costo' : fmtMoney(c.before)} → <strong>{fmtMoney(c.after)}</strong> por m²
        </p>
      ))}
    </div>
  );
}

interface LineState { key: number; materialId: string; rolls: string; width: string; length: string; cost: string; core: string; location: string }
let seq = 0;
const blankLine = (): LineState => ({ key: ++seq, materialId: '', rolls: '1', width: '152', length: '', cost: '', core: '', location: '' });

function PurchaseForm({ onDone }: { onDone: (r: CreatedResult) => void }) {
  const suppliers = useApi<{ suppliers: Supplier[] }>('/api/admin/suppliers');
  const materials = useApi<{ materials: AdminMaterial[] }>('/api/admin/materials');
  const [supplierId, setSupplierId] = useState('');
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const [header, setHeader] = useState({ purchasedAt: todayCo(), invoiceRef: '', notes: '' });
  const [lines, setLines] = useState<LineState[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const parsed = lines.map((l) => {
    const width = cmToMm(l.width) ?? 0;
    const length = mToMm(l.length) ?? 0;
    const rolls = Math.round(parseDecimal(l.rolls)) || 0;
    const cost = Math.round(parseDecimal(l.cost)) || 0;
    const area = width * length;
    return { width, length, rolls, cost, area, perM2: area > 0 ? Math.round((cost * 1_000_000) / area) : 0 };
  });
  const total = parsed.reduce((a, p) => a + p.rolls * p.cost, 0);

  async function addSupplier() {
    if (!newSupplier?.trim()) return;
    try {
      const r = await api<{ supplier: Supplier }>('POST', '/api/admin/suppliers', { name: newSupplier });
      await suppliers.reload();
      setSupplierId(String(r.supplier.id));
      setNewSupplier(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supplierId) return setError('Elige el proveedor.');
    if (parsed.some((p) => !p.area || !p.rolls)) return setError('Revisa ancho, largo y cantidad de cada línea.');
    if (!window.confirm(`¿Confirmar la compra por ${fmtMoney(total)}? Se crearán ${parsed.reduce((a, p) => a + p.rolls, 0)} rollos y no se podrá editar.`)) return;
    setBusy(true);
    try {
      onDone(
        await api<CreatedResult>('POST', '/api/admin/purchases', {
          supplierId: Number(supplierId),
          purchasedAt: header.purchasedAt,
          invoiceRef: header.invoiceRef,
          notes: header.notes,
          lines: lines.map((l, i) => ({
            materialId: Number(l.materialId),
            rolls: parsed[i]!.rolls,
            widthMm: parsed[i]!.width,
            lengthMm: parsed[i]!.length,
            unitCost: parsed[i]!.cost,
            coreWeightG: l.core ? Math.round(parseDecimal(l.core)) : null,
            location: l.location,
          })),
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const activeMaterials = materials.data?.materials.filter((m) => m.isActive) ?? [];

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Registrar compra</h2>
      <div className="form-grid">
        <label className="field">
          <span>Proveedor</span>
          {newSupplier === null ? (
            <select value={supplierId} onChange={(e) => (e.target.value === 'new' ? setNewSupplier('') : setSupplierId(e.target.value))} required>
              <option value="">Elige…</option>
              {suppliers.data?.suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="new">+ Nuevo proveedor</option>
            </select>
          ) : (
            <span className="row">
              <input autoFocus className="grow" placeholder="Nombre del proveedor" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
              <button type="button" onClick={addSupplier}>Crear</button>
              <button type="button" onClick={() => setNewSupplier(null)}>✕</button>
            </span>
          )}
        </label>
        <label className="field"><span>Fecha</span><input type="date" required max={todayCo()} value={header.purchasedAt} onChange={(e) => setHeader({ ...header, purchasedAt: e.target.value })} /></label>
        <label className="field"><span>N.º de factura del proveedor</span><input maxLength={60} value={header.invoiceRef} onChange={(e) => setHeader({ ...header, invoiceRef: e.target.value })} /></label>
      </div>

      {lines.map((l, i) => (
        <div key={l.key} className="card stack quote-line">
          <div className="row">
            <select className="grow" required value={l.materialId} onChange={(e) => set(l.key, { materialId: e.target.value })}>
              <option value="">Material…</option>
              {activeMaterials.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.sku})</option>)}
            </select>
            {lines.length > 1 && <button type="button" aria-label="Quitar línea" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>✕</button>}
          </div>
          <div className="row">
            <NumField label="Rollos" value={l.rolls} onChange={(rolls) => set(l.key, { rolls })} required />
            <NumField label="Ancho (cm)" value={l.width} onChange={(width) => set(l.key, { width })} required />
            <NumField label="Largo de cada rollo (m)" value={l.length} onChange={(length) => set(l.key, { length })} required />
            <NumField label="Costo de cada rollo ($)" value={l.cost} onChange={(cost) => set(l.key, { cost })} required />
            <NumField label="Peso tubo (g)" value={l.core} onChange={(core) => set(l.key, { core })} />
            <label className="field grow"><span>Ubicación</span><input maxLength={60} value={l.location} onChange={(e) => set(l.key, { location: e.target.value })} /></label>
          </div>
          {parsed[i]!.area > 0 && (
            <p className="right small muted">
              {parsed[i]!.rolls} × {fmtM2(parsed[i]!.area)} = {fmtM2(parsed[i]!.area * parsed[i]!.rolls)}
              {parsed[i]!.cost > 0 && <> · {fmtMoney(parsed[i]!.perM2)}/m² · subtotal <strong>{fmtMoney(parsed[i]!.rolls * parsed[i]!.cost)}</strong></>}
            </p>
          )}
        </div>
      ))}
      <button type="button" onClick={() => setLines([...lines, blankLine()])}>+ Otra línea</button>
      <label className="field"><span>Notas</span><textarea rows={2} maxLength={1000} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} /></label>
      <p className="summary">Total de la compra: <strong>{fmtMoney(total)}</strong></p>
      <ErrorMsg error={error} />
      <button className="primary big" disabled={busy}>{busy ? 'Guardando…' : 'Confirmar compra'}</button>
    </form>
  );
}
