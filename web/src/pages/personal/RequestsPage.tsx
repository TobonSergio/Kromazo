import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { QuoteRequestStaff, RequestStatus } from '../../api/orders';
import { ORDER_STATUS_LABEL, REQUEST_STATUS_LABEL } from '../../api/orders';
import { useAuth } from '../../auth';
import { ErrorMsg, errorText } from '../../components/Field';
import { Photos } from '../../components/Photos';
import { useApi } from '../../components/useApi';
import { fmtDate } from '../../units';

export function RequestsPage() {
  const [status, setStatus] = useState<RequestStatus | ''>('NUEVA');
  const { data, error } = useApi<{ requests: QuoteRequestStaff[] }>(`/api/staff/quote-requests${status ? `?status=${status}` : ''}`);

  return (
    <div className="stack">
      <h1>Solicitudes de cotización</h1>
      <div className="tabs">
        {(['NUEVA', 'COTIZADA', 'DESCARTADA', ''] as const).map((s) => (
          <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
            {s ? REQUEST_STATUS_LABEL[s] + 's' : 'Todas'}
          </button>
        ))}
      </div>
      <ErrorMsg error={error} />
      <div className="grid">
        {data?.requests.map((r) => (
          <Link key={r.id} to={`/solicitudes/${r.id}`} className="card stack tile">
            {r.photos[0] && <img className="thumb" src={r.photos[0].url} alt="" loading="lazy" />}
            <strong>{r.vehicleDesc}</strong>
            <span className="muted small">{r.customer.fullName} · {fmtDate(r.createdAt)}</span>
            <span className="small clamp">{r.description}</span>
            {r.order && <span className="small">→ {r.order.code} ({ORDER_STATUS_LABEL[r.order.status]})</span>}
          </Link>
        ))}
      </div>
      {data?.requests.length === 0 && <p className="muted center">No hay solicitudes.</p>}
    </div>
  );
}

export function RequestPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, error, setData } = useApi<{ request: QuoteRequestStaff }>(`/api/staff/quote-requests/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <ErrorMsg error={error} />;
  if (!data) return <p className="muted center">Cargando…</p>;
  const r = data.request;
  const isAdmin = user?.role === 'ADMIN';

  async function discard() {
    const reason = window.prompt('Motivo (el cliente lo verá):');
    if (!reason) return;
    try {
      setData(await api<{ request: QuoteRequestStaff }>('POST', `/api/admin/quote-requests/${id}/discard`, { reason }));
    } catch (e) {
      setActionError(errorText(e));
    }
  }

  return (
    <div className="stack">
      <Link to="/solicitudes" className="muted">← Solicitudes</Link>
      <div className="row between">
        <h1>{r.vehicleDesc}</h1>
        <span className="badge">{REQUEST_STATUS_LABEL[r.status]}</span>
      </div>
      <div className="card stack">
        <div className="row between">
          <div>
            <strong>{r.customer.fullName}</strong>
            <div className="muted small">
              {r.customer.phone && <a href={`tel:${r.customer.phone}`}>{r.customer.phone}</a>}
              {r.customer.phone && r.customer.email && ' · '}
              {r.customer.email}
            </div>
          </div>
          {r.customer.phone && (
            <a className="button" href={`https://wa.me/57${r.customer.phone.replace(/\D/g, '').replace(/^57/, '')}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          )}
        </div>
        <p className="muted small">Enviada el {fmtDate(r.createdAt)}</p>
        <p className="pre">{r.description}</p>
      </div>
      <Photos photos={r.photos} />
      {r.status === 'DESCARTADA' && <p className="warn">Descartada: {r.discardReason}</p>}
      {r.order && <Link to={`/pedidos/${r.order.id}`} className="card">Cotización {r.order.code} · {ORDER_STATUS_LABEL[r.order.status]} →</Link>}
      <ErrorMsg error={actionError} />
      {isAdmin && r.status === 'NUEVA' && (
        <div className="row">
          <button className="primary" onClick={() => navigate(`/pedidos/nuevo?solicitud=${r.id}`)}>Cotizar</button>
          <button onClick={discard}>Descartar</button>
        </div>
      )}
    </div>
  );
}
