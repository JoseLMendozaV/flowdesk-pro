import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { isWindowVisible, subscribeVisibility } from "./useWindowVisible";

export type DataKind = "tasks" | "projects" | "notes" | "time";

/**
 * Ejecuta `callback` cuando Rust informa de cambios persistidos en alguno de los tipos
 * indicados. Con la ventana oculta, los cambios se agrupan y se aplican al mostrarla.
 */
export function useDataChanged(kinds: DataKind[], callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const key = kinds.join(",");

  useEffect(() => {
    const watched = key.split(",");
    let pending = false;
    const unlisten = listen<string>("flowdesk://data-changed", (event) => {
      if (!watched.includes(event.payload)) return;
      if (isWindowVisible()) callbackRef.current();
      else pending = true;
    });
    const unsubscribe = subscribeVisibility(() => {
      if (pending && isWindowVisible()) {
        pending = false;
        callbackRef.current();
      }
    });
    return () => {
      void unlisten.then((dispose) => dispose());
      unsubscribe();
    };
  }, [key]);
}
