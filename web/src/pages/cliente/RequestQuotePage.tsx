import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUpload } from '../../api/client';
import type { QuoteRequest } from '../../api/orders';
import { ErrorMsg, errorText } from '../../components/Field';
import { PhotoPicker } from '../../components/Photos';

export function RequestQuotePage() {
  const navigate = useNavigate();
  const [vehicleDesc, setVehicleDesc] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) return setError('Agrega al menos una foto de la moto.');
    setError(null);
    setBusy(true);
    const form = new FormData();
    form.append('vehicleDesc', vehicleDesc);
    form.append('description', description);
    for (const f of files) form.append('photos', f, f.name);
    try {
      const r = await apiUpload<{ request: QuoteRequest }>('/api/client/quote-requests', form);
      navigate(`/cliente/solicitudes/${r.request.id}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack narrow" onSubmit={submit}>
      <h1>Pedir cotización</h1>
      <p className="muted">Cuéntanos qué quieres y envíanos fotos de la moto. Te respondemos con la cotización aquí mismo.</p>
      <label className="field">
        <span>Tu moto</span>
        <input required minLength={3} maxLength={120} placeholder="Marca, modelo, color y año. Ej.: Pulsar NS200 negra 2022" value={vehicleDesc} onChange={(e) => setVehicleDesc(e.target.value)} />
      </label>
      <label className="field">
        <span>¿Qué quieres hacerle?</span>
        <textarea required minLength={10} maxLength={2000} rows={5} placeholder="Ej.: wrap mate en tanque y tapas laterales, con filetes rojos…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="field">
        <span>Fotos de la moto</span>
        <PhotoPicker files={files} onChange={setFiles} />
      </div>
      <ErrorMsg error={error} />
      <button className="primary big" disabled={busy}>{busy ? 'Enviando fotos…' : 'Enviar solicitud'}</button>
    </form>
  );
}
