// Arnés de capturas: la interfaz real de FlowDesk con el IPC de Tauri simulado y datos
// de demostración. No abre SQLite ni toca los datos del usuario.
//
// Parámetros: ?target=<sección>|tray|onboarding|note  &mode=<modo de la guía>  &feature=<id>
//             &timer=idle|running  &entry=running  &state=first-run|news|seen  &panel=0
//             &hidden=1 (dashboard oculto)  &settings=1 (abre Configuración)  &tour=<id> (visita guiada)
//             &return=1 (la visita vuelve a la bienvenida)  &demo=1  &palette=1 (abre la paleta ⌘K)
// Cada llamada al IPC queda en `window.__flowdeskCalls` para las pruebas de flujos.
import React from "react";
import ReactDOM from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import * as data from "./demoData";
import { availableFeatures, revisionMap } from "../../src/features/onboarding/registry/registry";
import "../../src/styles/globals.css";

const params = new URLSearchParams(window.location.search);
const target = params.get("target") ?? "dashboard";
const windowLabel = target === "tray" ? "tray-panel" : target === "onboarding" ? "onboarding" : target === "note" ? `note-${params.get("id") ?? "n1"}` : "main";

function onboardingState() {
  const variant = params.get("state") ?? "first-run";
  const seen = Object.fromEntries(
    ["dashboard", "tasks", "projects", "notes", "pomodoro", "time", "calendar", "workspaces", "clipboard", "menu-bar"].map((id) => [id, 1]),
  );
  return {
    welcomeStatus: variant === "first-run" ? "pending" : "completed",
    completedInitialOnboarding: variant !== "first-run",
    showWelcomeOnStartup: variant === "first-run",
    showWhatsNewOnUpdate: true,
    resumeTour: true,
    lastSeenAppVersion: variant === "first-run" ? null : "0.1.1",
    lastSeenFeatureRevision: variant === "first-run" ? null : "1:antigua",
    // «news»: un usuario que venía de la 0.1.1 y aún no conoce lo de la 0.2.0.
    // «seen»: conoce ya la revisión actual de todo lo disponible.
    seenFeatures: variant === "news" ? Object.fromEntries(Object.entries(seen).filter(([id]) => !["calendar", "workspaces", "clipboard"].includes(id))) : variant === "seen" || variant === "resume" ? revisionMap(availableFeatures(data.capabilities)) : {},
    lastCompletedStepId: variant === "resume" ? "feature:projects" : null,
    lastOnboardingDate: null,
    appVersion: "0.2.0",
    capabilities: data.capabilities,
  };
}

let onboarding = onboardingState();

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_dashboard_summary: () => data.dashboard,
  list_tasks: (args) => data.listTasks(args.filter as { view: string }),
  list_tags: () => data.tags,
  get_task: (args) => ({ ...data.tasks.find((task) => task.id === args.taskId), description: "", subtasks: [], notes: [] }),
  list_trash: () => data.trashItems,
  delete_task: () => "trash-task",
  delete_event: () => "trash-event",
  restore_trash_item: () => ({ entityType: "task", entityId: "k3" }),
  update_task: (args) => ({ ...data.tasks.find((task) => task.id === args.taskId), ...(args.input as object), description: "", subtasks: [], notes: [] }),
  update_event: (args) => ({ ...data.events.find((event) => event.id === args.eventId), ...(args.input as object) }),
  list_projects: () => data.projects,
  get_project: (args) => data.projects.find((project) => project.id === args.projectId),
  list_notes: () => data.notes,
  get_note: (args) => data.notes.find((note) => note.id === args.noteId) ?? data.notes[0],
  update_note: (args) => {
    const input = args.input as { noteId: string; title: string };
    const note = data.notes.find((item) => item.id === input.noteId) ?? data.notes[0];
    // `conflict=1`: otra ventana guardó antes (la revisión no coincide).
    if (params.get("conflict") === "1") throw "NOTE_CONFLICT";
    return { ...note, title: input.title, revision: note.revision + 1 };
  },
  list_note_attachments: () => data.noteAttachments,
  get_note_attachment_data: async () => (await fetch(new URL("../../src/assets/flowdesk-logo.png", import.meta.url))).arrayBuffer(),
  list_note_versions: () => data.noteVersions,
  get_note_contexts: () => data.noteContexts,
  get_timer_state: () => ({
    ...(params.get("timer") === "idle" ? data.idleTimer : data.timer),
    entry: params.get("entry") === "running" ? data.runningEntry : null,
    asOfMs: Date.now(),
  }),
  get_pomodoro_settings: () => data.pomodoroSettings,
  list_focus_sessions: () => data.focusSessions,
  get_time_stats: () => data.timeStats,
  list_time_entries: () => data.timeEntries,
  get_app_tracking_settings: () => ({ enabled: false, paused: false, idleMinutes: 5, retentionDays: 90, excludedApps: [] }),
  get_app_usage: () => ({ apps: [], todaySeconds: 0, weekSeconds: 0, currentApp: null }),
  list_calendar: (args) => ({
    events: data.events.filter((event) => event.endsAt > (args.start as number) && event.startsAt < (args.end as number)),
    tasks: data.tasks
      .filter((task) => task.dueAt !== null && task.dueAt >= (args.start as number) && task.dueAt < (args.end as number))
      .map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, dueAt: task.dueAt, dueHasTime: task.dueHasTime, projectColor: task.projectColor, estimatedMinutes: task.estimatedMinutes })),
  }),
  list_reminders: () => data.reminders,
  get_reminder_settings: () => ({ enabled: true, taskLeadMinutes: 10, dailyDigest: true, digestMinute: 540, quietHours: false, quietStart: 1320, quietEnd: 420 }),
  get_workspaces: () => data.workspaceState,
  get_clipboard_settings: () => data.clipboardSettings,
  list_clipboard: () => data.clipboardItems,
  get_shortcut_status: () => data.shortcuts,
  get_tray_preferences: () => ({ launchAtLogin: true, launchHidden: false, nextEventMinutes: 30 }),
  get_onboarding_state: () => onboarding,
  update_onboarding_preferences: (args) => (onboarding = { ...onboarding, ...(args.preferences as object) }),
  finish_welcome_onboarding: (args) =>
    (onboarding = { ...onboarding, welcomeStatus: args.outcome as string, completedInitialOnboarding: args.outcome === "completed", showWelcomeOnStartup: false }),
  mark_features_seen: (args) =>
    (onboarding = { ...onboarding, seenFeatures: { ...onboarding.seenFeatures, ...(args.features as object) }, lastSeenFeatureRevision: args.revision as string }),
  record_onboarding_step: () => null,
  close_onboarding: () => null,
  start_guided_tour: () => null,
  // La comprobación de inicio de la ventana principal pide abrir la bienvenida.
  open_onboarding: () => null,
  record_onboarding_event: () => null,
  // `hidden=1` simula el inicio oculto con macOS: el dashboard existe pero no se ve.
  "plugin:window|is_visible": () => params.get("hidden") !== "1",
  "plugin:window|is_minimized": () => false,
  "plugin:app|version": () => "0.2.0",
  "plugin:updater|check": () => null,
};

