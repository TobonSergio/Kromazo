import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { CutView, Movement, PhysicalCount, Unit } from '../../api/inventory';
import { MOVEMENT_LABEL, STATUS_LABEL } from '../../api/inventory';
import { useAuth } from '../../auth';
import { ErrorMsg, NumField, errorText } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { cmToMm, fmtCm, fmtDate, fmtDims, fmtM, fmtM2, m2ToMm2, parseDecimal } from '../../units';

interface Detail { unit: Unit; cuts: CutView[]; movements: Movement[] }

export function UnitPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const detail = useApi<Detail>(`/api/staff/units/${id}`);
  const counts = useApi<{ counts: PhysicalCount[] }>(isAdmin ? `/api/admin/units/${id}/counts` : null);
  const reload = () => {
    void detail.reload();
    void counts.reload();
  };

  if (detail.error) return <ErrorMsg error={detail.error} />;
  if (!detail.data) return <p className="muted center">Cargando…</p>;
  const { unit: u, cuts, movements } = detail.data;

  return (
    <div className="stack">
      <Link to="/stock" className="muted">← Stock</Link>
      <div className="row between">
        <div>
          <h1>{u.code} <span className={`badge ${u.status.toLowerCase()}`}>{STATUS_LABEL[u.status]}</span></h1>
          <p className="muted">{u.materialLabel}</p>
        </div>
        {u.status === 'ACTIVE' && <Link className="button primary" to={`/corte?unidad=${u.id}`}>Registrar corte</Link>}
      </div>

      <div className="grid stats">
        <Stat label="Saldo" value={fmtM2(u.balanceMm2)} />
        <Stat label="Largo restante aprox." value={fmtM(u.approxLengthMm)} />
        <Stat label={u.kind === 'ROLL' ? 'Ancho del rollo' : 'Medidas del retazo'} value={u.kind === 'ROLL' ? fmtCm(u.widthMm) : fmtDims(u.widthMm, u.initialLengthMm)} />
        <Stat label="Cortes a pulso sin verificar" value={`${u.pendingFreehand.count} (${fmtM2(u.pendingFreehand.areaMm2)})`} warn={u.needsCount} />
      </div>
      <p className="muted small">
        {u.location ? `Ubicación: ${u.location}. ` : ''}
        {u.parentCode ? `Retazo de ${u.parentCode}. ` : ''}
        {u.kind === 'ROLL' && `Largo inicial ${fmtM(u.initialLengthMm)}. `}
        {u.coreWeightG !== null && `Tubo: ${u.coreWeightG} g.`}
      </p>

      {isAdmin && u.status !== 'DISCARDED' && <AdminActions unit={u} onDone={reload} />}

      <section className="stack">
        <h2>Cortes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Medida</th><th>Área</th><th>Retazos</th><th>Desperdicio</th><th>Quién</th><th>Trabajo / nota</th></tr>
            </thead>
            <tbody>
              {cuts.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDate(c.createdAt)}</td>
                  <td>{c.method === 'FREEHAND' ? 'A pulso' : 'Medido'}</td>
                  <td>{c.sizeName ?? (c.cutLengthMm && c.cutWidthMm ? fmtDims(c.cutWidthMm, c.cutLengthMm) : '—')}</td>
                  <td>
                    {fmtM2(c.cutAreaMm2)}
                    {c.method === 'FREEHAND' && (c.reconciled ? <small className="muted"> → real {fmtM2(c.reconciledAreaMm2!)}</small> : <small className="muted"> (estimado)</small>)}
                  </td>
                  <td>{c.remnantCodes.join(', ') || '—'}</td>
                  <td>{c.method === 'MEASURED' ? fmtM2(c.wasteAreaMm2) : '—'}</td>
                  <td>{c.userName}</td>
                  <td>
                    {c.orderCode && <Link to={`/pedidos/${c.orderId}`}>{c.orderCode}</Link>} {c.notes ?? ''}
                  </td>
                </tr>
              ))}
              {cuts.length === 0 && <tr><td colSpan={8} className="muted center">Sin cortes.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && counts.data && counts.data.counts.length > 0 && (
        <section className="stack">
          <h2>Conteos físicos</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Fecha</th><th>Medido</th><th>Sistema</th><th>Medido (m²)</th><th>Atribuido a cortes a pulso</th><th>Sin explicar</th><th>Quién</th></tr>
              </thead>
              <tbody>
                {counts.data.counts.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDate(c.createdAt)}</td>
                    <td>{c.method === 'LENGTH' ? `${fmtM(c.measuredLengthMm!)} de largo` : `${c.measuredWeightG} g`}</td>
                    <td>{fmtM2(c.systemAreaMm2)}</td>
                    <td>{fmtM2(c.computedAreaMm2)}</td>
                    <td>{signed(c.freehandAdjustMm2)}</td>
                    <td className={c.unexplainedMm2 < 0 ? 'warn' : ''}>{signed(c.unexplainedMm2)}</td>
                    <td>{c.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="stack">
        <h2>Movimientos</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Área</th><th>Motivo</th><th>Quién</th></tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.createdAt)}</td>
                  <td>{MOVEMENT_LABEL[m.type]}</td>
                  <td>{signed(m.areaMm2)}</td>
                  <td>{m.reason ?? ''}</td>
                  <td>{m.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const signed = (mm2: number) => (mm2 === 0 ? '0' : `${mm2 > 0 ? '+' : '−'}${fmtM2(Math.abs(mm2))}`);

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="card stat">
      <small className="muted">{label}</small>
      <strong className={warn ? 'warn' : ''}>{value}</strong>
    </div>
  );
}

