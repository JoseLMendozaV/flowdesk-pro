import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { MousePointerClick, X } from "lucide-react";
import { useWindowVisible } from "../../../hooks/useWindowVisible";
import { flowdeskApi } from "../../../services/flowdeskApi";
import { useAppStore, type Section } from "../../../stores/appStore";
import type { GuidedTourRequest } from "../../../types/onboarding";
import { availableFeatures, tourSteps, type ResolvedTourStep } from "../registry/registry";
import { usePrefersReducedMotion } from "../hooks/useMotion";
import { TourSpotlight, type SpotlightRect } from "./TourSpotlight";
import "../onboarding.css";

const FIND_TIMEOUT_MS = 1500;

type Tour = { steps: ResolvedTourStep[]; index: number; direction: 1 | -1; request: GuidedTourRequest };

/** Vuelve a la guía si la visita se lanzó desde ella, para seguir el recorrido. */
function returnToGuide(request: GuidedTourRequest) {
  if (request.returnTo) void flowdeskApi.openOnboarding(request.returnTo.mode, request.returnTo.featureId ?? undefined).catch(() => undefined);
}

function visibleElement(step: ResolvedTourStep) {
  const targets = Array.isArray(step.target) ? step.target : [step.target];
  for (const target of targets) {
    const element = document.querySelector<HTMLElement>(`[data-tour-id="${CSS.escape(target)}"]`);
    if (element && element.getClientRects().length > 0) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return element;
    }
  }
  return null;
}

/** Espera a que la sección pinte el elemento; si no aparece, el paso se omite. */
function waitForElement(step: ResolvedTourStep, signal: { cancelled: boolean }) {
  return new Promise<HTMLElement | null>((resolve) => {
    const started = performance.now();
    const poll = () => {
      if (signal.cancelled) return resolve(null);
      const element = visibleElement(step);
      if (element) return resolve(element);
      if (performance.now() - started > FIND_TIMEOUT_MS) return resolve(null);
      requestAnimationFrame(poll);
    };
    poll();
  });
}

function measure(element: HTMLElement): SpotlightRect {
  const rect = element.getBoundingClientRect();
  // Recorta al área visible: un panel más alto que la ventana no tapa el globo.
  const top = Math.max(rect.top, 0);
  const left = Math.max(rect.left, 0);
  return {
    top,
    left,
    width: Math.min(rect.right, window.innerWidth) - left,
    height: Math.min(rect.bottom, window.innerHeight) - top,
  };
}

/**
 * Visita guiada sobre la interfaz real de la ventana principal. Solo cambia de sección:
 * no abre formularios, no crea ni modifica datos y devuelve la sección inicial al acabar.
 */
