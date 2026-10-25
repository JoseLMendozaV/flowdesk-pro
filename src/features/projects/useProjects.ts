import { useCallback, useEffect, useState } from "react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { errorMessage } from "../../services/format";
import { flowdeskApi } from "../../services/flowdeskApi";
import type { ProjectSummary } from "../../types/projects";

export function useProjects(includeArchived = false) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await flowdeskApi.projects(includeArchived));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  useDataChanged(["projects", "tasks", "notes"], () => void load());

  return { projects, loading, error, reload: load };
}
