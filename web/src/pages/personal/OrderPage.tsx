import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiUpload } from '../../api/client';
import type { HistoryEntry, OrderAdminDetail, OrderCut, OrderStaffDetail, OrderStatus, PaymentMethod } from '../../api/orders';
import { DOC_LABEL, NEXT_STATUS, ORDER_STATUS_LABEL, PAYMENT_LABEL, TAX_LABEL, UNIT_LABEL, fmtQty } from '../../api/orders';
import { useAuth } from '../../auth';
import { ErrorMsg, NumField, errorText } from '../../components/Field';
import { PhotoPicker, Photos } from '../../components/Photos';
import { QuoteEditor } from '../../components/QuoteEditor';
import { useApi } from '../../components/useApi';
import { fmtDate, fmtM2, fmtMoney, parseDecimal } from '../../units';
import { Totals } from '../cliente/ClientOrderPage';

export function OrderPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  // El admin usa la vista completa (precios, pagos, costos); el empleado, la vista sin dinero.
  const admin = useApi<OrderAdminDetail>(isAdmin ? `/api/admin/orders/${id}` : null);
  const staff = useApi<OrderStaffDetail>(isAdmin ? null : `/api/staff/orders/${id}`);
  const data = isAdmin ? admin.data : staff.data;
  const error = admin.error ?? staff.error;
  const reload = () => void (isAdmin ? admin.reload() : staff.reload());
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <ErrorMsg error={error} />;
  if (!data) return <p className="muted center">Cargando…</p>;
  const o = data.order;
  const customer = data.customer;

  async function move(to: OrderStatus, danger?: boolean) {
    let note: string | null = null;
    if (danger) {
      note = window.prompt('Motivo de la cancelación:');
      if (!note) return;
    }
    setActionError(null);
    try {
      await api('POST', `/api/staff/orders/${id}/status`, { to, note });
      reload();
    } catch (e) {
      setActionError(errorText(e));
    }
  }

  const actions = NEXT_STATUS[o.status].filter((a) => isAdmin || !a.adminOnly);

  return (
    <div className="stack">
      <Link to="/pedidos" className="muted">← Pedidos</Link>
      <div className="row between">
        <h1>{o.code} <span className={`status s-${o.status.toLowerCase()}`}>{ORDER_STATUS_LABEL[o.status]}</span></h1>
        {(o.status === 'APROBADO' || o.status === 'EN_PROCESO') && (
          <Link className="button" to={`/corte?pedido=${o.id}`}>Registrar corte para este trabajo</Link>
        )}
      </div>

      <div className="card stack">
        <div className="row between">
          <div>
            <strong>{customer.fullName}</strong>
            {customer.phone && <div className="small"><a href={`tel:${customer.phone}`}>{customer.phone}</a></div>}
            {isAdmin && admin.data!.customer.documentNumber && (
              <div className="muted small">
                {DOC_LABEL[admin.data!.customer.documentType!]} {admin.data!.customer.documentNumber}
                {admin.data!.customer.nitCheckDigit !== null && `-${admin.data!.customer.nitCheckDigit}`}
              </div>
            )}
          </div>
          {o.quoteRequestId && <Link className="small" to={`/solicitudes/${o.quoteRequestId}`}>Ver solicitud</Link>}
        </div>
        {o.vehicleDesc && <p><strong>Moto:</strong> {o.vehicleDesc}</p>}
        {o.description && <p className="pre">{o.description}</p>}
        {o.internalNotes && <p className="pre note">🔒 {o.internalNotes}</p>}
      </div>

      {actions.length > 0 && (
        <div className="row">
          {actions.map((a) => (
            <button key={a.to} className={a.danger ? '' : 'primary'} onClick={() => move(a.to, a.danger)}>{a.label}</button>
          ))}
        </div>
      )}
      <ErrorMsg error={actionError} />

      {isAdmin && editing ? (
        <section className="stack">
          <div className="row between"><h2>Editar cotización</h2><button onClick={() => setEditing(false)}>Cancelar</button></div>
          <QuoteEditor
            initialHeader={{
              vehicleDesc: o.vehicleDesc ?? '',
              description: o.description ?? '',
              internalNotes: o.internalNotes ?? '',
              quoteValidUntil: admin.data!.order.quoteValidUntil ?? '',
            }}
            initialItems={admin.data!.items}
            submitLabel="Guardar cotización"
            onSubmit={async (body) => {
              admin.setData(await api<OrderAdminDetail>('PUT', `/api/admin/orders/${id}/quote`, body));
              setEditing(false);
            }}
          />
        </section>
      ) : isAdmin ? (
        <AdminItems d={admin.data!} onEdit={() => setEditing(true)} />
      ) : (
        <section className="stack">
          <h2>Qué hay que hacer</h2>
          <ul className="card list">
            {staff.data!.items.map((i) => (
              <li key={i.id}>{i.description} {i.pricingUnit !== 'GLOBAL' && <span className="muted">· {fmtQty(i.quantityMilli)} {UNIT_LABEL[i.pricingUnit]}</span>}</li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && <Money d={admin.data!} onChange={admin.setData} />}

      <CutsSection cuts={data.cuts} admin={isAdmin ? admin.data! : null} />

      <section className="stack">
        <h2>Fotos</h2>
        <Photos photos={data.photos} />
        {o.status !== 'CANCELADO' && <AddPhotos orderId={id} onDone={reload} />}
      </section>

      <History history={data.history} />
    </div>
  );
}

function AdminItems({ d, onEdit }: { d: OrderAdminDetail; onEdit: () => void }) {
  const o = d.order;
  return (
    <section className="stack">
      <div className="row between">
        <h2>Cotización</h2>
        {o.status === 'COTIZADO' && <button onClick={onEdit}>Editar</button>}
      </div>
      <div className="card stack">
        <table className="lines">
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.description}
                  <div className="muted small">
                    {fmtQty(i.quantityMilli)} {UNIT_LABEL[i.pricingUnit]} × {fmtMoney(i.unitPrice)}
                    {i.discount > 0 && ` · desc. ${fmtMoney(i.discount)}`} · {TAX_LABEL[i.taxRateBp]}
                  </div>
                </td>
                <td className="right">{fmtMoney(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Totals subtotal={o.subtotal} tax={o.taxTotal} total={o.total} />
        {o.status === 'COTIZADO' && o.quoteValidUntil && <p className="muted small">Válida hasta {o.quoteValidUntil}. El cliente la acepta desde su cuenta.</p>}
      </div>
    </section>
  );
}

function Money({ d, onChange }: { d: OrderAdminDetail; onChange: (d: OrderAdminDetail) => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('EFECTIVO');
  const [invoice, setInvoice] = useState(d.order.invoiceNumber ?? '');
  const [error, setError] = useState<string | null>(null);

  async function pay(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      onChange(await api<OrderAdminDetail>('POST', `/api/admin/orders/${d.order.id}/payments`, { amount: Math.round(parseDecimal(amount)), method }));
      setAmount('');
    } catch (err) {
      setError(errorText(err));
    }
  }
  async function saveInvoice() {
    setError(null);
    try {
      onChange(await api<OrderAdminDetail>('PATCH', `/api/admin/orders/${d.order.id}`, { invoiceNumber: invoice }));
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="stack">
      <h2>Pagos y factura</h2>
      <div className="card stack">
        {d.payments.map((p) => (
          <div key={p.id} className="row between small">
            <span>{fmtDate(p.createdAt)} · {PAYMENT_LABEL[p.method]} · {p.userName}{p.note ? ` · ${p.note}` : ''}</span>
            <span>{fmtMoney(p.amount)}</span>
          </div>
        ))}
        <div className="row between"><strong>Pagado</strong><strong>{fmtMoney(d.paid)}</strong></div>
        <div className="row between"><strong>Saldo</strong><strong className={d.balance > 0 ? 'warn' : 'ok'}>{fmtMoney(d.balance)}</strong></div>
        {d.order.status !== 'CANCELADO' && d.balance > 0 && (
          <form className="row" onSubmit={pay}>
            <NumField label="Abono ($)" value={amount} onChange={setAmount} required />
            <label className="field">
              <span>Medio</span>
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <button className="primary">Registrar pago</button>
            <button type="button" onClick={() => setAmount(String(d.balance))}>Todo el saldo</button>
          </form>
        )}
        <div className="row">
          <label className="field grow">
            <span>Número de factura</span>
            <input maxLength={40} value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Se llena a mano hasta la Fase 5" />
          </label>
          <button type="button" onClick={saveInvoice} disabled={invoice === (d.order.invoiceNumber ?? '')}>Guardar</button>
        </div>
        <ErrorMsg error={error} />
      </div>
    </section>
  );
}

function CutsSection({ cuts, admin }: { cuts: OrderCut[]; admin: OrderAdminDetail | null }) {
  if (cuts.length === 0 && !admin) return null;
  return (
    <section className="stack">
      <h2>Material usado</h2>
      {cuts.length === 0 ? (
        <p className="muted small">Aún no se han registrado cortes para este trabajo.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Rollo</th><th>Material</th><th>Consumo</th><th>Quién</th></tr></thead>
            <tbody>
              {cuts.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDate(c.createdAt)}</td>
                  <td>{c.unitCode}</td>
                  <td>{c.materialLabel}</td>
                  <td>{fmtM2(c.consumedAreaMm2)}{c.estimated && <small className="muted"> (estimado)</small>}</td>
                  <td>{c.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {admin && admin.cuts.length > 0 && (
        <div className="card row between">
          <span>Costo de material {admin.materialCostEstimated ? '(aprox.)' : ''}: <strong>{fmtMoney(admin.materialCost)}</strong></span>
          <span>Margen sobre el subtotal: <strong className={admin.margin < 0 ? 'error' : 'ok'}>{fmtMoney(admin.margin)}</strong></span>
        </div>
      )}
    </section>
  );
}

function AddPhotos({ orderId, onDone }: { orderId: number; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    const form = new FormData();
    for (const f of files) form.append('photos', f, f.name);
    setBusy(true);
    try {
      await apiUpload(`/api/staff/orders/${orderId}/photos`, form);
      setFiles([]);
      setError(null);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Agregar fotos del trabajo (antes / después)</summary>
      <div className="stack">
        <PhotoPicker files={files} onChange={setFiles} />
        <ErrorMsg error={error} />
        {files.length > 0 && <button className="primary" disabled={busy} onClick={upload}>{busy ? 'Subiendo…' : 'Subir fotos'}</button>}
      </div>
    </details>
  );
}

function History({ history }: { history: HistoryEntry[] }) {
  return (
    <section className="stack">
      <h2>Historial</h2>
      <ul className="timeline">
        {history.map((h) => (
          <li key={h.id}>
            <strong>{ORDER_STATUS_LABEL[h.toStatus]}</strong>{' '}
            <span className="muted small">{fmtDate(h.createdAt)}{h.userName ? ` · ${h.userName}` : ''}</span>
            {h.note && <div className="muted small">{h.note}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
