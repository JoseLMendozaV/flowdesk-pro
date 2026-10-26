import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const reducedQuery = "(prefers-reduced-motion: reduce)";

/** Preferencia «Reducir movimiento» de macOS (Accesibilidad → Pantalla). */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia(reducedQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(reducedQuery);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Las demostraciones solo se animan con la ventana a la vista: se detienen al
 * minimizarla u ocultarla y con «Reducir movimiento».
 */
export function useAnimationsActive() {
  const reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const window = getCurrentWindow();
    let minimized = false;
    const update = () => setVisible(document.visibilityState === "visible" && !minimized);
    const checkMinimized = () =>
      void window
        .isMinimized()
        .then((value) => {
          minimized = value;
          update();
        })
        .catch(() => undefined);
    document.addEventListener("visibilitychange", update);
    const unlisten = window.onResized(checkMinimized);
    const unlistenFocus = window.onFocusChanged(checkMinimized);
    return () => {
      document.removeEventListener("visibilitychange", update);
      void unlisten.then((dispose) => dispose());
      void unlistenFocus.then((dispose) => dispose());
    };
  }, []);
  return visible && !reduced;
}
