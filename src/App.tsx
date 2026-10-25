import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { QuickTaskDialog } from "./features/tasks/QuickTaskDialog";
import { PreferencesDialog } from "./features/tray/PreferencesDialog";
import { TrayPanel } from "./features/tray/TrayPanel";
import { FloatingNote } from "./features/notes/FloatingNote";
import { useDataChanged } from "./hooks/useDataChanged";
import { AppShell } from "./layouts/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { FocusPage } from "./pages/FocusPage";
import { TimePage } from "./pages/TimePage";
import { NotesPage } from "./pages/NotesPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TasksPage } from "./pages/TasksPage";
import { useAppStore } from "./stores/appStore";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "tray") {
    return <TrayPanel />;
  }
  if (params.get("view") === "note" && params.get("id")) {
    return <FloatingNote noteId={params.get("id")!} />;
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
    });
    const refresh = Promise.all([listen("flowdesk://activated", refreshDashboard)]);
    return () => {
      void quickAction.then((dispose) => dispose());
      void navigate.then((dispose) => dispose());
      void refresh.then((dispose) => dispose.forEach((callback) => callback()));
    };
  }, [openPreferences, openQuickTask, openTasks, refreshDashboard, selectSection]);
  useDataChanged(["tasks", "projects", "notes", "time"], refreshDashboard);

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
        ) : (
          <DashboardPage />
        )}
      </AppShell>
      <QuickTaskDialog />
      <PreferencesDialog />
    </>
  );
}
