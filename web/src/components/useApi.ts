import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { errorText } from './Field';

/** GET con estado de carga. `url = null` no carga nada. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      setData(await api<T>('GET', url));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
