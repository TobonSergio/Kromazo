import { useEffect, useState } from 'react';
import type { Photo } from '../api/orders';

/** Galería de fotos. Las imágenes vienen de /api/attachments/:id, que verifica permisos con la cookie de sesión. */
export function Photos({ photos }: { photos: Photo[] }) {
  const [open, setOpen] = useState<Photo | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (photos.length === 0) return <p className="muted small">Sin fotos.</p>;
  return (
    <>
      <div className="photo-grid">
        {photos.map((p) => (
          <button key={p.id} type="button" className="photo" onClick={() => setOpen(p)} aria-label="Ver foto">
            <img src={p.url} alt="" loading="lazy" width={p.width} height={p.height} />
            {p.source === 'ORDER' && <span className="photo-tag">Local</span>}
          </button>
        ))}
      </div>
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <img src={open.url} alt="" />
          <button type="button" className="lightbox-close" aria-label="Cerrar">✕</button>
        </div>
      )}
    </>
  );
}

/** Selector de fotos con vista previa y validación básica en el navegador (el servidor valida de verdad). */
export function PhotoPicker({ files, onChange, max = 5 }: { files: File[]; onChange: (f: File[]) => void; max?: number }) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function add(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    const tooBig = picked.filter((f) => f.size > 10 * 1024 * 1024);
    const ok = picked.filter((f) => f.size <= 10 * 1024 * 1024);
    const next = [...files, ...ok].slice(0, max);
    setWarning(
      tooBig.length ? `${tooBig.length} foto(s) pesan más de 10 MB y no se agregaron.` : files.length + ok.length > max ? `Máximo ${max} fotos.` : null,
    );
    onChange(next);
  }

  return (
    <div className="stack">
      <div className="photo-grid">
        {previews.map((u, i) => (
          <div key={u} className="photo">
            <img src={u} alt="" />
            <button type="button" className="photo-remove" aria-label="Quitar foto" onClick={() => onChange(files.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        {files.length < max && (
          <label className="photo add">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
            <span>+ Foto</span>
          </label>
        )}
      </div>
      <small className="muted">Hasta {max} fotos de máx. 10 MB. Les quitamos la ubicación y los datos de la cámara antes de guardarlas.</small>
      {warning && <p className="warn small">{warning}</p>}
    </div>
  );
}
