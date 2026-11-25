import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { AdminMaterial, Finish, MaterialType, Unit } from '../../api/inventory';
import { FINISH_LABEL, TYPE_LABEL } from '../../api/inventory';
import { ErrorMsg, NumField, errorText } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { cmToMm, fmtM2, fmtMoney, m2ToMm2, mToMm, parseDecimal } from '../../units';

export function MaterialsPage() {
  const list = useApi<{ materials: AdminMaterial[] }>('/api/admin/materials');
  const [editing, setEditing] = useState<AdminMaterial | 'new' | null>(null);
  const [rollFor, setRollFor] = useState<AdminMaterial | null>(null);
  const [created, setCreated] = useState<Unit | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const materials = (list.data?.materials ?? []).filter((m) => showInactive || m.isActive);
  const totalValue = materials.reduce((a, m) => a + (m.stockValue ?? 0), 0);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Materiales</h1>
        <div className="row">
          <Link to="/admin/ajustes" className="button">Tallas y tolerancia</Link>
          <button className="primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>Nuevo material</button>
        </div>
      </div>
      <p className="muted">
        Un material es la referencia (marca, color, acabado). Cada rollo físico se registra aparte, con su código.
        {totalValue > 0 && <> Valor aproximado del stock: <strong>{fmtMoney(totalValue)}</strong>.</>}
      </p>

      {editing && (
        <MaterialForm
          material={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            void list.reload();
          }}
        />
      )}
      {created && (
        <p className="ok card">
          Rollo <strong>{created.code}</strong> creado con {fmtM2(created.balanceMm2)}. Escribe el código en el tubo.{' '}
          <Link to={`/stock/${created.id}`}>Ver</Link>
        </p>
      )}
      {rollFor && (
        <RollForm
          material={rollFor}
          onCancel={() => setRollFor(null)}
          onDone={(u) => {
            setRollFor(null);
            setCreated(u);
            void list.reload();
          }}
        />
      )}

      <label className="row small">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inactivos
      </label>
      <ErrorMsg error={list.error} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ref.</th><th>Material</th><th>Tipo</th><th>Stock</th><th>Mínimo</th><th>Costo / m²</th><th>Valor</th><th></th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id} className={m.isActive ? '' : 'inactive'}>
                <td>{m.sku}</td>
                <td>{m.label}</td>
                <td>{TYPE_LABEL[m.type]}</td>
                <td className={m.lowStock ? 'warn' : ''}>
                  {fmtM2(m.stock.rollsMm2 + m.stock.remnantsMm2)} <small className="muted">({m.stock.activeUnits} u.)</small>
                </td>
                <td>{m.minStockMm2 ? fmtM2(m.minStockMm2) : '—'}</td>
                <td>{m.costPerM2 !== null ? fmtMoney(m.costPerM2) : '—'}</td>
                <td>{m.stockValue !== null ? fmtMoney(m.stockValue) : '—'}</td>
                <td className="actions">
                  {m.isActive && <button onClick={() => { setCreated(null); setRollFor(m); }}>+ Rollo</button>}
                  <button onClick={() => setEditing(m)}>Editar</button>
                </td>
              </tr>
            ))}
            {list.data && materials.length === 0 && (
              <tr><td colSpan={8} className="muted center">Aún no hay materiales. Crea el primero.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaterialForm({ material, onDone }: { material: AdminMaterial | null; onDone: () => void }) {
  const [f, setF] = useState({
    sku: material?.sku ?? '',
    brand: material?.brand ?? '',
    line: material?.line ?? '',
    color: material?.color ?? '',
    finish: (material?.finish ?? 'BRILLANTE') as Finish,
    type: (material?.type ?? 'VINILO_CORTE') as MaterialType,
    gramsPerM2: material?.gramsPerM2?.toString() ?? '',
    costPerM2: material?.costPerM2?.toString() ?? '',
    minStock: material?.minStockMm2 ? String(material.minStockMm2 / 1_000_000) : '',
    isActive: material?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const num = (v: string) => (v.trim() === '' ? null : Math.round(parseDecimal(v)));
    const body = {
      sku: f.sku,
      brand: f.brand,
      line: f.line,
      color: f.color,
      finish: f.finish,
      type: f.type,
      gramsPerM2: num(f.gramsPerM2),
      costPerM2: num(f.costPerM2),
      minStockMm2: f.minStock ? (m2ToMm2(f.minStock) ?? 0) : 0,
      ...(material ? { isActive: f.isActive } : {}),
    };
    try {
      if (material) await api('PATCH', `/api/admin/materials/${material.id}`, body);
      else await api('POST', '/api/admin/materials', body);
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{material ? `Editar ${material.sku}` : 'Nuevo material'}</h2>
      <div className="form-grid">
        <label className="field"><span>Marca</span><input required maxLength={60} value={f.brand} onChange={(e) => set('brand')(e.target.value)} placeholder="3M, Avery, Oracal…" /></label>
        <label className="field"><span>Línea</span><input maxLength={60} value={f.line} onChange={(e) => set('line')(e.target.value)} placeholder="2080, 751…" /></label>
        <label className="field"><span>Color</span><input required maxLength={60} value={f.color} onChange={(e) => set('color')(e.target.value)} /></label>
        <label className="field">
          <span>Acabado</span>
          <select value={f.finish} onChange={(e) => set('finish')(e.target.value)}>
            {Object.entries(FINISH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={f.type} onChange={(e) => set('type')(e.target.value)}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field"><span>Referencia</span><input maxLength={40} value={f.sku} onChange={(e) => set('sku')(e.target.value)} placeholder="Automática (M-001)" /></label>
        <NumField label="Costo por m² (pesos)" value={f.costPerM2} onChange={set('costPerM2')} hint="Solo lo ve el administrador." />
        <NumField label="Stock mínimo (m²)" value={f.minStock} onChange={set('minStock')} hint="Avisa cuando el stock baje de aquí." />
        <NumField label="Gramaje (g/m²)" value={f.gramsPerM2} onChange={set('gramsPerM2')} hint="Opcional: permite medir los rollos pesándolos." />
      </div>
      {material && (
        <label className="row small">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Activo
        </label>
      )}
      <ErrorMsg error={error} />
      <button className="primary">Guardar</button>
    </form>
  );
}

function RollForm({ material, onDone, onCancel }: { material: AdminMaterial; onDone: (u: Unit) => void; onCancel: () => void }) {
  const [f, setF] = useState({ code: '', width: '152', length: '', core: '', location: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const area = (cmToMm(f.width) ?? 0) * (mToMm(f.length) ?? 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ unit: Unit }>('POST', '/api/admin/units', {
        materialId: material.id,
        code: f.code || undefined,
        widthMm: cmToMm(f.width),
        lengthMm: mToMm(f.length),
        coreWeightG: f.core ? Math.round(parseDecimal(f.core)) : null,
        location: f.location,
      });
      onDone(r.unit);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row between">
        <h2>Nuevo rollo de {material.label}</h2>
        <button type="button" onClick={onCancel}>Cancelar</button>
      </div>
      <p className="muted small">Para inventario inicial o rollos que entran sin compra registrada. Si el rollo ya está empezado, escribe el largo que le queda.</p>
      <div className="form-grid">
        <NumField label="Ancho (cm)" value={f.width} onChange={set('width')} required />
        <NumField label="Largo (m)" value={f.length} onChange={set('length')} required />
        <NumField label="Peso del tubo vacío (g)" value={f.core} onChange={set('core')} hint="Opcional, para contar por peso." />
        <label className="field"><span>Ubicación</span><input maxLength={60} value={f.location} onChange={(e) => set('location')(e.target.value)} placeholder="Estante 2" /></label>
        <label className="field"><span>Código</span><input maxLength={20} value={f.code} onChange={(e) => set('code')(e.target.value)} placeholder="Automático (R-001)" /></label>
      </div>
      {area > 0 && <p className="summary">Entra al inventario: {fmtM2(area)}</p>}
      <ErrorMsg error={error} />
      <button className="primary">Crear rollo</button>
    </form>
  );
}