type Action = 'count' | 'adjust' | 'discard' | 'edit' | null;

function AdminActions({ unit, onDone }: { unit: Unit; onDone: () => void }) {
  const [action, setAction] = useState<Action>(null);
  const toggle = (a: Action) => setAction(action === a ? null : a);
  const done = () => {
    setAction(null);
    onDone();
  };
  return (
    <div className="stack">
      <div className="row">
        <button className={action === 'count' ? 'on' : ''} onClick={() => toggle('count')}>Medir (conteo físico)</button>
        <button className={action === 'adjust' ? 'on' : ''} onClick={() => toggle('adjust')}>Ajuste</button>
        <button className={action === 'edit' ? 'on' : ''} onClick={() => toggle('edit')}>Ubicación / tubo</button>
        <button className={action === 'discard' ? 'on' : ''} onClick={() => toggle('discard')}>Dar de baja</button>
      </div>
      {action === 'count' && <CountForm unit={unit} onDone={done} />}
      {action === 'adjust' && <AdjustForm unit={unit} onDone={done} />}
      {action === 'edit' && <EditForm unit={unit} onDone={done} />}
      {action === 'discard' && <DiscardForm unit={unit} onDone={done} />}
    </div>
  );
}

function useSubmit(fn: () => Promise<unknown>, onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return { error, setError, busy, submit };
}

function CountForm({ unit, onDone }: { unit: Unit; onDone: () => void }) {
  const [method, setMethod] = useState<'LENGTH' | 'WEIGHT'>('LENGTH');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const { error, busy, submit } = useSubmit(async () => {
    const n = parseDecimal(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('Escribe la medida.');
    const body =
      method === 'LENGTH'
        ? { method, measuredLengthMm: Math.round(n * 1000), notes: notes || undefined }
        : { method, measuredWeightG: Math.round(n), notes: notes || undefined };
    await api('POST', `/api/admin/units/${unit.id}/counts`, body);
  }, onDone);

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Conteo físico de {unit.code}</h2>
      <p className="muted small">
        El sistema espera {fmtM2(unit.balanceMm2)} (≈ {fmtM(unit.approxLengthMm)}). La diferencia se reparte primero entre los
        cortes a pulso sin verificar (hasta la tolerancia) y el resto queda como faltante o sobrante sin explicar.
      </p>
      <div className="segmented">
        <button type="button" className={method === 'LENGTH' ? 'on' : ''} onClick={() => setMethod('LENGTH')}>Por largo</button>
        <button type="button" className={method === 'WEIGHT' ? 'on' : ''} onClick={() => setMethod('WEIGHT')}>Por peso</button>
      </div>
      <NumField
        label={method === 'LENGTH' ? 'Largo que queda (m)' : 'Peso total con tubo (g)'}
        hint={method === 'WEIGHT' ? 'Requiere el gramaje del material y el peso del tubo.' : '0 si ya no queda nada.'}
        value={value}
        onChange={setValue}
        required
      />
      <label className="field"><span>Nota</span><input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
      <ErrorMsg error={error} />
      <button className="primary" disabled={busy}>Guardar conteo</button>
    </form>
  );
}

