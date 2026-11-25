import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { OrderStatus, OrderSummaryAdmin, OrderSummaryStaff } from '../../api/orders';
import { ORDER_STATUS_LABEL } from '../../api/orders';
import { useAuth } from '../../auth';
import { ErrorMsg } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { fmtDate, fmtMoney } from '../../units';

const TABS: { label: string; status: OrderStatus[] | null }[] = [
  { label: 'En el taller', status: ['APROBADO', 'EN_PROCESO', 'TERMINADO'] },
  { label: 'Cotizaciones', status: ['COTIZADO'] },
  { label: 'Entregados', status: ['ENTREGADO'] },
  { label: 'Cancelados', status: ['CANCELADO'] },
  { label: 'Todos', status: null },
];

export function OrdersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const customerId = useSearchParams()[0].get('cliente');
  const [tab, setTab] = useState(customerId ? TABS.length - 1 : 0);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  const st = TABS[tab]!.status;
  if (st) params.set('status', st.join(','));
  if (debounced) params.set('q', debounced);
  if (customerId && isAdmin) params.set('customerId', customerId);
  const { data, error } = useApi<{ orders: (OrderSummaryStaff & Partial<OrderSummaryAdmin>)[] }>(
    `/api/${isAdmin ? 'admin' : 'staff'}/orders?${params}`,
  );

  return (
    <div className="stack">
      <div className="row between">
        <h1>Pedidos</h1>
        {isAdmin && <Link to="/pedidos/nuevo" className="button primary">Nueva cotización</Link>}
      </div>
      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t.label} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{t.label}</button>
        ))}
      </div>
      <input placeholder="Buscar código, cliente, celular o moto" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorMsg error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th><th>Cliente</th><th>Moto</th><th>Estado</th><th>Actualizado</th>
              {isAdmin && <><th>Total</th><th>Saldo</th></>}
            </tr>
          </thead>
          <tbody>
            {data?.orders.map((o) => (
              <tr key={o.id}>
                <td><Link to={`/pedidos/${o.id}`}><strong>{o.code}</strong></Link></td>
                <td>{o.customerName}</td>
                <td>{o.vehicleDesc ?? '—'}</td>
                <td><span className={`status s-${o.status.toLowerCase()}`}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                <td>{fmtDate(o.updatedAt)}</td>
                {isAdmin && (
                  <>
                    <td>{fmtMoney(o.total ?? 0)}</td>
                    <td className={(o.total ?? 0) - (o.paid ?? 0) > 0 && o.status !== 'CANCELADO' ? 'warn' : ''}>{fmtMoney((o.total ?? 0) - (o.paid ?? 0))}</td>
                  </>
                )}
              </tr>
            ))}
            {data?.orders.length === 0 && <tr><td colSpan={isAdmin ? 7 : 5} className="muted center">Sin pedidos.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
