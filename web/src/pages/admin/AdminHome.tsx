import { Link } from 'react-router-dom';
import {
  BarChart3,
  ClipboardList,
  Inbox,
  Layers,
  Package,
  Plus,
  Ruler,
  Scissors,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Unit } from '../../api/inventory';
import type { OrderSummaryStaff, QuoteRequestStaff } from '../../api/orders';
import { useAuth } from '../../auth';
import { Alert, PageHeader } from '../../components/ui';
import { useApi } from '../../components/useApi';

interface StockRow { materialId: number; label: string; daysLeft: number | null; alert: boolean; lowStock: boolean }

const MODULES: { to: string; title: string; text: string; icon: LucideIcon }[] = [
  { to: '/pedidos', title: 'Pedidos', text: 'Cotizaciones, trabajos en el taller, pagos y factura.', icon: ClipboardList },
  { to: '/solicitudes', title: 'Solicitudes', text: 'Lo que piden los clientes desde la web, con fotos.', icon: Inbox },
  { to: '/stock', title: 'Stock', text: 'Rollos y retazos por material, historial y conteos.', icon: Layers },
  { to: '/admin/clientes', title: 'Clientes', text: 'Con y sin cuenta, datos de facturación.', icon: Users },
  { to: '/admin/materiales', title: 'Materiales', text: 'Referencias, costos, stock mínimo y alta de rollos.', icon: Package },
  { to: '/admin/compras', title: 'Compras', text: 'Proveedores y compras: crean rollos y actualizan el costo.', icon: ShoppingCart },
  { to: '/admin/catalogo', title: 'Catálogo', text: 'Vitrina pública, precios, IVA y vigencia de cotizaciones.', icon: Store },
  { to: '/admin/reportes', title: 'Reportes', text: 'Qué comprar, ventas, cartera, margen y faltantes.', icon: BarChart3 },
  { to: '/admin/usuarios', title: 'Usuarios', text: 'Clientes, empleados y administradores.', icon: UserCog },
  { to: '/admin/ajustes', title: 'Cortes a pulso', text: 'Tallas y tolerancia de la conciliación.', icon: SlidersHorizontal },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

export function AdminHome() {
  const { user } = useAuth();
  const units = useApi<{ units: Unit[] }>('/api/staff/units?needsCount=true');
  const requests = useApi<{ requests: QuoteRequestStaff[] }>('/api/staff/quote-requests?status=NUEVA');
  const workshop = useApi<{ orders: OrderSummaryStaff[] }>('/api/staff/orders?status=APROBADO,EN_PROCESO');
  const ready = useApi<{ orders: OrderSummaryStaff[] }>('/api/staff/orders?status=TERMINADO');
  const stock = useApi<{ materials: StockRow[] }>('/api/admin/reports/stock');

  const toCount = units.data?.units ?? [];
  const newRequests = requests.data?.requests.length ?? 0;
  const inWorkshop = workshop.data?.orders.length ?? 0;
  const readyCount = ready.data?.orders.length ?? 0;
  const low = stock.data?.materials.filter((m) => m.lowStock) ?? [];
  const runningOut = stock.data?.materials.filter((m) => m.alert && !m.lowStock) ?? [];
  const loaded = !!(requests.data && workshop.data && ready.data);

  return (
    <div className="stack">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
        title={`${greeting()}, ${user!.fullName.split(' ')[0]}`}
        sub="Esto es lo que pide atención hoy en el taller."
        actions={
          <>
            <Link to="/pedidos/nuevo" className="button"><Plus size={16} aria-hidden /> Nueva cotización</Link>
            <Link to="/corte" className="button primary"><Scissors size={16} aria-hidden /> Registrar corte</Link>
          </>
        }
      />

      <div className="grid stats">
        <Kpi to="/solicitudes" icon={Inbox} label="Solicitudes por responder" value={newRequests} highlight={newRequests > 0} />
        <Kpi to="/pedidos" icon={ClipboardList} label="Trabajos en el taller" value={inWorkshop} />
        <Kpi to="/pedidos" icon={Package} label="Listos para entregar" value={readyCount} highlight={readyCount > 0} />
        <Kpi to="/stock" icon={Ruler} label="Rollos por medir" value={toCount.length} />
      </div>

      {loaded && (toCount.length > 0 || low.length > 0 || runningOut.length > 0) && (
        <div className="stack" style={{ gap: 10 }}>
          {low.length > 0 && (
            <Alert tone="warn">
              <strong>Stock bajo el mínimo</strong>
              <span>{low.map((m) => m.label).join(', ')}. <Link to="/admin/compras">Registrar compra</Link></span>
            </Alert>
          )}
          {runningOut.length > 0 && (
            <Alert tone="warn">
              <strong>Se acaba pronto al ritmo actual</strong>
              <span>
                {runningOut.map((m) => `${m.label} (${m.daysLeft} días)`).join(', ')}. <Link to="/admin/reportes">Ver reporte</Link>
              </span>
            </Alert>
          )}
          {toCount.length > 0 && (
            <Alert tone="info">
              <strong>Rollos con muchos cortes a pulso sin verificar</strong>
              <span>
                Mídelos para conciliar las estimaciones:{' '}
                {toCount.map((u, i) => (
                  <span key={u.id}>{i > 0 && ', '}<Link to={`/stock/${u.id}`}>{u.code}</Link></span>
                ))}
              </span>
            </Alert>
          )}
        </div>
      )}

      <section className="stack">
        <h2>Módulos</h2>
        <div className="grid">
          {MODULES.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.to} to={m.to} className="card tile">
                <span className="tile-icon"><Icon size={20} aria-hidden /></span>
                <h3>{m.title}</h3>
                <p className="muted small">{m.text}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Kpi({ to, icon: Icon, label, value, highlight }: { to: string; icon: LucideIcon; label: string; value: number; highlight?: boolean }) {
  return (
    <Link to={to} className={`card stat tile ${highlight ? 'attention' : ''}`}>
      <span className="row between">
        <small>{label}</small>
        <Icon size={18} aria-hidden style={{ color: highlight ? 'var(--accent-ink)' : 'var(--muted)' }} />
      </span>
      <strong>{value.toLocaleString('es-CO')}</strong>
    </Link>
  );
}
