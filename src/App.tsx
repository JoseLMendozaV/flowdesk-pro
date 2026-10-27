import { lazy, Suspense, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { CommandPalette } from "./features/palette/CommandPalette";
import { QuickTaskDialog } from "./features/tasks/QuickTaskDialog";
import { UndoToast } from "./features/trash/UndoToast";
import { PreferencesDialog } from "./features/tray/PreferencesDialog";
import { TrayPanel } from "./features/tray/TrayPanel";
import { OnboardingManager } from "./features/onboarding/components/OnboardingManager";
import { useDataChanged } from "./hooks/useDataChanged";
import { AppShell } from "./layouts/AppShell";
import { CalendarPage } from "./pages/CalendarPage";
import { ClipboardPage } from "./pages/ClipboardPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FocusPage } from "./pages/FocusPage";
import { TimePage } from "./pages/TimePage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { NotesPage } from "./pages/NotesPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TasksPage } from "./pages/TasksPage";
import { TrashPage } from "./pages/TrashPage";
import { useAppStore } from "./stores/appStore";

// Ventanas propias: su código (el editor de notas, la guía) se carga solo al abrirlas.
const FloatingNote = lazy(() => import("./features/notes/FloatingNote").then((module) => ({ default: module.FloatingNote })));
// Docencia (la antigua Control Docente) se carga al abrirla: no pesa en el resto de la app.
const TeachingPage = lazy(() => import("./features/teaching/TeachingPage"));
const OnboardingWindow = lazy(() =>
  import("./features/onboarding/components/OnboardingWindow").then((module) => ({ default: module.OnboardingWindow })),
);

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "tray") {
    return <TrayPanel />;
  }
  if (params.get("view") === "onboarding") {
    return (
      <Suspense fallback={<div className="h-screen bg-[var(--bg)]" />}>
        <OnboardingWindow />
      </Suspense>
    );
  }
  if (params.get("view") === "note" && params.get("id")) {
    return (
      <Suspense fallback={<div className="h-screen bg-[#FFF2A8]" />}>
        <FloatingNote noteId={params.get("id")!} />
      </Suspense>
    );
  }
  return <MainApplication />;
}

function MainApplication() {
  const openQuickTask = useAppStore((state) => state.openQuickTask);
  const openPreferences = useAppStore((state) => state.openPreferences);
  const refreshDashboard = useAppStore((state) => state.refreshDashboard);
  const selectedSection = useAppStore((state) => state.selectedSection);
  const selectSection = useAppStore((state) => state.selectSection);
  const openTasks = useAppStore((state) => state.openTasks);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);

  useEffect(() => {
    const quickAction = listen<string>("flowdesk://quick-action", (event) => {
      if (event.payload === "new-task") openQuickTask();
    });
    const navigate = listen<string>("flowdesk://navigate", (event) => {
      if (event.payload === "settings") openPreferences();
      if (event.payload === "dashboard") selectSection("dashboard");
      if (event.payload === "notes") selectSection("notes");
      if (event.payload === "tasks") openTasks("today");
      if (event.payload === "projects") selectSection("projects");
      if (event.payload === "focus") selectSection("focus");
      if (event.payload === "time") selectSection("time");
      if (event.payload === "calendar") selectSection("calendar");
      if (event.payload === "workspaces") selectSection("workspaces");
      if (event.payload === "clipboard") selectSection("clipboard");
      if (event.payload === "trash") selectSection("trash");
      if (event.payload === "teaching") selectSection("teaching");
    });
    const refresh = Promise.all([listen("flowdesk://activated", refreshDashboard)]);
    return () => {
      void quickAction.then((dispose) => dispose());
      void navigate.then((dispose) => dispose());
      void refresh.then((dispose) => dispose.forEach((callback) => callback()));
    };
  }, [openPreferences, openQuickTask, openTasks, refreshDashboard, selectSection]);
  useDataChanged(["tasks", "projects", "notes", "time", "calendar"], refreshDashboard);

  // ⌘K abre la paleta desde cualquier sección, también con el foco en un campo.
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(!useAppStore.getState().paletteOpen);
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [setPaletteOpen]);

  return (
    <>
      <AppShell>
        {selectedSection === "notes" ? (
          <NotesPage />
        ) : selectedSection === "tasks" ? (
          <TasksPage />
        ) : selectedSection === "projects" ? (
          <ProjectsPage />
        ) : selectedSection === "focus" ? (
          <FocusPage />
        ) : selectedSection === "time" ? (
          <TimePage />
        ) : selectedSection === "calendar" ? (
          <CalendarPage />
        ) : selectedSection === "workspaces" ? (
          <WorkspacesPage />
        ) : selectedSection === "clipboard" ? (
          <ClipboardPage />
        ) : selectedSection === "trash" ? (
          <TrashPage />
        ) : selectedSection === "teaching" ? (
          <Suspense fallback={<div className="h-full" />}>
            <TeachingPage />
          </Suspense>
        ) : (
          <DashboardPage />
        )}
      </AppShell>
      <QuickTaskDialog />
      <PreferencesDialog />
      <CommandPalette />
      <UndoToast />
      <OnboardingManager />
    </>
  );
}
