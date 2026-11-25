import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { ORDER_STATUS_LABEL, PAYMENT_LABEL, type OrderStatus, type PaymentMethod } from '../../api/orders';
import { ErrorMsg, errorText } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { fmtDate, fmtM2, fmtMoney } from '../../units';

const todayCo = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - 5 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);
const fmtPct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`);

const TABS = [
  { key: 'stock', label: 'Stock y compras' },
  { key: 'sales', label: 'Ventas y cartera' },
  { key: 'margins', label: 'Margen por trabajo' },
  { key: 'waste', label: 'Desperdicio' },
  { key: 'shortages', label: 'Faltantes' },
  { key: 'freehand', label: 'Cortes a pulso' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('stock');
  const [range, setRange] = useState({ from: daysAgo(29), to: todayCo() });
  const qs = `from=${range.from}&to=${range.to}`;

  return (
    <div className="stack">
      <h1>Reportes</h1>
      <div className="tabs">
        {TABS.map((t) => <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {tab !== 'stock' && (
        <div className="row">
          <label className="field"><span>Desde</span><input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="field"><span>Hasta</span><input type="date" value={range.to} min={range.from} max={todayCo()} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <div className="row small">
            <button onClick={() => setRange({ from: daysAgo(6), to: todayCo() })}>7 días</button>
            <button onClick={() => setRange({ from: daysAgo(29), to: todayCo() })}>30 días</button>
            <button onClick={() => setRange({ from: `${todayCo().slice(0, 7)}-01`, to: todayCo() })}>Este mes</button>
            <button onClick={() => setRange({ from: `${todayCo().slice(0, 4)}-01-01`, to: todayCo() })}>Este año</button>
          </div>
        </div>
      )}
      {tab === 'stock' && <StockTab />}
      {tab === 'sales' && <SalesTab qs={qs} />}
      {tab === 'margins' && <MarginsTab qs={qs} />}
      {tab === 'waste' && <WasteTab qs={qs} />}
      {tab === 'shortages' && <ShortagesTab qs={qs} />}
      {tab === 'freehand' && <FreehandTab qs={qs} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'ok' }) {
  return (
    <div className="card stat">
      <small className="muted">{label}</small>
      <strong className={tone ?? ''}>{value}</strong>
    </div>
  );
}

// ───── Stock ─────

interface StockRow {
  materialId: number; sku: string; label: string; stockMm2: number; minStockMm2: number; consumedMm2: number;
  avgDailyMm2: number; daysLeft: number | null; costPerM2: number | null; stockValue: number | null; lowStock: boolean; alert: boolean;
}

function StockTab() {
  const [days, setDays] = useState(30);
  const { data, error, reload } = useApi<{ materials: StockRow[] }>(`/api/admin/reports/stock?days=${days}`);
  const settings = useApi<{ settings: { stockAlertDays: number } }>('/api/admin/settings');
  const [alertDays, setAlertDays] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const rows = data?.materials ?? [];
  const alerts = rows.filter((r) => r.alert);

  async function saveAlert() {
    try {
      await api('PATCH', '/api/admin/settings', { stockAlertDays: Number(alertDays) });
      setMsg(null);
      setAlertDays(null);
      void settings.reload();
      void reload();
    } catch (e) {
      setMsg(errorText(e));
    }
  }

  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label="Valor del inventario" value={fmtMoney(rows.reduce((a, r) => a + (r.stockValue ?? 0), 0))} />
        <Stat label="Materiales por comprar" value={String(alerts.length)} tone={alerts.length ? 'warn' : 'ok'} />
      </div>
      <div className="row small">
        <span>Consumo promedio de los últimos</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} días</option>)}
        </select>
        <span className="muted">· Avisar cuando dure menos de</span>
        <input
          style={{ width: 70, flex: 'none' }}
          inputMode="numeric"
          value={alertDays ?? String(settings.data?.settings.stockAlertDays ?? '')}
          onChange={(e) => setAlertDays(e.target.value.replace(/\D/g, ''))}
        />
        <span className="muted">días</span>
        {alertDays !== null && <button onClick={saveAlert}>Guardar</button>}
      </div>
      <ErrorMsg error={error ?? msg} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Material</th><th>Stock</th><th>Mínimo</th><th>Consumo/día</th><th>Alcanza para</th><th>Costo/m²</th><th>Valor</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.materialId} className={r.alert ? 'row-alert' : ''}>
                <td>{r.label} <small className="muted">{r.sku}</small></td>
                <td className={r.lowStock ? 'warn' : ''}>{fmtM2(r.stockMm2)}</td>
                <td>{r.minStockMm2 ? fmtM2(r.minStockMm2) : '—'}</td>
                <td>{r.avgDailyMm2 ? fmtM2(r.avgDailyMm2, 3) : '—'}</td>
                <td className={r.alert ? 'warn' : ''}>{r.daysLeft === null ? 'sin consumo' : `${r.daysLeft} días`}</td>
                <td>{r.costPerM2 !== null ? fmtMoney(r.costPerM2) : '—'}</td>
                <td>{r.stockValue !== null ? fmtMoney(r.stockValue) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {alerts.length > 0 && <Link to="/admin/compras" className="button primary">Registrar una compra</Link>}
    </div>
  );
}

// ───── Ventas ─────

interface Sales {
  orders: number; subtotal: number; tax: number; total: number; paymentsTotal: number; receivablesTotal: number;
  byCustomer: { customerId: number; name: string; orders: number; subtotal: number; tax: number; total: number }[];
  payments: { method: PaymentMethod; count: number; total: number }[];
  receivables: { orderId: number; code: string; status: OrderStatus; customerName: string; total: number; balance: number }[];
}

function SalesTab({ qs }: { qs: string }) {
  const { data, error } = useApi<Sales>(`/api/admin/reports/sales?${qs}`);
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;
  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label={`Ventas (${data.orders} trabajos aprobados)`} value={fmtMoney(data.total)} />
        <Stat label="Sin IVA" value={fmtMoney(data.subtotal)} />
        <Stat label="Pagos recibidos" value={fmtMoney(data.paymentsTotal)} />
        <Stat label="Por cobrar (total)" value={fmtMoney(data.receivablesTotal)} tone={data.receivablesTotal > 0 ? 'warn' : 'ok'} />
      </div>
      <p className="muted small">Ventas = trabajos aprobados en el rango que no se cancelaron. «Por cobrar» incluye todos los trabajos con saldo, de cualquier fecha.</p>
      <h2>Por cliente</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>Trabajos</th><th>Sin IVA</th><th>IVA</th><th>Total</th></tr></thead>
          <tbody>
            {data.byCustomer.map((c) => (
              <tr key={c.customerId}><td>{c.name}</td><td>{c.orders}</td><td>{fmtMoney(c.subtotal)}</td><td>{fmtMoney(c.tax)}</td><td>{fmtMoney(c.total)}</td></tr>
            ))}
            {data.byCustomer.length === 0 && <tr><td colSpan={5} className="muted center">Sin ventas en el rango.</td></tr>}
          </tbody>
        </table>
      </div>
      {data.payments.length > 0 && (
        <>
          <h2>Pagos por medio</h2>
          <div className="table-wrap">
            <table>
              <tbody>{data.payments.map((p) => <tr key={p.method}><td>{PAYMENT_LABEL[p.method]}</td><td>{p.count} pagos</td><td>{fmtMoney(p.total)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <h2>Cartera (saldos pendientes)</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Trabajo</th><th>Cliente</th><th>Estado</th><th>Total</th><th>Saldo</th></tr></thead>
          <tbody>
            {data.receivables.map((r) => (
              <tr key={r.orderId}>
                <td><Link to={`/pedidos/${r.orderId}`}>{r.code}</Link></td>
                <td>{r.customerName}</td>
                <td className={r.status === 'ENTREGADO' ? 'warn' : ''}>{ORDER_STATUS_LABEL[r.status]}</td>
                <td>{fmtMoney(r.total)}</td>
                <td className="warn">{fmtMoney(r.balance)}</td>
              </tr>
            ))}
            {data.receivables.length === 0 && <tr><td colSpan={5} className="muted center">Nadie debe nada.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───── Margen ─────

interface Margins {
  subtotal: number; materialCost: number; margin: number; marginPct: number | null;
  orders: { orderId: number; code: string; status: OrderStatus; customerName: string; subtotal: number; consumedMm2: number; materialCost: number; estimated: boolean; noCuts: boolean; margin: number; marginPct: number | null }[];
}

function MarginsTab({ qs }: { qs: string }) {
  const { data, error } = useApi<Margins>(`/api/admin/reports/margins?${qs}`);
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;
  const noCuts = data.orders.filter((o) => o.noCuts).length;
  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label="Ventas sin IVA" value={fmtMoney(data.subtotal)} />
        <Stat label="Costo de material" value={fmtMoney(data.materialCost)} />
        <Stat label="Margen sobre material" value={`${fmtMoney(data.margin)} (${fmtPct(data.marginPct)})`} tone="ok" />
      </div>
      <p className="muted small">
        Margen = precio sin IVA − costo del vinilo cargado al trabajo. No incluye mano de obra ni gastos fijos.
        {noCuts > 0 && <> <span className="warn">{noCuts} trabajo(s) no tienen cortes registrados</span>: su margen aparece como el 100 %.</>}
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Trabajo</th><th>Cliente</th><th>Estado</th><th>Sin IVA</th><th>Material</th><th>Costo</th><th>Margen</th></tr></thead>
          <tbody>
            {data.orders.map((o) => (
              <tr key={o.orderId}>
                <td><Link to={`/pedidos/${o.orderId}`}>{o.code}</Link></td>
                <td>{o.customerName}</td>
                <td>{ORDER_STATUS_LABEL[o.status]}</td>
                <td>{fmtMoney(o.subtotal)}</td>
                <td>{o.noCuts ? <span className="warn">sin cortes</span> : fmtM2(o.consumedMm2)}</td>
                <td>{fmtMoney(o.materialCost)}{o.estimated && <small className="muted"> aprox.</small>}</td>
                <td className={o.margin < 0 ? 'error' : ''}>{fmtMoney(o.margin)} <small className="muted">{fmtPct(o.marginPct)}</small></td>
              </tr>
            ))}
            {data.orders.length === 0 && <tr><td colSpan={7} className="muted center">Sin trabajos aprobados en el rango.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───── Desperdicio ─────

interface WasteRow { id: number; name: string; cuts: number; cutAreaMm2: number; wasteMm2: number; wastePct: number | null }

function WasteTab({ qs }: { qs: string }) {
  const { data, error } = useApi<{ totalCutMm2: number; totalWasteMm2: number; wastePct: number | null; byMaterial: WasteRow[]; byUser: WasteRow[] }>(`/api/admin/reports/waste?${qs}`);
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;
  const table = (title: string, rows: WasteRow[]) => (
    <>
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th></th><th>Cortes medidos</th><th>Área cortada</th><th>Desperdicio</th><th>%</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.cuts}</td><td>{fmtM2(r.cutAreaMm2)}</td><td>{fmtM2(r.wasteMm2)}</td><td>{fmtPct(r.wastePct)}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={5} className="muted center">Sin cortes medidos en el rango.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label="Área cortada (medida)" value={fmtM2(data.totalCutMm2)} />
        <Stat label="Desperdicio" value={`${fmtM2(data.totalWasteMm2)} (${fmtPct(data.wastePct)})`} />
      </div>
      <p className="muted small">Solo cortes medidos en los que se digitó el área usada; en los cortes a pulso el desperdicio no se separa.</p>
      {table('Por material', data.byMaterial)}
      {table('Por persona', data.byUser)}
    </div>
  );
}

// ───── Faltantes ─────

interface Shortages {
  totalMissingMm2: number; totalMissingValue: number;
  byMaterial: { materialId: number; label: string; counts: number; missingMm2: number; surplusMm2: number; freehandAdjustMm2: number; missingValue: number | null }[];
  counts: { id: number; createdAt: string; unitId: number; unitCode: string; systemAreaMm2: number; computedAreaMm2: number; freehandAdjustMm2: number; unexplainedMm2: number; userName: string }[];
}

function ShortagesTab({ qs }: { qs: string }) {
  const { data, error } = useApi<Shortages>(`/api/admin/reports/shortages?${qs}`);
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;
  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label="Material faltante sin explicar" value={fmtM2(data.totalMissingMm2)} tone={data.totalMissingMm2 > 0 ? 'warn' : 'ok'} />
        <Stat label="Valor aproximado" value={fmtMoney(data.totalMissingValue)} tone={data.totalMissingValue > 0 ? 'warn' : 'ok'} />
      </div>
      <p className="muted small">
        Lo que los conteos físicos encontraron de menos y que no se explica por la imprecisión normal de los cortes a pulso.
        Es material que se usó sin registrar, se dañó o se perdió.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Material</th><th>Conteos</th><th>Faltante</th><th>Sobrante</th><th>Ajuste a pulso</th><th>Valor faltante</th></tr></thead>
          <tbody>
            {data.byMaterial.map((m) => (
              <tr key={m.materialId}>
                <td>{m.label}</td><td>{m.counts}</td>
                <td className={m.missingMm2 > 0 ? 'warn' : ''}>{fmtM2(m.missingMm2)}</td>
                <td>{fmtM2(m.surplusMm2)}</td><td>{fmtM2(m.freehandAdjustMm2)}</td>
                <td>{m.missingValue !== null ? fmtMoney(m.missingValue) : '—'}</td>
              </tr>
            ))}
            {data.byMaterial.length === 0 && <tr><td colSpan={6} className="muted center">No hubo conteos en el rango.</td></tr>}
          </tbody>
        </table>
      </div>
      {data.counts.length > 0 && (
        <>
          <h2>Conteos con diferencia</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Rollo</th><th>Sistema</th><th>Medido</th><th>Sin explicar</th><th>Contó</th></tr></thead>
              <tbody>
                {data.counts.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDate(c.createdAt)}</td>
                    <td><Link to={`/stock/${c.unitId}`}>{c.unitCode}</Link></td>
                    <td>{fmtM2(c.systemAreaMm2)}</td><td>{fmtM2(c.computedAreaMm2)}</td>
                    <td className={c.unexplainedMm2 < 0 ? 'warn' : ''}>{c.unexplainedMm2 > 0 ? '+' : ''}{fmtM2(c.unexplainedMm2)}</td>
                    <td>{c.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ───── Cortes a pulso ─────

interface FreehandData {
  byUser: { userId: number; name: string; cuts: number; freehandCuts: number; freehandCutsPct: number | null; freehandAreaPct: number | null }[];
  sizes: { sizeId: number; name: string; refAreaMm2: number; reconciledCuts: number; realVsEstimatedPct: number | null; suggestedRefAreaMm2: number | null }[];
}

function FreehandTab({ qs }: { qs: string }) {
  const { data, error, reload } = useApi<FreehandData>(`/api/admin/reports/freehand?${qs}`);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;

  async function apply(sizeId: number, refAreaMm2: number) {
    try {
      await api('PATCH', `/api/admin/freehand-sizes/${sizeId}`, { refAreaMm2 });
      setMsg('Talla actualizada. Los cortes ya registrados no cambian.');
      void reload();
    } catch (e) {
      setMsg(errorText(e));
    }
  }

  return (
    <div className="stack">
      <h2>Por persona</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th></th><th>Cortes</th><th>A pulso</th><th>% de cortes a pulso</th><th>% del área a pulso</th></tr></thead>
          <tbody>
            {data.byUser.map((u) => <tr key={u.userId}><td>{u.name}</td><td>{u.cuts}</td><td>{u.freehandCuts}</td><td>{fmtPct(u.freehandCutsPct)}</td><td>{fmtPct(u.freehandAreaPct)}</td></tr>)}
            {data.byUser.length === 0 && <tr><td colSpan={5} className="muted center">Sin cortes en el rango.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Precisión de las tallas</h2>
      <p className="muted small">
        Compara lo estimado con lo que el conteo físico atribuyó a esos cortes. 120 % = gastan en promedio 20 % más de lo
        estimado. Con 5 o más cortes verificados se sugiere un área de referencia nueva.
      </p>
      <ErrorMsg error={msg && msg.startsWith('Talla') ? null : msg} />
      {msg?.startsWith('Talla') && <p className="ok">{msg}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Talla</th><th>Área actual</th><th>Cortes verificados</th><th>Real / estimado</th><th>Sugerida</th><th></th></tr></thead>
          <tbody>
            {data.sizes.map((s) => (
              <tr key={s.sizeId}>
                <td>{s.name}</td><td>{fmtM2(s.refAreaMm2, 3)}</td><td>{s.reconciledCuts}</td>
                <td className={s.realVsEstimatedPct !== null && Math.abs(s.realVsEstimatedPct - 100) > 15 ? 'warn' : ''}>{fmtPct(s.realVsEstimatedPct)}</td>
                <td>{s.suggestedRefAreaMm2 ? fmtM2(s.suggestedRefAreaMm2, 3) : '—'}</td>
                <td className="actions">
                  {s.suggestedRefAreaMm2 && s.suggestedRefAreaMm2 !== s.refAreaMm2 && <button onClick={() => apply(s.sizeId, s.suggestedRefAreaMm2!)}>Usar sugerida</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
