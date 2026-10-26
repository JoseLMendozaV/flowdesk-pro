import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, LoaderCircle, RotateCcw } from "lucide-react";
import { flowdeskApi } from "../../../services/flowdeskApi";
import type { OnboardingMode, OnboardingState } from "../../../types/onboarding";
import { useOnboardingData } from "../hooks/useOnboardingData";
import {
  featureRevision,
  needsSetup,
  releaseNotes,
  revisionMap,
  whatsNew,
  type WhatsNewEntry,
} from "../registry/registry";
import type { FeatureDefinition } from "../registry/types";
import { FeatureCatalogScreen } from "../screens/FeatureCatalogScreen";
import { FeatureStepScreen } from "../screens/FeatureStepScreen";
import { FinishScreen } from "../screens/FinishScreen";
import { ShortcutsScreen } from "../screens/ShortcutsScreen";
import { WelcomeScreen } from "../screens/WelcomeScreen";
import { WhatsNewScreen } from "../screens/WhatsNewScreen";
import { OnboardingHeader } from "./OnboardingHeader";
import { OnboardingNavigation } from "./OnboardingNavigation";
import { OnboardingProgress } from "./OnboardingProgress";
import "../onboarding.css";

type View =
  | { kind: "intro" }
  | { kind: "feature"; index: number }
  | { kind: "finish" }
  | { kind: "whats-new" }
  | { kind: "catalog" }
  | { kind: "shortcuts" };

/** Recorrido completo o solo las novedades sin ver. */
type Sequence = "tour" | "news";

const modes: OnboardingMode[] = ["welcome", "tour", "features", "whats-new", "shortcuts"];
const sectionLabels: Record<View["kind"], string> = {
  intro: "Bienvenida",
  feature: "Recorrido",
  finish: "Recorrido",
  "whats-new": "Novedades",
  catalog: "Funcionalidades",
  shortcuts: "Atajos de teclado",
};

function initialRoute() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") as OnboardingMode | null;
  return { mode: mode && modes.includes(mode) ? mode : "tour", featureId: params.get("feature") };
}

const stepId = (feature: FeatureDefinition) => `feature:${feature.id}`;