function AdjustForm({ unit, onDone }: { unit: Unit; onDone: () => void }) {
  const [mode, setMode] = useState<'length' | 'area'>(unit.kind === 'ROLL' ? 'length' : 'area');
  const [sign, setSign] = useState<-1 | 1>(-1);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const area = mode === 'length' ? (cmToMm(value) ?? 0) * unit.widthMm : (m2ToMm2(value) ?? 0);
  const { error, busy, submit } = useSubmit(async () => {
    if (!area) throw new Error('Escribe la cantidad.');
    await api('POST', `/api/admin/units/${unit.id}/adjust`, { areaMm2: sign * area, reason });
  }, onDone);

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Ajuste manual</h2>
      <p className="muted small">Para corregir un error de registro. Para material perdido sin explicación, usa mejor el conteo físico.</p>
      <div className="segmented">
        <button type="button" className={sign === -1 ? 'on' : ''} onClick={() => setSign(-1)}>Quitar</button>
        <button type="button" className={sign === 1 ? 'on' : ''} onClick={() => setSign(1)}>Agregar</button>
      </div>
      <div className="row">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'length' | 'area')}>
          <option value="length">Largo (cm) × ancho</option>
          <option value="area">Área (m²)</option>
        </select>
        <NumField label={mode === 'length' ? 'Largo (cm)' : 'Área (m²)'} value={value} onChange={setValue} required />
      </div>
      {area > 0 && <p className="summary">{sign < 0 ? 'Se quitan' : 'Se agregan'} {fmtM2(area)}</p>}
      <label className="field"><span>Motivo</span><input required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <ErrorMsg error={error} />
      <button className="primary" disabled={busy}>Guardar ajuste</button>
    </form>
  );
}

function EditForm({ unit, onDone }: { unit: Unit; onDone: () => void }) {
  const [location, setLocation] = useState(unit.location ?? '');
  const [core, setCore] = useState(unit.coreWeightG?.toString() ?? '');
  const { error, busy, submit } = useSubmit(async () => {
    const body: Record<string, unknown> = { location };
    if (unit.kind === 'ROLL') body.coreWeightG = core === '' ? null : Math.round(parseDecimal(core));
    await api('PATCH', `/api/admin/units/${unit.id}`, body);
  }, onDone);
  return (
    <form className="card stack" onSubmit={submit}>
      <label className="field"><span>Ubicación</span><input maxLength={60} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      {unit.kind === 'ROLL' && <NumField label="Peso del tubo vacío (g)" hint="Para poder contar el rollo pesándolo." value={core} onChange={setCore} />}
      <ErrorMsg error={error} />
      <button className="primary" disabled={busy}>Guardar</button>
    </form>
  );
}

function DiscardForm({ unit, onDone }: { unit: Unit; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { error, busy, submit } = useSubmit(() => api('POST', `/api/admin/units/${unit.id}/discard`, { reason }), onDone);
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Dar de baja {unit.code}</h2>
      <p className="muted small">Se descuenta el saldo restante ({fmtM2(unit.balanceMm2)}) y la unidad ya no se podrá cortar.</p>
      <label className="field"><span>Motivo</span><input required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <ErrorMsg error={error} />
      <button className="primary danger" disabled={busy}>Dar de baja</button>
    </form>
  );
}
