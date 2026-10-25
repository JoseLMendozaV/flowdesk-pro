import { useEffect, useRef } from "react";

export function useEscape(onEscape: () => void, active = true) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    function handle(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handlerRef.current();
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [active]);
}
