import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { OrderClientDetail } from '../../api/orders';
import { ORDER_STATUS_CLIENT, PAYMENT_LABEL, TAX_LABEL, UNIT_LABEL, fmtQty } from '../../api/orders';
import { ErrorMsg, errorText } from '../../components/Field';
import { Photos } from '../../components/Photos';
import { useApi } from '../../components/useApi';
import { fmtDate, fmtMoney } from '../../units';

const fmtDay = (ymd: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));

export function ClientOrderPage() {
  const id = Number(useParams().id);
  const { data, error, setData } = useApi<OrderClientDetail>(`/api/client/orders/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorMsg error={error} />;
  if (!data) return <p className="muted center">Cargando…</p>;
  const { order: o, items } = data;

  async function respond(accept: boolean) {
    let reason: string | null = null;
    if (accept) {
      if (!window.confirm(`¿Aceptar la cotización ${o.code} por ${fmtMoney(o.total)}?`)) return;
    } else {
      reason = window.prompt('¿Por qué la rechazas? (opcional, nos ayuda a mejorar)');
      if (reason === null) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      setData(await api<OrderClientDetail>('POST', `/api/client/orders/${id}/${accept ? 'accept' : 'reject'}`, accept ? undefined : { reason }));
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack narrow">
      <Link to="/cliente" className="muted">← Mis trabajos</Link>
      <div className="row between">
        <h1>{o.status === 'COTIZADO' ? 'Cotización' : 'Trabajo'} {o.code}</h1>
        <span className={`status s-${o.status.toLowerCase()}`}>{ORDER_STATUS_CLIENT[o.status]}</span>
      </div>
      {o.vehicleDesc && <p className="muted">{o.vehicleDesc}</p>}
      {o.description && <p className="pre">{o.description}</p>}

      <div className="card stack">
        <table className="lines">
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.description}
                  <div className="muted small">
                    {i.pricingUnit === 'GLOBAL' ? '' : `${fmtQty(i.quantityMilli)} ${UNIT_LABEL[i.pricingUnit]} × ${fmtMoney(i.unitPrice)}`}
                    {i.discount > 0 && ` · descuento ${fmtMoney(i.discount)}`}
                    {i.taxRateBp > 0 && ` · ${TAX_LABEL[i.taxRateBp]}`}
                  </div>
                </td>
                <td className="right">{fmtMoney(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Totals subtotal={o.subtotal} tax={o.taxTotal} total={o.total} />
        {o.status === 'COTIZADO' && o.quoteValidUntil && (
          <p className={`small ${data.expired ? 'warn' : 'muted'}`}>
            {data.expired ? 'Esta cotización venció el' : 'Válida hasta el'} {fmtDay(o.quoteValidUntil)}.
            {data.expired && ' Escríbenos para actualizarla.'}
          </p>
        )}
      </div>

      <ErrorMsg error={actionError} />
      {data.canRespond && !data.expired && (
        <div className="row">
          <button className="primary big grow" disabled={busy} onClick={() => respond(true)}>Aceptar cotización</button>
          <button className="big grow" disabled={busy} onClick={() => respond(false)}>Rechazar</button>
        </div>
      )}

      {(data.payments.length > 0 || o.invoiceNumber) && (
        <div className="card stack">
          <h2>Pagos</h2>
          {data.payments.map((p) => (
            <div key={p.id} className="row between small">
              <span>{fmtDate(p.createdAt)} · {PAYMENT_LABEL[p.method]}</span>
              <span>{fmtMoney(p.amount)}</span>
            </div>
          ))}
          <div className="row between"><strong>Saldo pendiente</strong><strong>{fmtMoney(data.balance)}</strong></div>
          {o.invoiceNumber && <p className="muted small">Factura {o.invoiceNumber}</p>}
        </div>
      )}

      {data.photos.length > 0 && (
        <div className="stack">
          <h2>Fotos</h2>
          <Photos photos={data.photos} />
        </div>
      )}

      <div className="stack">
        <h2>Historial</h2>
        <ul className="timeline">
          {data.history.map((h) => (
            <li key={h.id}>
              <strong>{ORDER_STATUS_CLIENT[h.toStatus]}</strong> <span className="muted small">{fmtDate(h.createdAt)}</span>
              {h.note && <div className="muted small">{h.note}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Totals({ subtotal, tax, total }: { subtotal: number; tax: number; total: number }) {
  return (
    <div className="totals">
      {tax > 0 && (
        <>
          <span>Subtotal</span><span>{fmtMoney(subtotal)}</span>
          <span>IVA</span><span>{fmtMoney(tax)}</span>
        </>
      )}
      <strong>Total</strong><strong>{fmtMoney(total)}</strong>
    </div>
  );
}
