import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Moon, Sun, SunMoon, type LucideIcon } from 'lucide-react';

/** Encabezado de página: título, subtítulo opcional y acciones a la derecha. */
export function PageHeader({
  title,
  sub,
  eyebrow,
  back,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  eyebrow?: string;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {back && (
        <Link to={back.to} className="back">
          <ArrowLeft size={16} aria-hidden /> {back.label}
        </Link>
      )}
      <div className="page-header">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </div>
  );
}

const ALERT_ICON: Record<'warn' | 'info' | 'ok', LucideIcon> = { warn: AlertTriangle, info: Info, ok: CheckCircle2 };

/** Aviso con ícono: el estado nunca depende solo del color. */
export function Alert({ tone = 'info', children }: { tone?: 'warn' | 'info' | 'ok'; children: ReactNode }) {
  const Icon = ALERT_ICON[tone];
  return (
    <div className={`alert ${tone}-box`} role={tone === 'warn' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div className="stack" style={{ gap: 4 }}>{children}</div>
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={36} strokeWidth={1.5} aria-hidden />
      <strong style={{ color: 'var(--text)' }}>{title}</strong>
      {children}
    </div>
  );
}

// ───── Tema claro / oscuro ─────

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'vinilos-tema';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyPref(p: ThemePref) {
  if (p === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', p);
}

/** Se llama antes de pintar para evitar un destello del tema equivocado. */
export const initTheme = () => applyPref(readPref());

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  useEffect(() => applyPref(pref), [pref]);
  const cycle = useCallback(() => {
    setPref((p) => {
      const next: ThemePref = p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system';
      try {
        if (next === 'system') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {
        /* sin almacenamiento: el cambio dura hasta recargar */
      }
      return next;
    });
  }, []);
  return { pref, cycle };
}

const THEME_LABEL: Record<ThemePref, string> = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: oscuro' };
const THEME_ICON: Record<ThemePref, LucideIcon> = { system: SunMoon, light: Sun, dark: Moon };

export function ThemeButton({ compact = false }: { compact?: boolean }) {
  const { pref, cycle } = useTheme();
  const Icon = THEME_ICON[pref];
  return compact ? (
    <button type="button" className="icon-btn" onClick={cycle} aria-label={THEME_LABEL[pref]} title={THEME_LABEL[pref]}>
      <Icon size={18} />
    </button>
  ) : (
    <button type="button" className="nav-item ghost" onClick={cycle} style={{ justifyContent: 'flex-start', border: 0, minHeight: 0 }}>
      <Icon size={18} aria-hidden /> {THEME_LABEL[pref]}
    </button>
  );
}
