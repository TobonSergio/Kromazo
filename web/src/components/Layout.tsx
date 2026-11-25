import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  ClipboardList,
  Home,
  Inbox,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Scissors,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  UserCircle,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '../api/client';
import { useAuth } from '../auth';
import { ThemeButton } from './ui';
import { useApi } from './useApi';

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  count?: 'requests';
}

const STAFF_OPS: NavEntry[] = [
  { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
  { to: '/solicitudes', label: 'Solicitudes', icon: Inbox, count: 'requests' },
  { to: '/corte', label: 'Registrar corte', icon: Scissors },
  { to: '/stock', label: 'Stock', icon: Layers },
];
const ADMIN_NAV: { group: string; items: NavEntry[] }[] = [
  { group: 'Operación', items: [{ to: '/admin', label: 'Inicio', icon: LayoutDashboard, end: true }, ...STAFF_OPS] },
  {
    group: 'Gestión',
    items: [
      { to: '/admin/clientes', label: 'Clientes', icon: Users },
      { to: '/admin/materiales', label: 'Materiales', icon: Package },
      { to: '/admin/compras', label: 'Compras', icon: ShoppingCart },
      { to: '/admin/catalogo', label: 'Catálogo', icon: Store },
      { to: '/admin/reportes', label: 'Reportes', icon: BarChart3 },
    ],
  },
  {
    group: 'Configuración',
    items: [
      { to: '/admin/usuarios', label: 'Usuarios', icon: UserCog },
      { to: '/admin/ajustes', label: 'Cortes a pulso', icon: SlidersHorizontal },
    ],
  },
];
const EMPLOYEE_NAV = [{ group: 'Taller', items: STAFF_OPS }];

/** Barra inferior en el celular: lo que más se usa, a un toque. */
const BOTTOM: Record<Role, NavEntry[]> = {
  ADMIN: [
    { to: '/admin', label: 'Inicio', icon: LayoutDashboard, end: true },
    { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
    { to: '/corte', label: 'Cortar', icon: Scissors },
    { to: '/stock', label: 'Stock', icon: Layers },
  ],
  EMPLOYEE: [
    { to: '/corte', label: 'Cortar', icon: Scissors },
    { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
    { to: '/solicitudes', label: 'Solicitudes', icon: Inbox, count: 'requests' },
    { to: '/stock', label: 'Stock', icon: Layers },
  ],
  CLIENT: [
    { to: '/cliente', label: 'Mis trabajos', icon: Home, end: true },
    { to: '/cliente/solicitar', label: 'Cotizar', icon: ClipboardList },
    { to: '/catalogo', label: 'Catálogo', icon: Store },
    { to: '/cuenta', label: 'Cuenta', icon: UserCircle },
  ],
};

const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Administrador', EMPLOYEE: 'Empleado', CLIENT: 'Cliente' };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="Vinilos · Gestión, inicio">
      <span className="brand-mark" aria-hidden>
        <Layers size={18} strokeWidth={2.4} />
      </span>
      <span>
        Vinilos
        <small>Gestión del taller</small>
      </span>
    </Link>
  );
}

/** Cantidad de solicitudes nuevas (para el personal). Se refresca cada minuto. */
function useNewRequests(enabled: boolean) {
  const { data, reload } = useApi<{ requests: unknown[] }>(enabled ? '/api/staff/quote-requests?status=NUEVA' : null);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => void reload(), 60_000);
    return () => clearInterval(t);
  }, [enabled, reload]);
  return data?.requests.length ?? 0;
}

export function Layout() {
  const { user } = useAuth();
  const staff = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE';
  return staff ? <StaffShell /> : <PublicShell />;
}

