import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Material, Unit } from '../../api/inventory';
import { TYPE_LABEL } from '../../api/inventory';
import { ErrorMsg } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { useAuth } from '../../auth';
import { fmtCm, fmtM, fmtM2 } from '../../units';

/** Stock en m² por material, con sus rollos y retazos. Sin costos (lo ven admin y empleado). */
export function StockPage() {
  const { user } = useAuth();
  const materials = useApi<{ materials: Material[] }>('/api/staff/materials');
  const units = useApi<{ units: Unit[] }>('/api/staff/units');
  const [q, setQ] = useState('');
  const [onlyCount, setOnlyCount] = useState(false);

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const byMat = new Map<number, Unit[]>();
    for (const u of units.data?.units ?? []) {
      if (onlyCount && !u.needsCount) continue;
      if (t && !`${u.code} ${u.materialLabel} ${u.location ?? ''}`.toLowerCase().includes(t)) continue;
      byMat.set(u.materialId, [...(byMat.get(u.materialId) ?? []), u]);
    }
    return (materials.data?.materials ?? [])
      .filter((m) => byMat.has(m.id) || (!onlyCount && (!t || `${m.label} ${m.sku}`.toLowerCase().includes(t))))
      .map((m) => ({ material: m, units: byMat.get(m.id) ?? [] }));
  }, [materials.data, units.data, q, onlyCount]);

  const toCount = units.data?.units.filter((u) => u.needsCount).length ?? 0;
  const low = materials.data?.materials.filter((m) => m.lowStock).length ?? 0;

  return (
    <div className="stack">
      <div className="row between">
        <h1>Stock</h1>
        {user?.role === 'ADMIN' && <Link to="/admin/materiales" className="button">Materiales y rollos</Link>}
      </div>

      {(toCount > 0 || low > 0) && (
        <div className="row">
          {toCount > 0 && (
            <button className={`chip warn-chip ${onlyCount ? 'on' : ''}`} onClick={() => setOnlyCount(!onlyCount)}>
              {toCount} por medir
            </button>
          )}
          {low > 0 && <span className="chip warn-chip">{low} con stock bajo</span>}
        </div>
      )}

      <input placeholder="Buscar código, color, marca o ubicación" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorMsg error={materials.error ?? units.error} />

      {groups.map(({ material: m, units: list }) => (
        <section key={m.id} className="card stack">
          <div className="row between">
            <div>
              <h2>{m.label}</h2>
              <small className="muted">{m.sku} · {TYPE_LABEL[m.type]}</small>
            </div>
            <div className="right">
              <strong>{fmtM2(m.stock.rollsMm2 + m.stock.remnantsMm2)}</strong>
              {m.lowStock && <div className="warn small">Stock bajo (mín. {fmtM2(m.minStockMm2)})</div>}
              {m.stock.remnantsMm2 > 0 && <div className="muted small">{fmtM2(m.stock.remnantsMm2)} en retazos</div>}
            </div>
          </div>
          {list.length > 0 && (
            <ul className="unit-list">
              {list.map((u) => (
                <li key={u.id}>
                  <Link to={`/stock/${u.id}`}>
                    <strong>{u.code}</strong>
                    <span className="muted">
                      {u.kind === 'REMNANT' ? `Retazo ${fmtCm(u.widthMm)} × ${fmtCm(u.initialLengthMm)}` : `Rollo ${fmtCm(u.widthMm)}`}
                      {u.location ? ` · ${u.location}` : ''}
                    </span>
                    <span className="right">
                      {fmtM2(u.balanceMm2)}
                      {u.kind === 'ROLL' && <small className="muted"> ≈ {fmtM(u.approxLengthMm, 1)}</small>}
                    </span>
                  </Link>
                  {u.needsCount && <span className="warn small">Medir: {u.pendingFreehand.count} cortes a pulso sin verificar</span>}
                </li>
              ))}
            </ul>
          )}
          {list.length === 0 && <p className="muted small">Sin rollos ni retazos activos.</p>}
        </section>
      ))}
      {materials.data && groups.length === 0 && <p className="muted center">Nada que mostrar.</p>}
    </div>
  );
}
