import { createContext, useContext, useEffect } from "react";

export type AppActions = {
  notify: (message: string) => void;
  fail: (cause: unknown) => void;
  /** Ejecuta una operación; si falla muestra el error. Devuelve `true` si terminó bien. */
  run: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
  setUnsaved: (unsaved: boolean) => void;
};

export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions(): AppActions {
  const actions = useContext(AppActionsContext);
  if (!actions) throw new Error("useAppActions debe usarse dentro de AppActionsContext");
  return actions;
}

/** Informa a App que la vista tiene cambios sin guardar, para pedir confirmación al salir. */
export function useUnsavedChanges(unsaved: boolean) {
  const { setUnsaved } = useAppActions();
  useEffect(() => {
    setUnsaved(unsaved);
    return () => setUnsaved(false);
  }, [unsaved, setUnsaved]);
}
