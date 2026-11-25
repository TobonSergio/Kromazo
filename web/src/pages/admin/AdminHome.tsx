import { Link } from 'react-router-dom';
import type { Material, Unit } from '../../api/inventory';
import type { OrderSummaryStaff, QuoteRequestStaff } from '../../api/orders';
import { useApi } from '../../components/useApi';

export function AdminHome() {
  const units = useApi<{ units: Unit[] }>('/api/staff/units?needsCount=true');
  const materials = useApi<{ materials: Material[] }>('/api/staff/materials');
  const requests = useApi<{ requests: QuoteRequestStaff[] }>('/api/staff/quote-requests?status=NUEVA');
  const ready = useApi<{ orders: OrderSummaryStaff[] }>('/api/staff/orders?status=TERMINADO');
  const toCount = units.data?.units.length ?? 0;
  const newRequests = requests.data?.requests.length ?? 0;
  const readyCount = ready.data?.orders.length ?? 0;
  const low = materials.data?.materials.filter((m) => m.lowStock) ?? [];
  const stock = useApi<{ materials: { materialId: number; label: string; daysLeft: number | null; alert: boolean; lowStock: boolean }[] }>('/api/admin/reports/stock');
  const runningOut = stock.data?.materials.filter((m) => m.alert && !m.lowStock) ?? [];

  return (
    <div className="stack">
      <h1>Panel de administración</h1>

      {(toCount > 0 || low.length > 0 || newRequests > 0 || readyCount > 0 || runningOut.length > 0) && (
        <div className="card stack">
          {newRequests > 0 && (
            <p className="attention-text">
              <Link to="/solicitudes">{newRequests} {newRequests === 1 ? 'solicitud nueva' : 'solicitudes nuevas'} de cotización</Link> por responder.
            </p>
          )}
          {readyCount > 0 && (
            <p><Link to="/pedidos">{readyCount} {readyCount === 1 ? 'trabajo terminado' : 'trabajos terminados'}</Link> esperando entrega.</p>
          )}
          {toCount > 0 && (
            <p className="warn">
              {toCount} {toCount === 1 ? 'rollo necesita' : 'rollos necesitan'} medición (muchos cortes a pulso sin verificar):{' '}
              {units.data!.units.map((u, i) => (
                <span key={u.id}>{i > 0 && ', '}<Link to={`/stock/${u.id}`}>{u.code}</Link></span>
              ))}
            </p>
          )}
          {low.length > 0 && <p className="warn">Stock bajo: {low.map((m) => m.label).join(', ')}.</p>}
          {runningOut.length > 0 && (
            <p className="warn">
              Al ritmo actual se acaba pronto:{' '}
              {runningOut.map((m) => `${m.label} (${m.daysLeft} días)`).join(', ')}. <Link to="/admin/reportes">Ver reporte</Link>
            </p>
          )}
        </div>
      )}

      <div className="grid">
        <Link to="/corte" className="card tile">
          <h2>Registrar corte</h2>
          <p className="muted">Medido o a pulso, con retazos.</p>
        </Link>
        <Link to="/stock" className="card tile">
          <h2>Stock</h2>
          <p className="muted">Rollos y retazos por material, historial y conteos.</p>
        </Link>
        <Link to="/admin/materiales" className="card tile">
          <h2>Materiales</h2>
          <p className="muted">Referencias, costos, stock mínimo y alta de rollos.</p>
        </Link>
        <Link to="/admin/ajustes" className="card tile">
          <h2>Cortes a pulso</h2>
          <p className="muted">Tallas y tolerancia de la conciliación.</p>
        </Link>
        <Link to="/admin/usuarios" className="card tile">
          <h2>Usuarios</h2>
          <p className="muted">Clientes, empleados y administradores.</p>
        </Link>
        <Link to="/pedidos" className="card tile">
          <h2>Pedidos</h2>
          <p className="muted">Cotizaciones, trabajos en el taller, pagos y factura.</p>
        </Link>
        <Link to="/solicitudes" className="card tile">
          <h2>Solicitudes</h2>
          <p className="muted">Lo que piden los clientes desde la web, con fotos.</p>
        </Link>
        <Link to="/admin/clientes" className="card tile">
          <h2>Clientes</h2>
          <p className="muted">Con y sin cuenta, datos de facturación.</p>
        </Link>
        <Link to="/admin/catalogo" className="card tile">
          <h2>Catálogo</h2>
          <p className="muted">Vitrina pública, precios, IVA y vigencia de cotizaciones.</p>
        </Link>
        <Link to="/admin/compras" className="card tile">
          <h2>Compras</h2>
          <p className="muted">Proveedores y compras de rollos (crean el inventario y actualizan el costo).</p>
        </Link>
        <Link to="/admin/reportes" className="card tile">
          <h2>Reportes</h2>
          <p className="muted">Qué comprar, ventas, cartera, margen, desperdicio y faltantes.</p>
        </Link>
      </div>
    </div>
  );
}
