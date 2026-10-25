import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TaskView } from "../types/tasks";

export type Section = "dashboard" | "tasks" | "projects" | "notes" | "focus" | "time";
export type TaskLayout = "list" | "kanban";

type AppState = {
  selectedSection: Section;
  rightPanelVisible: boolean;
  quickTaskOpen: boolean;
  preferencesOpen: boolean;
  dashboardRevision: number;
  taskView: TaskView;
  taskLayout: TaskLayout;
  toggleRightPanel: () => void;
  openQuickTask: () => void;
  closeQuickTask: () => void;
  openPreferences: () => void;
  closePreferences: () => void;
  refreshDashboard: () => void;
  selectSection: (section: Section) => void;
  setTaskView: (view: TaskView) => void;
  setTaskLayout: (layout: TaskLayout) => void;
  openTasks: (view: TaskView) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedSection: "dashboard",
      rightPanelVisible: true,
      quickTaskOpen: false,
      preferencesOpen: false,
      dashboardRevision: 0,
      taskView: "today",
      taskLayout: "list",
      toggleRightPanel: () =>
        set((state) => ({ rightPanelVisible: !state.rightPanelVisible })),
      openQuickTask: () => set({ quickTaskOpen: true }),
      closeQuickTask: () => set({ quickTaskOpen: false }),
      openPreferences: () => set({ preferencesOpen: true }),
      closePreferences: () => set({ preferencesOpen: false }),
      refreshDashboard: () =>
        set((state) => ({ dashboardRevision: state.dashboardRevision + 1 })),
      selectSection: (selectedSection) => set({ selectedSection }),
      setTaskView: (taskView) => set({ taskView }),
      setTaskLayout: (taskLayout) => set({ taskLayout }),
      openTasks: (taskView) => set({ selectedSection: "tasks", taskView }),
    }),
    {
      name: "flowdesk-ui",
      partialize: (state) => ({
        rightPanelVisible: state.rightPanelVisible,
        taskLayout: state.taskLayout,
      }),
    },
  ),
);
