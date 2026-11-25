import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type AdminUser, type Role } from '../../api/client';
import { useAuth } from '../../auth';
import { ErrorMsg, Field, errorText } from '../../components/Field';

const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', EMPLOYEE: 'Empleado', CLIENT: 'Cliente' };

export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [filter, setFilter] = useState<{ role: '' | Role; q: string }>({ role: '', q: '' });
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter.role) params.set('role', filter.role);
    if (filter.q.trim()) params.set('q', filter.q.trim());
    try {
      const r = await api<{ users: AdminUser[] }>('GET', `/api/admin/users?${params}`);
      setUsers(r.users);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [filter]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  function resetPassword(u: AdminUser) {
    const pw = window.prompt(`Nueva contraseña temporal para ${u.fullName} (mín. 10 caracteres):`);
    if (pw) act(() => api('POST', `/api/admin/users/${u.id}/password`, { newPassword: pw }));
  }

  return (
    <div className="stack">
      <div className="row between">
        <h1>Usuarios</h1>
        <button className="primary" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cerrar' : 'Nuevo usuario'}</button>
      </div>

      {showCreate && (
        <CreateUserForm
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      <div className="row">
        <input placeholder="Buscar nombre, correo o celular" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value as '' | Role })}>
          <option value="">Todos</option>
          <option value="CLIENT">Clientes</option>
          <option value="EMPLOYEE">Empleados</option>
          <option value="ADMIN">Admins</option>
        </select>
      </div>
      <ErrorMsg error={error} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Celular</th>
              <th>Rol</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me?.id;
              return (
                <tr key={u.id} className={u.isActive ? '' : 'inactive'}>
                  <td>{u.fullName}{self && <span className="muted"> (tú)</span>}</td>
                  <td>{u.email}</td>
                  <td>{u.phone ?? '—'}</td>
                  <td><span className={`badge ${u.role.toLowerCase()}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td>
                    {!u.isActive ? 'Inactivo' : u.lockedUntil ? <span className="warn">Bloqueado</span> : 'Activo'}
                  </td>
                  <td className="actions">
                    {u.lockedUntil && <button onClick={() => act(() => api('POST', `/api/admin/users/${u.id}/unlock`))}>Desbloquear</button>}
                    <button onClick={() => resetPassword(u)}>Clave</button>
                    {!self && (
                      <button onClick={() => act(() => api('PATCH', `/api/admin/users/${u.id}`, { isActive: !u.isActive }))}>
                        {u.isActive ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                    {!self && (
                      <select
                        aria-label="Cambiar rol"
                        value={u.role}
                        onChange={(e) => {
                          const role = e.target.value as Role;
                          if (window.confirm(`¿Cambiar a ${u.fullName} a ${ROLE_LABEL[role]}? Se cerrará su sesión.`))
                            act(() => api('PATCH', `/api/admin/users/${u.id}`, { role }));
                        }}
                      >
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">Sin resultados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', role: 'CLIENT' as Role });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/api/admin/users', form);
      onCreated();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2>Nuevo usuario</h2>
      <Field label="Nombre completo" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
      <Field label="Correo" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <Field label="Celular" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <Field
        label="Contraseña temporal"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        hint="Entrégasela al usuario y pídele que la cambie en «Mi cuenta»."
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      <label className="field">
        <span>Rol</span>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          <option value="CLIENT">Cliente</option>
          <option value="EMPLOYEE">Empleado (registra cortes, sin ver costos)</option>
          <option value="ADMIN">Administrador</option>
        </select>
      </label>
      <ErrorMsg error={error} />
      <button className="primary">Crear</button>
    </form>
  );
}