const calls: { command: string; args: unknown }[] = [];
(window as unknown as { __flowdeskCalls: typeof calls }).__flowdeskCalls = calls;

clearMocks();
mockWindows(windowLabel);
mockIPC((command, args) => {
  calls.push({ command, args });
  const handler = handlers[command];
  if (!handler) {
    console.warn(`[arnés] comando sin datos: ${command}`);
    return null;
  }
  return handler((args ?? {}) as Record<string, unknown>);
}, { shouldMockEvents: true });

// `draft=1`: borrador de una sesión que se cerró sin guardar (recuperación).
if (params.get("draft")) {
  localStorage.setItem(
    "flowdesk:note-draft:n1",
    JSON.stringify({
      baseRevision: 12,
      title: "Ideas para el capítulo 3",
      contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto recuperado tras el cierre" }] }] }),
      at: Date.now(),
    }),
  );
}

async function render() {
  const view = target === "tray" ? "tray" : target === "onboarding" ? "onboarding" : target === "note" ? "note" : null;
  const url = new URL(window.location.href);
  if (view) url.searchParams.set("view", view);
  window.history.replaceState(null, "", url);
  const [{ default: App }, { useAppStore }] = await Promise.all([import("../../src/App"), import("../../src/stores/appStore")]);
  if (!view) useAppStore.setState({ selectedSection: target as never, taskView: "today", taskLayout: "list", calendarMode: "week", rightPanelVisible: params.get("panel") !== "0" });
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  // Estados que solo se alcanzan interactuando: Configuración, visita guiada y demostraciones.
  if (params.get("settings")) window.setTimeout(() => useAppStore.getState().openPreferences(), 300);
  if (params.get("palette")) window.setTimeout(() => useAppStore.getState().setPaletteOpen(true), 300);
  const tour = params.get("tour");
  // `return=1`: la visita se lanzó desde la bienvenida y debe volver a ella.
  const returnTo = params.get("return") ? { mode: "welcome", featureId: tour } : null;
  if (tour) window.setTimeout(() => void emit("flowdesk://guided-tour", { featureId: tour, returnTo }), 600);
  // `panel=<pestaña>`: abre las opciones de la nota en esa pestaña.
  const panel = params.get("panel");
  if (panel) {
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Opciones de la nota"]')?.click();
      window.setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === panel)?.click(), 150);
    }, 700);
  }
  if (params.get("demo")) {
    window.setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.includes("Demostración"))?.click(), 600);
  }
  // Señal para el script de capturas: datos cargados y primera pintura hecha.
  window.setTimeout(() => document.documentElement.setAttribute("data-harness-ready", "true"), 1800);
}

void render();
