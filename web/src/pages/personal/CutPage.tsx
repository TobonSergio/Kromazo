import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { CutView, FreehandSize, Unit } from '../../api/inventory';
import type { OrderSummaryStaff } from '../../api/orders';
import { ErrorMsg, NumField, errorText } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { cmToMm, fmtCm, fmtM, fmtM2, m2ToMm2 } from '../../units';

type Method = 'FREEHAND' | 'MEASURED';
interface RemnantRow { w: string; l: string }
interface CutResult { cut: CutView; unit: Unit; remnants: Unit[] }

/**
 * Registrar un corte. Pensada para el celular: elegir rollo, un toque para la talla y guardar.
 * Ver docs/ARQUITECTURA.md §1.1.
 */
export function CutPage() {
  const [params, setParams] = useSearchParams();
  const unitId = Number(params.get('unidad')) || null;
  const orderParam = params.get('pedido');
  const units = useApi<{ units: Unit[] }>('/api/staff/units');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<CutResult | null>(null);

  const unit = units.data?.units.find((u) => u.id === unitId) ?? null;
  const select = (id: number | null) => {
    setResult(null);
    const next: Record<string, string> = {};
    if (id) next.unidad = String(id);
    if (orderParam) next.pedido = orderParam;
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = units.data?.units ?? [];
    return t ? list.filter((u) => `${u.code} ${u.materialLabel} ${u.location ?? ''}`.toLowerCase().includes(t)) : list;
  }, [units.data, q]);

  if (result) {
    return (
      <CutDone
        result={result}
        onAgain={() => {
          setResult(null);
          void units.reload();
        }}
        onOther={() => {
          void units.reload();
          select(null);
        }}
      />
    );
  }

  return (
    <div className="stack narrow">
      <h1>Registrar corte</h1>
      <ErrorMsg error={units.error} />

      {!unit ? (
        <div className="stack">
          <input
            className="big"
            placeholder="Busca el rollo: código, color, marca…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {units.loading && !units.data && <p className="muted">Cargando…</p>}
          <div className="pick-list">
            {filtered.map((u) => (
              <button key={u.id} className="pick" onClick={() => select(u.id)}>
                <strong>{u.code}</strong> <span>{u.materialLabel}</span>
                <small className="muted">
                  {u.kind === 'REMNANT' ? 'Retazo' : 'Rollo'} · {fmtCm(u.widthMm)} de ancho · quedan {fmtM2(u.balanceMm2)}
                  {u.location ? ` · ${u.location}` : ''}
                </small>
              </button>
            ))}
            {units.data && filtered.length === 0 && <p className="muted">No hay rollos activos que coincidan.</p>}
          </div>
        </div>
      ) : (
        <CutForm unit={unit} defaultOrderId={Number(orderParam) || null} onChangeUnit={() => select(null)} onDone={setResult} />
      )}
    </div>
  );
}