export function InteractiveTour() {
  const selectSection = useAppStore((state) => state.selectSection);
  const visible = useWindowVisible();
  const reducedMotion = usePrefersReducedMotion();
  const [tour, setTour] = useState<Tour | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<GuidedTourRequest | null>(null);
  const originalSection = useRef<Section | null>(null);
  const tourRef = useRef<Tour | null>(null);
  tourRef.current = tour;

  const finish = useCallback(
    (completed: boolean) => {
      const current = tourRef.current;
      if (!current) return;
      tourRef.current = null;
      if (completed) void flowdeskApi.recordOnboardingEvent("guided_tour_completed", current.request.featureId ?? "all").catch(() => undefined);
      setTour(null);
      setElement(null);
      setRect(null);
      if (originalSection.current) selectSection(originalSection.current);
      originalSection.current = null;
      returnToGuide(current.request);
    },
    [selectSection],
  );

  const start = useCallback(
    async (request: GuidedTourRequest) => {
      const { featureId } = request;
      // Un formulario abierto puede tener cambios sin guardar: la visita espera a que se cierre.
      const store = useAppStore.getState();
      if (store.quickTaskOpen || store.preferencesOpen || document.querySelector('[role="dialog"]')) {
        setBlocked(request);
        return;
      }
      setBlocked(null);
      try {
        const state = await flowdeskApi.onboarding();
        const features = availableFeatures(state.capabilities).filter((feature) => !featureId || feature.id === featureId);
        const steps = tourSteps(features);
        if (steps.length === 0) {
          setNotice("No hay pasos de la visita guiada para esta función.");
          returnToGuide(request);
          return;
        }
        originalSection.current = useAppStore.getState().selectedSection;
        setTour({ steps, index: 0, direction: 1, request });
        void flowdeskApi.recordOnboardingEvent("guided_tour_started", featureId ?? "all").catch(() => undefined);
      } catch (reason) {
        setNotice(String(reason));
        returnToGuide(request);
      }
    },
    [],
  );

  useEffect(() => {
    const unlisten = listen<GuidedTourRequest>("flowdesk://guided-tour", (event) => void start(event.payload));
    return () => void unlisten.then((dispose) => dispose());
  }, [start]);

  // Busca el elemento del paso actual; si no existe, salta al siguiente en la misma dirección.
  const step = tour?.steps[tour.index];
  useEffect(() => {
    if (!tour || !step) return;
    const signal = { cancelled: false };
    setElement(null);
    if (step.section && useAppStore.getState().selectedSection !== step.section) selectSection(step.section);
    void waitForElement(step, signal).then((found) => {
      if (signal.cancelled) return;
      if (found) {
        found.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
        setElement(found);
        return;
      }
      setTour((current) => {
        if (!current) return current;
        const nextIndex = current.index + current.direction;
        if (nextIndex < 0 || nextIndex >= current.steps.length) {
          window.setTimeout(() => finish(current.direction === 1), 0);
          return current;
        }
        return { ...current, index: nextIndex };
      });
    });
    return () => {
      signal.cancelled = true;
    };
  }, [finish, reducedMotion, selectSection, step, tour]);

  // Sigue al elemento si cambia el tamaño de la ventana, se desplaza o se mueve.
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => {
      if (!element.isConnected) return;
      setRect(measure(element));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    // El desplazamiento suave termina después del primer cálculo.
    const settle = window.setTimeout(update, 350);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearTimeout(settle);
    };
  }, [element]);

  const move = useCallback(
    (direction: 1 | -1) => {
      setTour((current) => {
        if (!current) return current;
        const index = current.index + direction;
        if (index >= current.steps.length) {
          window.setTimeout(() => finish(true), 0);
          return current;
        }
        if (index < 0) return current;
        return { ...current, index, direction };
      });
    },
    [finish],
  );

  // Teclado en captura para que los atajos de la sección (← → del calendario) no actúen.
  useEffect(() => {
    if (!tour) return;
    function handle(event: KeyboardEvent) {
      if (event.key === "Escape") finish(false);
      else if (event.key === "ArrowRight") move(1);
      else if (event.key === "ArrowLeft") move(-1);
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [finish, move, tour]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  return (
    <>
      {tour && step && element && rect && visible && (
        <TourSpotlight
          rect={rect}
          featureTitle={step.featureTitle}
          title={step.title}
          body={step.body}
          index={tour.index}
          total={tour.steps.length}
          onPrevious={tour.index > 0 ? () => move(-1) : null}
          onNext={() => move(1)}
          onSkip={() => finish(false)}
        />
      )}
      {blocked && (
        <div role="alert" className="fixed bottom-4 left-1/2 z-[95] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-[12px] shadow-2xl">
          <MousePointerClick className="size-4 flex-none text-[var(--accent)]" />
          Cierra el formulario abierto para empezar la visita guiada.
          <button type="button" onClick={() => void start(blocked)} className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white">Empezar</button>
          <button
            type="button"
            onClick={() => {
              setBlocked(null);
              returnToGuide(blocked);
            }}
            aria-label="Cancelar la visita guiada"
            className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="fixed bottom-4 left-1/2 z-[95] -translate-x-1/2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-2.5 text-[12px] shadow-2xl">{notice}</div>
      )}
    </>
  );
}
