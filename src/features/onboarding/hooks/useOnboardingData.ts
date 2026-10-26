import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataChanged } from "../../../hooks/useDataChanged";
import { flowdeskApi } from "../../../services/flowdeskApi";
import type { ShortcutStatus } from "../../../types/dashboard";
import type { OnboardingPreferences, OnboardingState } from "../../../types/onboarding";
import { availableFeatures } from "../registry/registry";

/** Estado persistido, funciones disponibles en este binario y atajos globales registrados. */
export function useOnboardingData() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void flowdeskApi
      .onboarding()
      .then((next) => {
        setState(next);
        setError(null);
      })
      .catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    load();
    void flowdeskApi.shortcutStatus().then(setShortcuts).catch(() => setShortcuts([]));
  }, [load]);
  useDataChanged(["onboarding"], load);

  const features = useMemo(() => (state ? availableFeatures(state.capabilities) : []), [state]);

  const updatePreferences = useCallback(
    async (changes: Partial<OnboardingPreferences>) => {
      if (!state) return;
      const preferences: OnboardingPreferences = {
        showWelcomeOnStartup: state.showWelcomeOnStartup,
        showWhatsNewOnUpdate: state.showWhatsNewOnUpdate,
        resumeTour: state.resumeTour,
        ...changes,
      };
      setState({ ...state, ...preferences });
      try {
        setState(await flowdeskApi.updateOnboardingPreferences(preferences));
        setError(null);
      } catch (reason) {
        setError(String(reason));
        load();
      }
    },
    [load, state],
  );

  return { state, setState, features, shortcuts, error, setError, updatePreferences, reload: load };
}
