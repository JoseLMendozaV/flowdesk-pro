import { invoke } from "@tauri-apps/api/core";
import type {
  DashboardSummary,
  Note,
  ShortcutStatus,
  TrayPreferences,
} from "../types/dashboard";
import type {
  EntryInput,
  FocusSession,
  PomodoroSettings,
  StartPomodoroInput,
  TimeEntry,
  TimeStats,
  TimerSnapshot,
} from "../types/focus";
import type {
  ProjectDeleteMode,
  ProjectInput,
  ProjectSummary,
} from "../types/projects";
import type {
  Tag,
  TaskDetail,
  TaskFilter,
  TaskInput,
  TaskStatus,
  TaskSummary,
} from "../types/tasks";

export const flowdeskApi = {
  dashboard: () => invoke<DashboardSummary>("get_dashboard_summary"),
  tasks: (filter: TaskFilter) => invoke<TaskSummary[]>("list_tasks", { filter }),
  task: (taskId: string) => invoke<TaskDetail>("get_task", { taskId }),
  tags: () => invoke<Tag[]>("list_tags"),
  createTask: (input: TaskInput) => invoke<TaskDetail>("create_task", { input }),
  updateTask: (taskId: string, input: TaskInput) =>
    invoke<TaskDetail>("update_task", { taskId, input }),
  setTaskStatus: (taskId: string, status: TaskStatus) =>
    invoke<TaskDetail>("set_task_status", { taskId, status }),
  deleteTask: (taskId: string) => invoke<void>("delete_task", { taskId }),
  addSubtask: (taskId: string, title: string) =>
    invoke<TaskDetail>("add_subtask", { taskId, title }),
  updateSubtask: (subtaskId: string, changes: { title?: string; isCompleted?: boolean }) =>
    invoke<TaskDetail>("update_subtask", {
      subtaskId,
      title: changes.title ?? null,
      isCompleted: changes.isCompleted ?? null,
    }),
  deleteSubtask: (subtaskId: string) => invoke<TaskDetail>("delete_subtask", { subtaskId }),
  linkTaskNote: (taskId: string, noteId: string, linked: boolean) =>
    invoke<TaskDetail>("link_task_note", { taskId, noteId, linked }),
  projects: (includeArchived = false) =>
    invoke<ProjectSummary[]>("list_projects", { includeArchived }),
  project: (projectId: string) => invoke<ProjectSummary>("get_project", { projectId }),
  createProject: (input: ProjectInput) => invoke<ProjectSummary>("create_project", { input }),
  updateProject: (projectId: string, input: ProjectInput) =>
    invoke<ProjectSummary>("update_project", { projectId, input }),
  archiveProject: (projectId: string, archived: boolean) =>
    invoke<ProjectSummary>("archive_project", { projectId, archived }),
  deleteProject: (projectId: string, mode: ProjectDeleteMode) =>
    invoke<void>("delete_project", { projectId, mode }),
  timer: () => invoke<TimerSnapshot>("get_timer_state"),
  startPomodoro: (input: StartPomodoroInput) => invoke<TimerSnapshot>("start_pomodoro", { input }),
  pausePomodoro: () => invoke<TimerSnapshot>("pause_pomodoro"),
  resumePomodoro: () => invoke<TimerSnapshot>("resume_pomodoro"),
  stopPomodoro: () => invoke<TimerSnapshot>("stop_pomodoro"),
  togglePomodoro: () => invoke<TimerSnapshot>("toggle_pomodoro"),
  startTimeEntry: (input: EntryInput) => invoke<TimerSnapshot>("start_time_entry", { input }),
  pauseTimeEntry: () => invoke<TimerSnapshot>("pause_time_entry"),
  resumeTimeEntry: () => invoke<TimerSnapshot>("resume_time_entry"),
  stopTimeEntry: () => invoke<TimerSnapshot>("stop_time_entry"),
  pomodoroSettings: () => invoke<PomodoroSettings>("get_pomodoro_settings"),
  updatePomodoroSettings: (settings: PomodoroSettings) =>
    invoke<TimerSnapshot>("update_pomodoro_settings", { settings }),
  timeStats: () => invoke<TimeStats>("get_time_stats"),
  timeEntries: (range: "today" | "week") => invoke<TimeEntry[]>("list_time_entries", { range }),
  focusSessions: () => invoke<FocusSession[]>("list_focus_sessions"),
  updateTimeEntry: (entryId: string, input: EntryInput) =>
    invoke<TimerSnapshot>("update_time_entry", { entryId, input }),
  deleteTimeEntry: (entryId: string) => invoke<TimerSnapshot>("delete_time_entry", { entryId }),
  openMain: (section?: "dashboard" | "tasks" | "projects" | "notes" | "focus" | "time" | "calendar" | "settings") =>
    invoke<void>("open_main_window", { section: section ?? null }),
  hideTrayPanel: () => invoke<void>("hide_tray_panel"),
  quit: () => invoke<void>("quit_flowdesk"),
  trayPreferences: () =>
    invoke<TrayPreferences>("get_tray_preferences"),
  updateTrayPreferences: (preferences: TrayPreferences) =>
    invoke<TrayPreferences>("update_tray_preferences", preferences),
  createNote: () => invoke<Note>("create_note"),
  note: (noteId: string) => invoke<Note>("get_note", { noteId }),
  notes: (includeArchived = false) =>
    invoke<Note[]>("list_notes", { includeArchived }),
  updateNote: (note: Pick<Note, "id" | "title" | "content" | "color" | "reminderAt" | "projectId"> & { opacity: number; fontSize: number }) =>
    invoke<Note>("update_note", {
      input: {
        noteId: note.id,
        title: note.title,
        content: note.content,
        color: note.color,
        opacity: note.opacity,
        fontSize: note.fontSize,
        reminderAt: note.reminderAt,
        projectId: note.projectId,
      },
    }),
  setNoteDisplayMode: (noteId: string, displayMode: Note["window"]["displayMode"]) =>
    invoke<Note>("set_note_display_mode", { noteId, displayMode }),
  setNoteCollapsed: (noteId: string, collapsed: boolean) =>
    invoke<Note>("set_note_collapsed", { noteId, collapsed }),
  showNote: (noteId: string) => invoke<Note>("show_note_window", { noteId }),
  hideNote: (noteId: string) => invoke<void>("hide_note_window", { noteId }),
  archiveNote: (noteId: string, archived: boolean) =>
    invoke<Note>("archive_note", { noteId, archived }),
  deleteNote: (noteId: string) => invoke<void>("delete_note", { noteId }),
  shortcutStatus: () => invoke<ShortcutStatus[]>("get_shortcut_status"),
};
