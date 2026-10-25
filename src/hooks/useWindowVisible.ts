import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Visibilidad de esta ventana según Rust. Una página oculta no debe repintar:
// WebKit dejaría un display link activo a la frecuencia del monitor (docs/PHASE_05.md).
let visible = true;
let initialized = false;
const listeners = new Set<() => void>();

function update(next: boolean) {
  if (next === visible) return;
  visible = next;
  listeners.forEach((listener) => listener());
}

function initialize() {
  if (initialized) return;
  initialized = true;
  const window = getCurrentWindow();
  void window.isVisible().then(update).catch(() => undefined);
  void listen<{ label: string; visible: boolean }>("flowdesk://visibility", (event) => {
    if (event.payload.label === window.label) update(event.payload.visible);
  });
}

export function isWindowVisible() {
  initialize();
  return visible;
}

export function subscribeVisibility(listener: () => void) {
  initialize();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWindowVisible() {
  return useSyncExternalStore(subscribeVisibility, isWindowVisible);
}
