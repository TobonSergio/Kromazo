import { Link } from 'react-router-dom';
import type { CatalogItem } from '../../api/orders';
import { UNIT_LABEL } from '../../api/orders';
import { useAuth } from '../../auth';
import { ErrorMsg } from '../../components/Field';
import { useApi } from '../../components/useApi';
import { fmtMoney } from '../../units';

/** Vitrina del local: se ve sin iniciar sesión. */
export function CatalogPage() {
  const { user } = useAuth();
  const { data, error } = useApi<{ items: CatalogItem[] }>('/api/public/catalog');
  const groups = [
    { title: 'Servicios', items: data?.items.filter((i) => i.kind === 'SERVICIO') ?? [] },
    { title: 'Productos', items: data?.items.filter((i) => i.kind === 'PRODUCTO') ?? [] },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="stack">
      <div className="hero card stack">
        <h1>Vinilos, calcas y wraps para tu moto</h1>
        <p className="muted">Precios de referencia. Para un trabajo a la medida, envíanos fotos de tu moto y te cotizamos.</p>
        <div>
          {user?.role === 'CLIENT' ? (
            <Link to="/cliente/solicitar" className="button primary">Pedir cotización</Link>
          ) : !user ? (
            <Link to="/registro" className="button primary">Crear cuenta y pedir cotización</Link>
          ) : null}
        </div>
      </div>
      <ErrorMsg error={error} />
      {groups.map((g) => (
        <section key={g.title} className="stack">
          <h2>{g.title}</h2>
          <div className="grid">
            {g.items.map((i) => (
              <article key={i.id} className="card stack catalog-item">
                <h3>{i.name}</h3>
                {i.description && <p className="muted small">{i.description}</p>}
                <p className="price">
                  {i.unitPrice > 0 ? (
                    <>
                      Desde {fmtMoney(i.unitPrice)}
                      {i.pricingUnit !== 'GLOBAL' && <small className="muted"> / {UNIT_LABEL[i.pricingUnit]}</small>}
                      {i.taxRateBp > 0 && <small className="muted"> + IVA</small>}
                    </>
                  ) : (
                    <span className="muted">Precio según cotización</span>
                  )}
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}
      {data && groups.length === 0 && <p className="muted center">Pronto publicaremos nuestro catálogo.</p>}
    </div>
  );
}
