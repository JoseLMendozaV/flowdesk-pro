import { useCallback, useEffect, useState } from "react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage } from "../../services/format";
import type { WorkspaceState } from "../../types/workspaces";

const empty: WorkspaceState = { activeId: null, workspaces: [] };

export function useWorkspaces() {
  const [state, setState] = useState<WorkspaceState>(empty);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await flowdeskApi.workspaces());
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["workspaces", "projects", "notes", "tasks"], () => void load());

  const activate = useCallback(async (workspaceId: string | null) => {
    try {
      setState(await flowdeskApi.setActiveWorkspace(workspaceId));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  const active = state.workspaces.find((workspace) => workspace.id === state.activeId) ?? null;
  return { ...state, active, loaded, error, reload: load, activate };
}
