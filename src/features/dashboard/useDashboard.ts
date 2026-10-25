import { useCallback, useEffect, useState } from "react";
import { flowdeskApi } from "../../services/flowdeskApi";
import { useAppStore } from "../../stores/appStore";
import type { DashboardSummary } from "../../types/dashboard";

export function useDashboard() {
  const revision = useAppStore((state) => state.dashboardRevision);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await flowdeskApi.dashboard());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);

  return { data, error, loading, reload: load };
}
