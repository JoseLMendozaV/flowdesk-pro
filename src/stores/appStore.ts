import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CalendarMode } from "../types/calendar";
import type { TaskView } from "../types/tasks";

export type Section = "dashboard" | "tasks" | "projects" | "notes" | "focus" | "time" | "calendar" | "workspaces" | "clipboard";
export type TaskLayout = "list" | "kanban";

type AppState = {
  selectedSection: Section;
  rightPanelVisible: boolean;
  quickTaskOpen: boolean;
  preferencesOpen: boolean;
  dashboardRevision: number;
  taskView: TaskView;
  taskLayout: TaskLayout;
  calendarMode: CalendarMode;
  /**
   * Hora (minutos desde medianoche) a la que el calendario coloca las tareas con fecha
   * pero sin hora; `null` las deja en la franja de todo el día.
   */
  untimedTaskMinute: number | null;
  /** Tarea que debe abrirse en el detalle al llegar a Tareas. */
  focusedTaskId: string | null;
  toggleRightPanel: () => void;
  openQuickTask: () => void;
  closeQuickTask: () => void;
  openPreferences: () => void;
  closePreferences: () => void;
  refreshDashboard: () => void;
  selectSection: (section: Section) => void;
  setTaskView: (view: TaskView) => void;
  setTaskLayout: (layout: TaskLayout) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  setUntimedTaskMinute: (minute: number | null) => void;
  openTasks: (view: TaskView) => void;
  focusTask: (taskId: string) => void;
  clearFocusedTask: () => void;
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
      calendarMode: "week",
      // Las 12:00: la hora a la que se guardan las tareas sin hora.
      untimedTaskMinute: 12 * 60,
      focusedTaskId: null,
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
      setCalendarMode: (calendarMode) => set({ calendarMode }),
      setUntimedTaskMinute: (untimedTaskMinute) => set({ untimedTaskMinute }),
      openTasks: (taskView) => set({ selectedSection: "tasks", taskView }),
      // «Todas»: la tarea puede no vencer hoy.
      focusTask: (focusedTaskId) => set({ selectedSection: "tasks", taskView: "all", focusedTaskId }),
      clearFocusedTask: () => set({ focusedTaskId: null }),
    }),
    {
      name: "flowdesk-ui",
      partialize: (state) => ({
        rightPanelVisible: state.rightPanelVisible,
        taskLayout: state.taskLayout,
        calendarMode: state.calendarMode,
        untimedTaskMinute: state.untimedTaskMinute,
      }),
    },
  ),
);
