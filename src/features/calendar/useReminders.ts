import { useCallback, useEffect, useState } from "react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { flowdeskApi } from "../../services/flowdeskApi";
import type { ReminderItem } from "../../types/calendar";

export function useReminders() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const load = useCallback(async () => {
    try {
      setReminders(await flowdeskApi.reminders());
    } catch {
      setReminders([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // El servicio anuncia "reminders" después de derivar o entregar avisos.
  useDataChanged(["reminders"], () => void load());
  return reminders;
}
