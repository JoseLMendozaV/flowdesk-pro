import { useCallback, useEffect, useState } from "react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { useWindowVisible } from "../../hooks/useWindowVisible";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage } from "../../services/format";
import type { CalendarRange } from "../../types/calendar";

const empty: CalendarRange = { events: [], tasks: [] };

export function useCalendar(start: number, end: number) {
  const [data, setData] = useState<CalendarRange>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await flowdeskApi.calendar(start, end));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["calendar", "tasks", "projects"], () => void load());

  return { data, loading, error };
}

/** Hora actual que avanza con cada minuto, solo mientras la ventana se ve. */
export function useMinuteClock() {
  const visible = useWindowVisible();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!visible) return;
    setNow(new Date());
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [visible]);
  return now;
}
