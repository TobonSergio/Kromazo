import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorMsg, Field, errorText } from '../components/Field';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
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
          <h1>Bienvenido de nuevo</h1>
          <p className="muted">Entra para ver tus cotizaciones, trabajos y el taller.</p>
        </div>
        <Field label="Correo" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorMsg error={error} />
        <button className="primary big" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="muted center">
          ¿No tienes cuenta? <Link to="/registro">Regístrate gratis</Link>
          <br />
          <Link to="/catalogo">Ver el catálogo sin entrar</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
