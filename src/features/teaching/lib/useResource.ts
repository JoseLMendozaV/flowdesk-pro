import { useCallback, useEffect, useRef, useState } from "react";
import { useAppActions } from "./app-context";

/**
 * Carga datos del backend al montar la vista y cada vez que cambia `deps`.
 * Las respuestas de solicitudes anteriores se descartan, así que cambiar de curso
 * rápidamente nunca deja datos de otro curso en pantalla.
 */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const { fail } = useAppActions();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  const requestRef = useRef(0);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await loadRef.current();
      if (request === requestRef.current) setData(result);
    } catch (cause) {
      if (request === requestRef.current) fail(cause);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    void reload();
    return () => {
      requestRef.current++;
    };
  }, [reload, ...deps]);

  return { data, loading, reload };
}