export function OnboardingWindow() {
  const { state, features, shortcuts, error, setError, updatePreferences } = useOnboardingData();
  const [mode, setMode] = useState<OnboardingMode>(() => initialRoute().mode);
  const [view, setView] = useState<View | null>(null);
  const [sequence, setSequence] = useState<Sequence>("tour");
  const [news, setNews] = useState<WhatsNewEntry[]>([]);
  const [resumed, setResumed] = useState(false);
  const pendingRoute = useRef<{ mode: OnboardingMode; featureId: string | null } | null>(initialRoute());
  const contentRef = useRef<HTMLElement>(null);
  const firstView = useRef(true);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (reason) {
        setError(String(reason));
      }
    },
    [setError],
  );

  const markSeen = useCallback(
    (current: OnboardingState, list: FeatureDefinition[]) => {
      const revision = featureRevision(list);
      if (list.length === 0 || current.lastSeenFeatureRevision === revision) return;
      void run(() => flowdeskApi.markFeaturesSeen(revisionMap(list), revision));
    },
    [run],
  );

  /** Abre un modo: el de la URL al crear la ventana o el que pide Rust si ya existía. */
  const enter = useCallback(
    (nextMode: OnboardingMode, featureId: string | null, current: OnboardingState, list: FeatureDefinition[]) => {
      setMode(nextMode);
      setResumed(false);
      if (nextMode === "whats-new") {
        // Se calcula antes de marcarlas como vistas.
        const entries = whatsNew(list, current.seenFeatures);
        setNews(entries);
        setSequence("news");
        setView({ kind: "whats-new" });
        if (entries.length > 0) {
          markSeen(current, list);
          void run(() => flowdeskApi.recordOnboardingEvent("whats_new_shown", entries.map((entry) => entry.feature.id).join(",")));
        }
        return;
      }
      if (nextMode === "shortcuts") {
        setView({ kind: "shortcuts" });
        return;
      }
      markSeen(current, list);
      if (nextMode === "features") {
        setView({ kind: "catalog" });
        return;
      }
      setSequence("tour");
      const requested = featureId ? list.findIndex((feature) => feature.id === featureId) : -1;
      if (requested >= 0) {
        setView({ kind: "feature", index: requested });
        return;
      }
      if (nextMode === "tour" && current.resumeTour && current.lastCompletedStepId) {
        const index = list.findIndex((feature) => stepId(feature) === current.lastCompletedStepId);
        if (index > 0) {
          setResumed(true);
          setView({ kind: "feature", index });
          return;
        }
      }
      setView({ kind: "intro" });
    },
    [markSeen, run],
  );

  useEffect(() => {
    if (!state || !pendingRoute.current) return;
    const route = pendingRoute.current;
    pendingRoute.current = null;
    enter(route.mode, route.featureId, state, features);
  }, [enter, features, state]);

  const stateRef = useRef({ state, features });
  stateRef.current = { state, features };
  useEffect(() => {
    const unlisten = listen<{ mode: OnboardingMode; featureId: string | null }>("flowdesk://onboarding-open", (event) => {
      const { state: current, features: list } = stateRef.current;
      if (!modes.includes(event.payload.mode)) return;
      if (current) enter(event.payload.mode, event.payload.featureId, current, list);
      else pendingRoute.current = event.payload;
    });
    return () => void unlisten.then((dispose) => dispose());
  }, [enter]);

  const sequenceFeatures = useMemo(() => (sequence === "news" ? news.map((entry) => entry.feature) : features), [features, news, sequence]);
  const welcomeMode = mode === "welcome";
  const firstRun = welcomeMode || state?.welcomeStatus === "pending";

  const goTo = useCallback(
    (next: View) => {
      setView(next);
      if (next.kind === "feature" && sequence === "tour") {
        const feature = sequenceFeatures[next.index];
        if (feature) void run(() => flowdeskApi.recordOnboardingStep(stepId(feature)));
      }
    },
    [run, sequence, sequenceFeatures],
  );

  const close = useCallback(() => void run(() => flowdeskApi.closeOnboarding()), [run]);

  /** «Explorar por mi cuenta», «Saltar recorrido», Esc o el botón de cerrar. */
  const skip = useCallback(() => {
    void run(async () => {
      if (welcomeMode) await flowdeskApi.finishWelcome("skipped");
      await flowdeskApi.closeOnboarding();
    });
  }, [run, welcomeMode]);

  const complete = useCallback(
    (then: () => Promise<unknown>) => {
      void run(async () => {
        if (sequence === "tour") {
          if (firstRun) await flowdeskApi.finishWelcome("completed");
          else await flowdeskApi.recordOnboardingStep(null);
        }
        await then();
      });
    },
    [firstRun, run, sequence],
  );

  const next = useCallback(() => {
    if (!view) return;
    if (view.kind === "intro" || view.kind === "whats-new") goTo(sequenceFeatures.length > 0 ? { kind: "feature", index: 0 } : { kind: "finish" });
    else if (view.kind === "feature") goTo(view.index + 1 < sequenceFeatures.length ? { kind: "feature", index: view.index + 1 } : { kind: "finish" });
  }, [goTo, sequenceFeatures.length, view]);

  const previous = useCallback(() => {
    if (!view) return;
    const start: View = sequence === "news" ? { kind: "whats-new" } : { kind: "intro" };
    if (view.kind === "feature") goTo(view.index > 0 ? { kind: "feature", index: view.index - 1 } : start);
    else if (view.kind === "finish") goTo(sequenceFeatures.length > 0 ? { kind: "feature", index: sequenceFeatures.length - 1 } : start);
  }, [goTo, sequence, sequenceFeatures.length, view]);

  const openFeature = useCallback(
    (featureId: string) => {
      const index = features.findIndex((feature) => feature.id === featureId);
      if (index < 0) return;
      setSequence("tour");
      setMode("tour");
      setResumed(false);
      goTo({ kind: "feature", index });
    },
    [features, goTo],
  );

  // Teclado: ← → para moverse y Esc para salir, salvo dentro de campos o de la captura ampliada.
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        skip();
      } else if (event.key === "ArrowRight" && view && ["intro", "feature", "whats-new"].includes(view.kind)) {
        if (view.kind === "whats-new" && news.length === 0) return;
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft" && view && ["feature", "finish"].includes(view.kind)) {
        event.preventDefault();
        previous();
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [news.length, next, previous, skip, view]);

  // El foco va al título de cada paso para que VoiceOver lo lea; en el primero, al botón principal.
  const viewKey = view ? `${view.kind}-${"index" in view ? view.index : ""}` : "";
  useEffect(() => {
    if (!viewKey) return;
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    contentRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [viewKey]);

  if (!state || !view) {
    return (
      <div className="grid h-screen place-items-center bg-[var(--bg)] text-[var(--muted)]">
        {error ? (
          <p className="flex max-w-sm items-center gap-2 text-[12px] text-red-500"><AlertCircle className="size-4" /> {error}</p>
        ) : (
          <LoaderCircle className="size-5 animate-spin" aria-label="Cargando" />
        )}
      </div>
    );
  }

  const currentFeature = view.kind === "feature" ? sequenceFeatures[view.index] : undefined;
  const resumeIndex = state.resumeTour && state.lastCompletedStepId ? features.findIndex((feature) => stepId(feature) === state.lastCompletedStepId) : -1;
  const stepLabels = [...sequenceFeatures.map((feature) => feature.title), sequence === "news" ? "Listo" : "Todo listo"];
  const stepIndex = view.kind === "feature" ? view.index : view.kind === "finish" ? sequenceFeatures.length : -1;
  const welcomePreference = {
    label: "No volver a mostrar esta bienvenida automáticamente",
    checked: !state.showWelcomeOnStartup,
    onChange: (checked: boolean) => void updatePreferences({ showWelcomeOnStartup: !checked }),
  };
  const whatsNewPreference = {
    label: "No mostrar automáticamente estas novedades",
    checked: !state.showWhatsNewOnUpdate,
    onChange: (checked: boolean) => void updatePreferences({ showWhatsNewOnUpdate: !checked }),
  };
  const activeTab: OnboardingMode | null =
    view.kind === "catalog" ? "features" : view.kind === "shortcuts" ? "shortcuts" : view.kind === "whats-new" || sequence === "news" ? "whats-new" : "tour";
  const announcement = currentFeature
    ? `${sequence === "news" ? "Novedad" : "Paso"} ${stepIndex + 1} de ${stepLabels.length}: ${currentFeature.title}`
    : sectionLabels[view.kind];

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)] text-[var(--text)]">
      <OnboardingHeader
        section={currentFeature ? currentFeature.title : sectionLabels[view.kind]}
        activeTab={activeTab}
        onTab={welcomeMode ? null : (tab) => enter(tab, null, state, features)}
        onClose={skip}
      />
      <p className="sr-only" aria-live="polite">{announcement}</p>

      {resumed && view.kind === "feature" && (
        <div className="flex flex-none items-center gap-2 border-b border-[var(--line)] bg-[var(--accent-soft)] px-6 py-1.5 text-[11px]">
          Continúas donde lo dejaste.
          <button type="button" onClick={() => { setResumed(false); goTo({ kind: "intro" }); }} className="flex items-center gap-1 font-medium text-[var(--accent)]">
            <RotateCcw className="size-3" /> Empezar desde el principio
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="flex flex-none items-center gap-2 bg-red-500/10 px-6 py-1.5 text-[11px] text-red-500">
          <AlertCircle className="size-3.5" /> {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto underline">Cerrar</button>
        </p>
      )}

      <main ref={contentRef} key={viewKey} className="onboarding-step-enter min-h-0 flex-1">
        {view.kind === "intro" && (
          <WelcomeScreen
            features={features}
            firstRun={firstRun}
            onStart={next}
            onExplore={skip}
            resumeTitle={resumeIndex > 0 ? features[resumeIndex].title : null}
            onResume={() => goTo({ kind: "feature", index: resumeIndex })}
          />
        )}
        {view.kind === "feature" && currentFeature && (
          <FeatureStepScreen
            key={currentFeature.id}
            feature={currentFeature}
            shortcuts={shortcuts}
            setupMessage={needsSetup(currentFeature, state.capabilities)}
            news={sequence === "news" ? news.find((entry) => entry.feature.id === currentFeature.id) : undefined}
            onShowInApp={
              currentFeature.tourSteps?.length
                ? () => void run(() => flowdeskApi.startGuidedTour(currentFeature.id, welcomeMode ? "welcome" : "tour"))
                : null
            }
          />
        )}
        {view.kind === "finish" &&
          (sequence === "news" ? (
            <FinishScreen title="¡Ya conoces las novedades!" message="Puedes repasarlas cuando quieras desde Ayuda → ¿Qué hay de nuevo?" primaryLabel="Seguir trabajando" onPrimary={close} onGuidedTour={null} />
          ) : (
            <FinishScreen
              title="¡Todo listo!"
              message="Ya puedes comenzar a utilizar FlowDesk Pro."
              primaryLabel="Comenzar a trabajar"
              onPrimary={() => complete(() => flowdeskApi.closeOnboarding())}
              onGuidedTour={() => complete(() => flowdeskApi.startGuidedTour())}
            />
          ))}
        {view.kind === "whats-new" && (
          <WhatsNewScreen entries={news} history={releaseNotes(features)} appVersion={state.appVersion} onOpenFeature={openFeature} />
        )}
        {view.kind === "catalog" && <FeatureCatalogScreen features={features} onOpenFeature={openFeature} />}
        {view.kind === "shortcuts" && <ShortcutsScreen shortcuts={shortcuts} featureIds={features.map((feature) => feature.id)} />}
      </main>

      {view.kind === "intro" && <OnboardingNavigation preference={welcomePreference} />}
      {(view.kind === "feature" || view.kind === "finish") && (
        <OnboardingNavigation
          progress={
            <OnboardingProgress
              current={stepIndex}
              labels={stepLabels}
              noun={sequence === "news" ? "Novedad" : "Paso"}
              onGo={(index) => goTo(index < sequenceFeatures.length ? { kind: "feature", index } : { kind: "finish" })}
            />
          }
          preference={sequence === "tour" ? welcomePreference : whatsNewPreference}
          onSkip={view.kind === "feature" ? skip : undefined}
          skipLabel={sequence === "news" ? "Cerrar" : "Saltar recorrido"}
          onPrevious={previous}
          onNext={view.kind === "feature" ? next : undefined}
          nextLabel={view.kind === "feature" && view.index + 1 === sequenceFeatures.length ? "Terminar" : "Siguiente"}
        />
      )}
      {view.kind === "whats-new" && (
        <OnboardingNavigation
          preference={whatsNewPreference}
          onSkip={close}
          skipLabel={news.length > 0 ? "Omitir por ahora" : "Cerrar"}
          onNext={news.length > 0 ? next : undefined}
          nextLabel="Ver novedades"
        />
      )}
    </div>
  );
}
