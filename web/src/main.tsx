import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import type { Role } from './api/client';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AccountPage } from './pages/AccountPage';
import { ClientHome } from './pages/cliente/ClientHome';
import { AdminHome } from './pages/admin/AdminHome';
import { UsersPage } from './pages/admin/UsersPage';
import { MaterialsPage } from './pages/admin/MaterialsPage';
import { InventorySettingsPage } from './pages/admin/InventorySettingsPage';
import { CutPage } from './pages/personal/CutPage';
import { StockPage } from './pages/personal/StockPage';
import { UnitPage } from './pages/personal/UnitPage';
import { CatalogPage } from './pages/publico/CatalogPage';
import { RequestQuotePage } from './pages/cliente/RequestQuotePage';
import { ClientRequestPage } from './pages/cliente/ClientRequestPage';
import { ClientOrderPage } from './pages/cliente/ClientOrderPage';
import { OrdersPage } from './pages/personal/OrdersPage';
import { OrderPage } from './pages/personal/OrderPage';
import { NewQuotePage } from './pages/personal/NewQuotePage';
import { RequestPage, RequestsPage } from './pages/personal/RequestsPage';
import { CustomersPage } from './pages/admin/CustomersPage';
import { CatalogAdminPage } from './pages/admin/CatalogAdminPage';
import { PurchasesPage } from './pages/admin/PurchasesPage';
import { ReportsPage } from './pages/admin/ReportsPage';
import './styles.css';

const STAFF: Role[] = ['ADMIN', 'EMPLOYEE'];

/** Solo mejora la experiencia: la seguridad real la aplica el servidor en cada ruta. */
function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">Cargando…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const HOME: Record<Role, string> = { ADMIN: '/admin', EMPLOYEE: '/corte', CLIENT: '/cliente' };

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">Cargando…</p>;
  if (!user) return <Navigate to="/catalogo" replace />;
  return <Navigate to={HOME[user.role]} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/registro" element={<RegisterPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/catalogo" element={<CatalogPage />} />
            <Route path="/cliente/solicitar" element={<RequireRole roles={['CLIENT']}><RequestQuotePage /></RequireRole>} />
            <Route path="/cliente/solicitudes/:id" element={<RequireRole roles={['CLIENT']}><ClientRequestPage /></RequireRole>} />
            <Route path="/cliente/pedidos/:id" element={<RequireRole roles={['CLIENT']}><ClientOrderPage /></RequireRole>} />
            <Route path="/pedidos" element={<RequireRole roles={STAFF}><OrdersPage /></RequireRole>} />
            <Route path="/pedidos/nuevo" element={<RequireRole roles={['ADMIN']}><NewQuotePage /></RequireRole>} />
            <Route path="/pedidos/:id" element={<RequireRole roles={STAFF}><OrderPage /></RequireRole>} />
            <Route path="/solicitudes" element={<RequireRole roles={STAFF}><RequestsPage /></RequireRole>} />
            <Route path="/solicitudes/:id" element={<RequireRole roles={STAFF}><RequestPage /></RequireRole>} />
            <Route path="/admin/clientes" element={<RequireRole roles={['ADMIN']}><CustomersPage /></RequireRole>} />
            <Route path="/admin/catalogo" element={<RequireRole roles={['ADMIN']}><CatalogAdminPage /></RequireRole>} />
            <Route path="/admin/compras" element={<RequireRole roles={['ADMIN']}><PurchasesPage /></RequireRole>} />
            <Route path="/admin/reportes" element={<RequireRole roles={['ADMIN']}><ReportsPage /></RequireRole>} />
            <Route path="/cuenta" element={<RequireRole><AccountPage /></RequireRole>} />
            <Route path="/cliente" element={<RequireRole roles={['CLIENT']}><ClientHome /></RequireRole>} />
            <Route path="/corte" element={<RequireRole roles={STAFF}><CutPage /></RequireRole>} />
            <Route path="/stock" element={<RequireRole roles={STAFF}><StockPage /></RequireRole>} />
            <Route path="/stock/:id" element={<RequireRole roles={STAFF}><UnitPage /></RequireRole>} />
            <Route path="/admin" element={<RequireRole roles={['ADMIN']}><AdminHome /></RequireRole>} />
            <Route path="/admin/usuarios" element={<RequireRole roles={['ADMIN']}><UsersPage /></RequireRole>} />
            <Route path="/admin/materiales" element={<RequireRole roles={['ADMIN']}><MaterialsPage /></RequireRole>} />
            <Route path="/admin/ajustes" element={<RequireRole roles={['ADMIN']}><InventorySettingsPage /></RequireRole>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
