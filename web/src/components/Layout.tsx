import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">Vinilos · Gestión</Link>
        <nav>
          {!user && (
            <>
              <NavLink to="/catalogo">Catálogo</NavLink>
              <NavLink to="/login">Entrar</NavLink>
              <NavLink to="/registro">Crear cuenta</NavLink>
            </>
          )}
          {user?.role === 'ADMIN' && (
            <>
              <NavLink to="/admin" end>Inicio</NavLink>
              <NavLink to="/pedidos">Pedidos</NavLink>
              <NavLink to="/solicitudes">Solicitudes</NavLink>
              <NavLink to="/corte">Cortar</NavLink>
              <NavLink to="/stock">Stock</NavLink>
              <NavLink to="/admin/clientes">Clientes</NavLink>
            </>
          )}
          {user?.role === 'EMPLOYEE' && (
            <>
              <NavLink to="/corte">Cortar</NavLink>
              <NavLink to="/pedidos">Pedidos</NavLink>
              <NavLink to="/solicitudes">Solicitudes</NavLink>
              <NavLink to="/stock">Stock</NavLink>
            </>
          )}
          {user?.role === 'CLIENT' && (
            <>
              <NavLink to="/cliente" end>Mis trabajos</NavLink>
              <NavLink to="/catalogo">Catálogo</NavLink>
            </>
          )}
          {user && (
            <>
              <NavLink to="/cuenta">Mi cuenta</NavLink>
              <button
                className="link"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                Salir
              </button>
            </>
          )}
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
