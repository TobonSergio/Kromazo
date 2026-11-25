import type { ReactNode } from 'react';
import { Camera, ClipboardCheck, ShieldCheck } from 'lucide-react';
import { Brand } from './Layout';

/** Pantallas de acceso: panel de marca a la izquierda (arriba en el celular) y formulario a la derecha. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Brand to="/catalogo" />
        <h2>
          Tu moto con el <em>estilo</em> que buscas.
        </h2>
        <ul>
          <li><Camera size={18} aria-hidden /> Envía fotos de tu moto y recibe tu cotización.</li>
          <li><ClipboardCheck size={18} aria-hidden /> Acepta y sigue el estado de tu trabajo en línea.</li>
          <li><ShieldCheck size={18} aria-hidden /> Tus fotos se guardan sin ubicación ni datos de la cámara.</li>
        </ul>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}
