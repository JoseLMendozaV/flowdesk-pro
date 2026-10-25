import { useCallback, useEffect, useRef, useState } from "react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { errorMessage } from "../../services/format";
import { flowdeskApi } from "../../services/flowdeskApi";
import type { Tag, TaskFilter, TaskSummary } from "../../types/tasks";

export function useTasks(filter: TaskFilter) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filterKey = JSON.stringify(filter);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const result = await flowdeskApi.tasks(JSON.parse(filterKey) as TaskFilter);
      // Ignora respuestas de filtros anteriores que lleguen tarde.
      if (current !== requestId.current) return;
      setTasks(result);
      setError(null);
    } catch (reason) {
      if (current === requestId.current) setError(errorMessage(reason));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [filterKey]);

  useEffect(() => {
    setLoading(true);
    const timeout = window.setTimeout(() => void load(), 120);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useDataChanged(["tasks", "projects"], () => void load());

  return { tasks, setTasks, loading, error, reload: load };
}

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const load = useCallback(() => {
    void flowdeskApi.tags().then(setTags).catch(() => setTags([]));
  }, []);
  useEffect(load, [load]);
  useDataChanged(["tasks", "projects"], load);
  return tags;
}
