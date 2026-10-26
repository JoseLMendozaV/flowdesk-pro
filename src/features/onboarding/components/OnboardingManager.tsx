import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWindowVisible } from "../../../hooks/useWindowVisible";
import { flowdeskApi } from "../../../services/flowdeskApi";
import { availableFeatures, featureRevision, revisionMap, whatsNew } from "../registry/registry";
import { InteractiveTour } from "../tours/InteractiveTour";

/**
 * Una sola comprobación por sesión, aunque la ventana se oculte y vuelva a mostrarse.
 * Se marca antes de esperar a Rust para que dos llamadas seguidas no abran dos veces.
 */
let status: "idle" | "checking" | "done" = "idle";

/**
 * Decide qué mostrar al abrir FlowDesk. Espera a que el dashboard sea visible: un
 * inicio oculto con macOS no abre ninguna ventana hasta que el usuario abre la app.
 */
async function checkOnStartup() {
  if (status !== "idle") return;
  status = "checking";
  const visible = await getCurrentWindow().isVisible().catch(() => false);
  if (!visible) {
    status = "idle";
    return;
  }
  status = "done";
  const state = await flowdeskApi.onboarding();
  if (state.showWelcomeOnStartup) {
    await flowdeskApi.openOnboarding("welcome");
    return;
  }
  const features = availableFeatures(state.capabilities);
  const revision = featureRevision(features);
  if (state.lastSeenFeatureRevision === revision) return;
  const news = state.lastSeenFeatureRevision === null ? [] : whatsNew(features, state.seenFeatures);
  if (news.length > 0 && state.showWhatsNewOnUpdate) {
    await flowdeskApi.openOnboarding("whats-new");
    return;
  }
  // Sin nada que anunciar (o con las novedades desactivadas): se toma como conocido en silencio.
  await flowdeskApi.markFeaturesSeen(revisionMap(features), revision);
}

export function OnboardingManager() {
  const visible = useWindowVisible();
  useEffect(() => {
    if (visible) void checkOnStartup().catch(() => undefined);
  }, [visible]);
  return <InteractiveTour />;
}
