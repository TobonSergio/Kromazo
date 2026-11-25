import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { FreehandSize, InventorySettings, MaterialType } from '../../api/inventory';
import { TYPE_LABEL } from '../../api/inventory';
import { ErrorMsg, NumField, errorText } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { fmtM2, m2ToMm2, parseDecimal } from '../../units';

export function InventorySettingsPage() {
  const sizes = useApi<{ sizes: FreehandSize[] }>('/api/admin/freehand-sizes');
  const [editing, setEditing] = useState<FreehandSize | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(s: FreehandSize) {
    try {
      await api('PATCH', `/api/admin/freehand-sizes/${s.id}`, { isActive: !s.isActive });
      void sizes.reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="stack">
      <h1>Cortes a pulso</h1>

      <section className="stack">
        <div className="row between">
          <h2>Tallas</h2>
          <button className="primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>Nueva talla</button>
        </div>
        <p className="muted small">
          Los botones que ve el empleado al registrar un corte a pulso. El área es una referencia: los conteos físicos la
          corrigen. Cambiarla no afecta los cortes ya registrados.
        </p>
        {editing && (
          <SizeForm
            size={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
              void sizes.reload();
            }}
          />
        )}
        <ErrorMsg error={error ?? sizes.error} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Orden</th><th>Nombre</th><th>Área</th><th>Aplica a</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {sizes.data?.sizes.map((s) => (
                <tr key={s.id} className={s.isActive ? '' : 'inactive'}>
                  <td>{s.sortOrder}</td>
                  <td>{s.name}</td>
                  <td>{fmtM2(s.refAreaMm2, 3)}</td>
                  <td>{s.materialType ? TYPE_LABEL[s.materialType] : 'Todos'}</td>
                  <td>{s.isActive ? 'Activa' : 'Inactiva'}</td>
                  <td className="actions">
                    <button onClick={() => setEditing(s)}>Editar</button>
                    <button onClick={() => toggle(s)}>{s.isActive ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SettingsForm />
    </div>
  );
}

function SizeForm({ size, onDone }: { size: FreehandSize | null; onDone: () => void }) {
  const [f, setF] = useState({
    name: size?.name ?? '',
    area: size ? String(size.refAreaMm2 / 1_000_000) : '',
    materialType: (size?.materialType ?? '') as MaterialType | '',
    sortOrder: String(size?.sortOrder ?? 50),
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: f.name,
      refAreaMm2: m2ToMm2(f.area),
      materialType: f.materialType || null,
      sortOrder: Math.round(parseDecimal(f.sortOrder)) || 0,
    };
    try {
      if (size) await api('PATCH', `/api/admin/freehand-sizes/${size.id}`, body);
      else await api('POST', '/api/admin/freehand-sizes', body);
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>Nombre</span><input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tanque, filete, calca pequeña…" /></label>
        <NumField label="Área de referencia (m²)" hint="Ej.: 50 × 50 cm = 0,25" value={f.area} onChange={(area) => setF({ ...f, area })} required />
        <label className="field">
          <span>Aplica a</span>
          <select value={f.materialType} onChange={(e) => setF({ ...f, materialType: e.target.value as MaterialType | '' })}>
            <option value="">Todos los materiales</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <NumField label="Orden" value={f.sortOrder} onChange={(sortOrder) => setF({ ...f, sortOrder })} />
      </div>
      <ErrorMsg error={error} />
      <button className="primary">Guardar</button>
    </form>
  );
}

function SettingsForm() {
  const settings = useApi<{ settings: InventorySettings }>('/api/admin/settings');
  const [f, setF] = useState({ tol: '', alert: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setF({ tol: String(settings.data.settings.freehandTolerancePct), alert: String(settings.data.settings.freehandPendingAlert) });
    }
  }, [settings.data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('PATCH', '/api/admin/settings', {
        freehandTolerancePct: Math.round(parseDecimal(f.tol)),
        freehandPendingAlert: Math.round(parseDecimal(f.alert)),
      });
      setError(null);
      setMsg('Guardado.');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Conciliación</h2>
      <NumField
        label="Tolerancia (%)"
        hint="En un conteo, cuánto de la diferencia se atribuye a la imprecisión de los cortes a pulso pendientes (0 a 100). Lo que exceda se reporta como faltante sin explicar."
        value={f.tol}
        onChange={(tol) => setF({ ...f, tol })}
        required
      />
      <NumField
        label="Pedir medición tras N cortes a pulso"
        hint="Se marca el rollo como «por medir» cuando acumula esta cantidad de cortes a pulso sin verificar."
        value={f.alert}
        onChange={(alert) => setF({ ...f, alert })}
        required
      />
      <ErrorMsg error={error ?? settings.error} />
      {msg && <p className="ok">{msg}</p>}
      <button className="primary">Guardar</button>
    </form>
  );
}
