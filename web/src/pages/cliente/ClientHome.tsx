import { Link } from 'react-router-dom';
import { Camera, ClipboardList, Inbox } from 'lucide-react';
import { Empty, PageHeader } from '../../components/ui';
import type { OrderSummaryClient, QuoteRequest } from '../../api/orders';
import { ORDER_STATUS_CLIENT, REQUEST_STATUS_LABEL } from '../../api/orders';
import { useAuth } from '../../auth';
import { ErrorMsg } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { fmtDate, fmtMoney } from '../../units';

export function ClientHome() {
  const { user } = useAuth();
  const orders = useApi<{ orders: OrderSummaryClient[] }>('/api/client/orders');
  const requests = useApi<{ requests: QuoteRequest[] }>('/api/client/quote-requests');
  const pending = requests.data?.requests.filter((r) => r.status === 'NUEVA') ?? [];
  const toAnswer = orders.data?.orders.filter((o) => o.status === 'COTIZADO') ?? [];

  return (
    <div className="stack narrow">
      <PageHeader title={<>Hola, {user!.fullName.split(' ')[0]}</>} sub="Aquí ves tus cotizaciones y el estado de tus trabajos." />
      <Link to="/cliente/solicitar" className="button primary big"><Camera size={18} aria-hidden /> Pedir una cotización</Link>
      <ErrorMsg error={orders.error ?? requests.error} />

      {toAnswer.length > 0 && (
        <div className="card stack attention">
          <strong>Tienes {toAnswer.length === 1 ? 'una cotización' : `${toAnswer.length} cotizaciones`} por responder</strong>
          {toAnswer.map((o) => (
            <Link key={o.id} to={`/cliente/pedidos/${o.id}`}>{o.code} · {o.vehicleDesc} · {fmtMoney(o.total)}</Link>
          ))}
        </div>
      )}

      <section className="stack">
        <h2>Mis trabajos</h2>
        {orders.data?.orders.length === 0 && <Empty icon={ClipboardList} title="Aún no tienes trabajos">Cuando te enviemos una cotización, aparecerá aquí.</Empty>}
        <ul className="list">
          {orders.data?.orders.map((o) => (
            <li key={o.id}>
              <Link to={`/cliente/pedidos/${o.id}`} className="list-row">
                <span><strong>{o.code}</strong> {o.vehicleDesc}</span>
                <span className={`status s-${o.status.toLowerCase()}`}>{ORDER_STATUS_CLIENT[o.status]}</span>
                <span className="right">{fmtMoney(o.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="stack">
        <h2>Mis solicitudes</h2>
        {requests.data?.requests.length === 0 && <Empty icon={Inbox} title="Sin solicitudes">Envíanos fotos de tu moto y te cotizamos.</Empty>}
        {pending.length > 0 && <p className="muted small">El local revisa las solicitudes nuevas y te envía la cotización aquí.</p>}
        <ul className="list">
          {requests.data?.requests.map((r) => (
            <li key={r.id}>
              <Link to={`/cliente/solicitudes/${r.id}`} className="list-row">
                <span>{r.vehicleDesc}</span>
                <span className="muted small">{fmtDate(r.createdAt)}</span>
                <span className="right">{REQUEST_STATUS_LABEL[r.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
