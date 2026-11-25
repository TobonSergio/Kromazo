import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorMsg, Field, errorText } from '../components/Field';

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    setError(null);
    try {
      await register({ fullName: form.fullName, email: form.email, phone: form.phone, password: form.password });
      navigate('/');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="stack" style={{ gap: 6 }}>
          <h1>Crea tu cuenta</h1>
          <p className="muted">Pide cotizaciones con fotos y sigue tus trabajos desde el celular.</p>
        </div>
        <Field label="Nombre completo" required autoComplete="name" value={form.fullName} onChange={set('fullName')} />
        <Field label="Correo" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
        <Field label="Celular (opcional)" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
        <Field
          label="Contraseña"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          hint="Mínimo 10 caracteres. Una frase corta es fácil de recordar y segura."
          value={form.password}
          onChange={set('password')}
        />
        <Field label="Repite la contraseña" type="password" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        <ErrorMsg error={error} />
        <button className="primary big" disabled={busy}>{busy ? 'Creando…' : 'Crear cuenta'}</button>
        <p className="muted center">
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
