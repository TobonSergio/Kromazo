import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { QuoteRequest } from '../../api/orders';
import { ORDER_STATUS_CLIENT, REQUEST_STATUS_LABEL } from '../../api/orders';
import { ErrorMsg, errorText } from '../../components/Field';
import { Photos } from '../../components/Photos';
import { useApi } from '../../components/useApi';
import { fmtDate } from '../../units';
import { useState } from 'react';

export function ClientRequestPage() {
  const id = Number(useParams().id);
  const { data, error, setData } = useApi<{ request: QuoteRequest }>(`/api/client/quote-requests/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <ErrorMsg error={error} />;
  if (!data) return <p className="muted center">Cargando…</p>;
  const r = data.request;

  async function withdraw() {
    if (!window.confirm('¿Retirar esta solicitud?')) return;
    try {
      setData(await api<{ request: QuoteRequest }>('POST', `/api/client/quote-requests/${id}/withdraw`));
    } catch (e) {
      setActionError(errorText(e));
    }
  }

  return (
    <div className="stack narrow">
      <Link to="/cliente" className="muted">← Mis trabajos</Link>
      <h1>{r.vehicleDesc}</h1>
      <p className="muted small">Enviada el {fmtDate(r.createdAt)} · {REQUEST_STATUS_LABEL[r.status]}</p>

      {r.status === 'NUEVA' && <p className="card">El local está revisando tu solicitud. Te avisaremos aquí con la cotización.</p>}
      {r.order && (
        <Link to={`/cliente/pedidos/${r.order.id}`} className="card attention">
          Ya tienes cotización: <strong>{r.order.code}</strong> · {ORDER_STATUS_CLIENT[r.order.status]} →
        </Link>
      )}
      {r.status === 'DESCARTADA' && r.discardReason && <p className="card warn">{r.discardReason}</p>}

      <div className="card stack">
        <p className="pre">{r.description}</p>
        <Photos photos={r.photos} />
      </div>
      <ErrorMsg error={actionError} />
      {r.status === 'NUEVA' && <button onClick={withdraw}>Retirar solicitud</button>}
    </div>
  );
}