function StaffShell() {
  const { user } = useAuth();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const newRequests = useNewRequests(true);
  useEffect(() => setDrawer(false), [location.pathname]);

  const groups = user!.role === 'ADMIN' ? ADMIN_NAV : EMPLOYEE_NAV;
  const home = user!.role === 'ADMIN' ? '/admin' : '/corte';

  const sideContent = (
    <>
      <Brand to={home} />
      <nav className="side-nav" aria-label="Principal">
        {groups.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((it) => (
              <NavItem key={it.to} entry={it} count={it.count ? newRequests : 0} />
            ))}
          </div>
        ))}
      </nav>
      <UserFooter />
    </>
  );

  return (
    <div className="shell">
      <aside className="sidebar">{sideContent}</aside>

      <header className="mobile-header">
        <button type="button" className="icon-btn" onClick={() => setDrawer(true)} aria-label="Abrir menú">
          <Menu size={22} />
        </button>
        <Brand to={home} />
        <ThemeButton compact />
      </header>

      {drawer && (
        <>
          <div className="drawer-overlay" onClick={() => setDrawer(false)} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Menú">
            <button type="button" className="icon-btn" style={{ alignSelf: 'flex-end' }} onClick={() => setDrawer(false)} aria-label="Cerrar menú">
              <X size={20} />
            </button>
            {sideContent}
          </aside>
        </>
      )}

      <main className="content">
        <Outlet />
      </main>

      <BottomNav role={user!.role} count={newRequests} />
    </div>
  );
}

function PublicShell() {
  const { user } = useAuth();
  const client = user?.role === 'CLIENT';
  return (
    <div className="app">
      <header className={`topbar ${client ? 'has-bottom' : ''}`}>
        <Brand to={client ? '/cliente' : '/catalogo'} />
        <nav aria-label="Principal">
          {client ? (
            <>
              <NavLink to="/cliente" end>Mis trabajos</NavLink>
              <NavLink to="/catalogo">Catálogo</NavLink>
              <NavLink to="/cuenta">Mi cuenta</NavLink>
              <NavLink to="/cliente/solicitar" className="cta keep">Pedir cotización</NavLink>
              <LogoutLink />
            </>
          ) : (
            <>
              <NavLink to="/catalogo">Catálogo</NavLink>
              <NavLink to="/login" className="keep">
                Entrar
              </NavLink>
              <NavLink to="/registro" className="cta keep">Crear cuenta</NavLink>
            </>
          )}
          <ThemeButton compact />
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
      {client && <BottomNav role="CLIENT" count={0} />}
    </div>
  );
}

function NavItem({ entry, count }: { entry: NavEntry; count: number }) {
  const Icon = entry.icon;
  return (
    <NavLink to={entry.to} end={entry.end} className="nav-item">
      <Icon size={18} aria-hidden />
      {entry.label}
      {count > 0 && <span className="nav-count" aria-label={`${count} nuevas`}>{count}</span>}
    </NavLink>
  );
}

function BottomNav({ role, count }: { role: Role; count: number }) {
  return (
    <nav className="bottom-nav" aria-label="Accesos rápidos">
      {BOTTOM[role].map((it) => {
        const Icon = it.icon;
        return (
          <NavLink key={it.to} to={it.to} end={it.end}>
            <span className="bn-icon"><Icon size={20} aria-hidden /></span>
            {it.label}
            {it.count && count > 0 && <span className="nav-count">{count}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

function UserFooter() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="side-footer">
      <ThemeButton />
      <NavLink to="/cuenta" className="nav-item">
        <UserCircle size={18} aria-hidden /> Mi cuenta
      </NavLink>
      <button
        type="button"
        className="nav-item ghost"
        style={{ justifyContent: 'flex-start', border: 0, minHeight: 0 }}
        onClick={async () => {
          await logout();
          navigate('/login');
        }}
      >
        <LogOut size={18} aria-hidden /> Salir
      </button>
      <div className="user-card">
        <span className="avatar" aria-hidden>{initials(user!.fullName)}</span>
        <span className="who">
          <strong>{user!.fullName}</strong>
          <small>{ROLE_LABEL[user!.role]}</small>
        </span>
      </div>
    </div>
  );
}

function LogoutLink() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Salir"
      title="Salir"
      onClick={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <LogOut size={18} />
    </button>
  );
}

