import { useEffect, useState, type FormEvent } from 'react';
import { api, type User } from '../api/client';
import type { CustomerClient, DocumentType } from '../api/orders';
import { DOC_LABEL } from '../api/orders';
import { useAuth } from '../auth';
import { ErrorMsg, Field, errorText } from '../components/Field';
import { useApi } from '../components/useApi';

export function AccountPage() {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState({ fullName: user!.fullName, phone: user!.phone ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState<{ profile?: string; pw?: string }>({});
  const [err, setErr] = useState<{ profile?: string | null; pw?: string | null }>({});

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setErr({ ...err, profile: null });
    try {
      const r = await api<{ user: User }>('PATCH', '/api/account/profile', profile);
      setUser(r.user);
      setMsg({ ...msg, profile: 'Datos guardados.' });
    } catch (e2) {
      setErr({ ...err, profile: errorText(e2) });
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setErr({ ...err, pw: null });
    if (pw.newPassword !== pw.confirm) return setErr({ ...err, pw: 'Las contraseñas no coinciden.' });
    try {
      await api('POST', '/api/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setMsg({ ...msg, pw: 'Contraseña cambiada. Se cerró la sesión en tus otros dispositivos.' });
    } catch (e2) {
      setErr({ ...err, pw: errorText(e2) });
    }
  }

  return (
    <div className="stack">
      <h1>Mi cuenta</h1>
      <form className="card stack" onSubmit={saveProfile}>
        <h2>Datos</h2>
        <p className="muted">{user!.email}</p>
        <Field label="Nombre completo" required value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />
        <Field label="Celular" type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
        <ErrorMsg error={err.profile ?? null} />
        {msg.profile && <p className="ok">{msg.profile}</p>}
        <button className="primary">Guardar</button>
      </form>

      <form className="card stack" onSubmit={changePassword}>
        <h2>Cambiar contraseña</h2>
        <Field label="Contraseña actual" type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        <Field label="Nueva contraseña" type="password" required minLength={10} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        <Field label="Repite la nueva contraseña" type="password" required autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        <ErrorMsg error={err.pw ?? null} />
        {msg.pw && <p className="ok">{msg.pw}</p>}
        <button className="primary">Cambiar contraseña</button>
      </form>

      {user!.role === 'CLIENT' && <BillingForm />}
    </div>
  );
}

/** Datos para facturar (opcionales). Si es NIT, el sistema calcula el dígito de verificación. */
function BillingForm() {
  const { data } = useApi<{ customer: CustomerClient }>('/api/client/profile');
  const [f, setF] = useState<{ documentType: DocumentType | ''; documentNumber: string; billingEmail: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data) setF({ documentType: data.customer.documentType ?? '', documentNumber: data.customer.documentNumber ?? '', billingEmail: data.customer.billingEmail ?? '' });
  }, [data]);
  if (!f) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api<{ customer: CustomerClient }>('PATCH', '/api/client/profile', { ...f!, documentType: f!.documentType || null });
      setF({ documentType: r.customer.documentType ?? '', documentNumber: r.customer.documentNumber ?? '', billingEmail: r.customer.billingEmail ?? '' });
      setError(null);
      setMsg(r.customer.nitCheckDigit !== null ? `Guardado. NIT ${r.customer.documentNumber}-${r.customer.nitCheckDigit}.` : 'Guardado.');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Datos para la factura</h2>
      <p className="muted small">Opcional. Solo si necesitas factura a tu nombre o al de tu empresa.</p>
      <label className="field">
        <span>Tipo de documento</span>
        <select value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value as DocumentType | '' })}>
          <option value="">—</option>
          {Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <Field label="Número" maxLength={20} value={f.documentNumber} onChange={(e) => setF({ ...f, documentNumber: e.target.value })} hint={f.documentType === 'NIT' ? 'Sin el dígito de verificación: lo calculamos.' : undefined} />
      <Field label="Correo para recibir la factura" type="email" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} />
      <ErrorMsg error={error} />
      {msg && <p className="ok">{msg}</p>}
      <button className="primary">Guardar</button>
    </form>
  );
}
