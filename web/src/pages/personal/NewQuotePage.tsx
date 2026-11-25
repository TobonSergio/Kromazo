import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { CustomerAdmin, OrderAdminDetail, QuoteRequestStaff } from '../../api/orders';
import { ErrorMsg } from '../../components/Field';
import { Photos } from '../../components/Photos';
import { QuoteEditor } from '../../components/QuoteEditor';
import { useApi } from '../../components/useApi';

/** Nueva cotización: desde una solicitud web (?solicitud=ID) o para un cliente del local (?cliente=ID). */
export function NewQuotePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requestId = Number(params.get('solicitud')) || null;
  const [customerId, setCustomerId] = useState<number | null>(Number(params.get('cliente')) || null);
  const request = useApi<{ request: QuoteRequestStaff }>(requestId ? `/api/staff/quote-requests/${requestId}` : null);
  const customers = useApi<{ customers: CustomerAdmin[] }>(requestId ? null : '/api/admin/customers');
  const [q, setQ] = useState('');

  const customer = customers.data?.customers.find((c) => c.id === customerId);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (customers.data?.customers ?? []).filter((c) => !t || `${c.fullName} ${c.phone ?? ''} ${c.documentNumber ?? ''}`.toLowerCase().includes(t)).slice(0, 30);
  }, [customers.data, q]);

  if (request.error) return <ErrorMsg error={request.error} />;
  const r = request.data?.request;
  if (requestId && !r) return <p className="muted center">Cargando…</p>;

  const save = async (body: Record<string, unknown>) => {
    const res = await api<OrderAdminDetail>('POST', '/api/admin/orders', requestId ? { ...body, quoteRequestId: requestId } : { ...body, customerId });
    navigate(`/pedidos/${res.order.id}`, { replace: true });
  };

  return (
    <div className="stack narrow-wide">
      <Link to={requestId ? `/solicitudes/${requestId}` : '/pedidos'} className="muted">← Volver</Link>
      <h1>Nueva cotización</h1>

      {r && (
        <div className="card stack">
          <strong>{r.customer.fullName}</strong>
          <p className="pre small">{r.description}</p>
          <Photos photos={r.photos} />
        </div>
      )}

      {!requestId && !customer && (
        <div className="card stack">
          <div className="row between">
            <strong>¿Para qué cliente?</strong>
            <Link to="/admin/clientes?nuevo=1" className="small">+ Cliente nuevo</Link>
          </div>
          <input autoFocus placeholder="Buscar nombre, celular o documento" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pick-list">
            {filtered.map((c) => (
              <button key={c.id} type="button" className="pick" onClick={() => setCustomerId(c.id)}>
                <strong>{c.fullName}</strong> <small className="muted">{c.phone ?? ''} {c.hasAccount ? '· con cuenta' : ''}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {customer && (
        <div className="card row between">
          <strong>{customer.fullName}</strong>
          <button type="button" onClick={() => setCustomerId(null)}>Cambiar</button>
        </div>
      )}

      {(r || customer) && (
        <QuoteEditor
          initialHeader={{ vehicleDesc: r?.vehicleDesc ?? '', description: r?.description ?? '', internalNotes: '', quoteValidUntil: '' }}
          submitLabel="Crear cotización"
          onSubmit={save}
        />
      )}
    </div>
  );
}
