import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { CustomerAdmin, DocumentType } from '../../api/orders';
import { DOC_LABEL } from '../../api/orders';
import { ErrorMsg, errorText } from '../../components/Field';
import { useApi } from '../../components/useApi';

export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useApi<{ customers: CustomerAdmin[] }>(`/api/admin/customers${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`);
  const [editing, setEditing] = useState<CustomerAdmin | 'new' | null>(params.get('nuevo') ? 'new' : null);
  const [created, setCreated] = useState<CustomerAdmin | null>(null);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Clientes</h1>
        <button className="primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>Nuevo cliente</button>
      </div>
      <p className="muted small">
        Los clientes que se registran en la web aparecen solos. Aquí también puedes crear clientes que llegan al local sin cuenta.
      </p>
      {editing && (
        <CustomerForm
          customer={editing === 'new' ? null : editing}
          onDone={(c) => {
            setEditing(null);
            setParams({}, { replace: true });
            if (c && editing === 'new') setCreated(c);
            void list.reload();
          }}
        />
      )}
      {created && (
        <p className="ok card">
          Cliente {created.fullName} creado. <Link to={`/pedidos/nuevo?cliente=${created.id}`}>Hacerle una cotización →</Link>
        </p>
      )}
      <input placeholder="Buscar nombre, celular, correo o documento" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorMsg error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Celular</th><th>Documento</th><th>Cuenta</th><th>Pedidos</th><th></th></tr></thead>
          <tbody>
            {list.data?.customers.map((c) => (
              <tr key={c.id}>
                <td>{c.fullName}{c.notes && <span className="muted" title={c.notes}> 🔒</span>}</td>
                <td>{c.phone ?? '—'}</td>
                <td>{c.documentNumber ? `${c.documentType} ${c.documentNumber}${c.nitCheckDigit !== null ? `-${c.nitCheckDigit}` : ''}` : '—'}</td>
                <td>{c.hasAccount ? 'Sí' : '—'}</td>
                <td>{c.orderCount ? <Link to={`/pedidos?cliente=${c.id}`}>{c.orderCount}</Link> : 0}</td>
                <td className="actions">
                  <Link className="button" to={`/pedidos/nuevo?cliente=${c.id}`}>Cotizar</Link>
                  <button onClick={() => setEditing(c)}>Editar</button>
                </td>
              </tr>
            ))}
            {list.data?.customers.length === 0 && <tr><td colSpan={6} className="muted center">Sin resultados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerForm({ customer, onDone }: { customer: CustomerAdmin | null; onDone: (c: CustomerAdmin | null) => void }) {
  const linked = !!customer?.hasAccount;
  const [f, setF] = useState({
    fullName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    documentType: (customer?.documentType ?? '') as DocumentType | '',
    documentNumber: customer?.documentNumber ?? '',
    billingEmail: customer?.billingEmail ?? '',
    notes: customer?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const billing = { documentType: f.documentType || null, documentNumber: f.documentNumber, billingEmail: f.billingEmail, notes: f.notes };
    const body = linked ? billing : { ...billing, fullName: f.fullName, phone: f.phone, email: f.email };
    try {
      const r = customer
        ? await api<{ customer: CustomerAdmin }>('PATCH', `/api/admin/customers/${customer.id}`, body)
        : await api<{ customer: CustomerAdmin }>('POST', '/api/admin/customers', body);
      onDone(r.customer);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row between">
        <h2>{customer ? `Editar ${customer.fullName}` : 'Nuevo cliente'}</h2>
        <button type="button" onClick={() => onDone(null)}>Cancelar</button>
      </div>
      {linked && <p className="muted small">Tiene cuenta: su nombre, celular y correo los cambia él desde «Mi cuenta».</p>}
      <div className="form-grid">
        <label className="field"><span>Nombre</span><input required disabled={linked} minLength={2} maxLength={120} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></label>
        <label className="field"><span>Celular</span><input type="tel" disabled={linked} maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field"><span>Correo</span><input type="email" disabled={linked} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field">
          <span>Tipo de documento</span>
          <select value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value as DocumentType | '' })}>
            <option value="">—</option>
            {Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field"><span>Número</span><input maxLength={20} value={f.documentNumber} onChange={(e) => setF({ ...f, documentNumber: e.target.value })} placeholder={f.documentType === 'NIT' ? 'Sin dígito de verificación' : ''} /></label>
        <label className="field"><span>Correo para factura</span><input type="email" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} /></label>
      </div>
      <label className="field">
        <span>Notas internas (el cliente no las ve)</span>
        <textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <ErrorMsg error={error} />
      <button className="primary">Guardar</button>
    </form>
  );
}