function CutForm({
  unit,
  defaultOrderId,
  onChangeUnit,
  onDone,
}: {
  unit: Unit;
  defaultOrderId: number | null;
  onChangeUnit: () => void;
  onDone: (r: CutResult) => void;
}) {
  const activeOrders = useApi<{ orders: OrderSummaryStaff[] }>('/api/staff/orders?status=APROBADO,EN_PROCESO');
  const [orderId, setOrderId] = useState<number | null>(defaultOrderId);
  const sizes = useApi<{ sizes: FreehandSize[] }>(`/api/staff/freehand-sizes?materialType=${unit.materialType}`);
  const [method, setMethod] = useState<Method>('FREEHAND');
  const [sizeId, setSizeId] = useState<number | null>(null);
  const [custom, setCustom] = useState({ l: '', w: '' }); // a pulso, "otro tamaño"
  const [measured, setMeasured] = useState({ l: '', w: '', used: '' });
  const [remnants, setRemnants] = useState<RemnantRow[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Vista previa del área que sale (para que el operario confirme antes de guardar).
  const preview = useMemo(() => {
    const remArea = remnants.reduce((a, r) => a + (cmToMm(r.w) ?? 0) * (cmToMm(r.l) ?? 0), 0);
    let area: number | null = null;
    if (method === 'FREEHAND') {
      if (sizeId) area = sizes.data?.sizes.find((s) => s.id === sizeId)?.refAreaMm2 ?? null;
      else if (custom.l) {
        const l = cmToMm(custom.l);
        const w = custom.w ? cmToMm(custom.w) : unit.widthMm;
        area = l && w ? l * w : null;
      }
    } else {
      const l = cmToMm(measured.l);
      const w = measured.w ? cmToMm(measured.w) : unit.widthMm;
      area = l && w ? l * w : null;
    }
    const used = method === 'MEASURED' && measured.used ? m2ToMm2(measured.used) : null;
    const waste = area !== null && used !== null ? area - remArea - used : 0;
    return { area, remArea, waste };
  }, [method, sizeId, custom, measured, remnants, sizes.data, unit.widthMm]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const rems = remnants
      .filter((r) => r.w || r.l)
      .map((r) => ({ widthMm: cmToMm(r.w), lengthMm: cmToMm(r.l) }));
    if (rems.some((r) => !r.widthMm || !r.lengthMm || r.widthMm <= 0 || r.lengthMm <= 0)) {
      return setError('Revisa las medidas de los retazos (en cm).');
    }
    const body: Record<string, unknown> = { unitId: unit.id, orderId, method, notes: notes || undefined, remnants: rems };
    if (method === 'FREEHAND') {
      if (sizeId) body.sizeId = sizeId;
      else if (custom.l) {
        body.lengthMm = cmToMm(custom.l);
        if (custom.w) body.widthMm = cmToMm(custom.w);
      } else return setError('Elige un tamaño o escribe uno aproximado.');
    } else {
      body.lengthMm = cmToMm(measured.l);
      if (!body.lengthMm) return setError('Escribe el largo cortado.');
      if (measured.w) body.widthMm = cmToMm(measured.w);
      if (measured.used) body.usedAreaMm2 = m2ToMm2(measured.used);
    }
    setBusy(true);
    try {
      onDone(await api<CutResult>('POST', '/api/staff/cuts', body));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="card row between">
        <div>
          <strong>{unit.code}</strong> · {unit.materialLabel}
          <div className="muted small">
            {fmtCm(unit.widthMm)} de ancho · quedan {fmtM2(unit.balanceMm2)} (≈ {fmtM(unit.approxLengthMm)})
          </div>
        </div>
        <button type="button" onClick={onChangeUnit}>Cambiar</button>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Forma de cortar">
        <button type="button" role="radio" aria-checked={method === 'FREEHAND'} className={method === 'FREEHAND' ? 'on' : ''} onClick={() => setMethod('FREEHAND')}>
          A pulso
        </button>
        <button type="button" role="radio" aria-checked={method === 'MEASURED'} className={method === 'MEASURED' ? 'on' : ''} onClick={() => setMethod('MEASURED')}>
          Medido
        </button>
      </div>

      {method === 'FREEHAND' ? (
        <div className="stack">
          <p className="muted small">¿Más o menos de qué tamaño fue el corte?</p>
          <div className="size-grid">
            {sizes.data?.sizes.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`size ${sizeId === s.id ? 'on' : ''}`}
                onClick={() => {
                  setSizeId(sizeId === s.id ? null : s.id);
                  setCustom({ l: '', w: '' });
                }}
              >
                {s.name}
                <small>{fmtM2(s.refAreaMm2)}</small>
              </button>
            ))}
          </div>
          <details open={!!custom.l}>
            <summary>Otro tamaño (aproximado)</summary>
            <div className="row">
              <NumField label="Largo (cm)" value={custom.l} onChange={(l) => { setCustom({ ...custom, l }); setSizeId(null); }} />
              <NumField label="Ancho (cm)" placeholder={`${unit.widthMm / 10}`} value={custom.w} onChange={(w) => setCustom({ ...custom, w })} />
            </div>
          </details>
        </div>
      ) : (
        <div className="stack">
          <div className="row">
            <NumField label="Largo cortado (cm)" value={measured.l} onChange={(l) => setMeasured({ ...measured, l })} required />
            <NumField label="Ancho (cm)" placeholder={`${unit.widthMm / 10} (todo)`} value={measured.w} onChange={(w) => setMeasured({ ...measured, w })} />
          </div>
          <NumField
            label="Área usada en el trabajo (m²)"
            hint="Vacío = todo lo que no es retazo se usó (sin desperdicio)."
            value={measured.used}
            onChange={(used) => setMeasured({ ...measured, used })}
          />
        </div>
      )}

      <div className="stack card">
        <div className="row between">
          <strong>Retazos que se guardan</strong>
          <button type="button" onClick={() => setRemnants([...remnants, { w: '', l: '' }])}>+ Retazo</button>
        </div>
        {remnants.length === 0 && <p className="muted small">Si sobró un pedazo reutilizable, agrégalo con sus medidas.</p>}
        {remnants.map((r, i) => (
          <div className="row" key={i}>
            <NumField label="Ancho (cm)" value={r.w} onChange={(w) => setRemnants(remnants.map((x, j) => (j === i ? { ...x, w } : x)))} />
            <NumField label="Largo (cm)" value={r.l} onChange={(l) => setRemnants(remnants.map((x, j) => (j === i ? { ...x, l } : x)))} />
            <button type="button" aria-label="Quitar retazo" onClick={() => setRemnants(remnants.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>

      <label className="field">
        <span>¿Para qué trabajo?</span>
        <select value={orderId ?? ''} onChange={(e) => setOrderId(Number(e.target.value) || null)}>
          <option value="">Ninguno (muestra o uso interno)</option>
          {activeOrders.data?.orders.map((o) => (
            <option key={o.id} value={o.id}>{o.code} · {o.customerName}{o.vehicleDesc ? ` · ${o.vehicleDesc}` : ''}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Nota (opcional)</span>
        <input value={notes} maxLength={300} placeholder="Trabajo, cliente, moto…" onChange={(e) => setNotes(e.target.value)} />
      </label>

      {preview.area !== null && (
        <p className="summary">
          Sale del rollo: <strong>{fmtM2(preview.area)}</strong>
          {method === 'FREEHAND' && ' (estimado)'}
          {preview.remArea > 0 && <> · retazos {fmtM2(preview.remArea)}</>}
          {method === 'MEASURED' && preview.waste > 0 && <> · desperdicio {fmtM2(preview.waste)}</>}
        </p>
      )}
      <ErrorMsg error={error} />
      <button className="primary big" disabled={busy}>{busy ? 'Guardando…' : 'Guardar corte'}</button>
    </form>
  );
}

function CutDone({ result, onAgain, onOther }: { result: CutResult; onAgain: () => void; onOther: () => void }) {
  const { cut, unit, remnants } = result;
  return (
    <div className="stack narrow">
      <div className="card stack done">
        <h1>✓ Corte guardado</h1>
        <p>
          {unit.code}: se descontaron <strong>{fmtM2(cut.cutAreaMm2)}</strong>
          {cut.method === 'FREEHAND' && ' (estimado)'}. Quedan <strong>{fmtM2(unit.balanceMm2)}</strong>.
        </p>
        {remnants.length > 0 && (
          <div className="stack">
            <p>Marca los retazos con su código:</p>
            {remnants.map((r) => (
              <p key={r.id} className="label-code">
                {r.code} <small className="muted">{fmtCm(r.widthMm)} × {fmtCm(r.initialLengthMm)}</small>
              </p>
            ))}
          </div>
        )}
        {unit.needsCount && (
          <p className="warn">Este rollo tiene varios cortes a pulso sin verificar. Avísale al administrador para que lo mida.</p>
        )}
        {unit.status === 'DEPLETED' && <p className="warn">El rollo quedó agotado.</p>}
      </div>
      {unit.status === 'ACTIVE' && <button className="primary big" onClick={onAgain}>Otro corte de {unit.code}</button>}
      <button className="big" onClick={onOther}>Cortar de otro rollo</button>
      {cut.orderId && <Link to={`/pedidos/${cut.orderId}`} className="button big center">Volver al trabajo {cut.orderCode}</Link>}
      <Link to={`/stock/${unit.id}`} className="center muted">Ver historial de {unit.code}</Link>
    </div>
  );
}
