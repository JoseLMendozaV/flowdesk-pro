import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isWindowVisible, subscribeVisibility, useWindowVisible } from "../../hooks/useWindowVisible";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage } from "../../services/format";
import type { SessionType, TimerSnapshot } from "../../types/focus";

export const sessionLabels: Record<SessionType, string> = {
  focus: "Enfoque",
  short_break: "Descanso corto",
  long_break: "Descanso largo",
};

/** Estado de los temporizadores. Rust es la fuente de verdad; aquí solo se refleja. */
export function useTimer() {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void flowdeskApi.timer().then(setSnapshot).catch((reason) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    load();
    // Oculta, la ventana no repinta: al mostrarse vuelve a pedir el estado.
    const unlisten = listen<TimerSnapshot>("flowdesk://timer-changed", (event) => {
      if (isWindowVisible()) setSnapshot(event.payload);
    });
    const unsubscribe = subscribeVisibility(() => {
      if (isWindowVisible()) load();
    });
    window.addEventListener("focus", load);
    return () => {
      void unlisten.then((dispose) => dispose());
      unsubscribe();
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const run = useCallback(async (action: () => Promise<TimerSnapshot>) => {
    try {
      setSnapshot(await action());
      setError(null);
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    }
  }, []);

  return { snapshot, error, setError, run };
}

/**
 * Segundero solo de presentación: avanza la cuenta atrás entre eventos de Rust
 * mientras algo está en marcha y la ventana es visible. No guarda estado.
 */
export function useLiveTimer(snapshot: TimerSnapshot | null) {
  const windowVisible = useWindowVisible();
  const running =
    windowVisible && (snapshot?.pomodoro?.status === "running" || snapshot?.entry?.status === "running");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    let interval: number | undefined;
    const start = () => {
      window.clearInterval(interval);
      setNow(Date.now());
      if (document.visibilityState === "visible") interval = window.setInterval(() => setNow(Date.now()), 1000);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", start);
    };
  }, [running]);

  const drift = snapshot ? Math.max(0, Math.floor((now - snapshot.asOfMs) / 1000)) : 0;
  const pomodoro = snapshot?.pomodoro;
  const entry = snapshot?.entry;
  return {
    remaining: pomodoro ? Math.max(0, pomodoro.remainingSeconds - (pomodoro.status === "running" ? drift : 0)) : 0,
    pomodoroElapsed: pomodoro ? Math.min(pomodoro.plannedSeconds, pomodoro.elapsedSeconds + (pomodoro.status === "running" ? drift : 0)) : 0,
    entryElapsed: entry ? entry.elapsedSeconds + (entry.status === "running" ? drift : 0) : 0,
  };
}

export function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = rest.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
