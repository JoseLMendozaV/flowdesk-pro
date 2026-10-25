import { invoke } from "@tauri-apps/api/core";
import type {
  CalendarEvent,
  CalendarRange,
  EventInput,
  ReminderItem,
  ReminderSettings,
} from "../types/calendar";
import type { AppTrackingSettings, AppUsageReport } from "../types/appTracking";
import type { ClipboardItem, ClipboardSettings } from "../types/clipboard";
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
import type { Workspace, WorkspaceInput, WorkspaceState } from "../types/workspaces";

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
  /** Proyectos del espacio activo, o de todos con `allWorkspaces`. */
  projects: (includeArchived = false, allWorkspaces = false) =>
    invoke<ProjectSummary[]>("list_projects", { includeArchived, allWorkspaces }),
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
  calendar: (start: number, end: number) => invoke<CalendarRange>("list_calendar", { start, end }),
  createEvent: (input: EventInput) => invoke<CalendarEvent>("create_event", { input }),
  updateEvent: (eventId: string, input: EventInput) =>
    invoke<CalendarEvent>("update_event", { eventId, input }),
  deleteEvent: (eventId: string) => invoke<void>("delete_event", { eventId }),
  reminderSettings: () => invoke<ReminderSettings>("get_reminder_settings"),
  updateReminderSettings: (settings: ReminderSettings) =>
    invoke<ReminderSettings>("update_reminder_settings", { settings }),
  reminders: () => invoke<ReminderItem[]>("list_reminders"),
  workspaces: () => invoke<WorkspaceState>("get_workspaces"),
  setActiveWorkspace: (workspaceId: string | null) =>
    invoke<WorkspaceState>("set_active_workspace", { workspaceId }),
  createWorkspace: (input: WorkspaceInput) => invoke<Workspace>("create_workspace", { input }),
  updateWorkspace: (workspaceId: string, input: WorkspaceInput) =>
    invoke<Workspace>("update_workspace", { workspaceId, input }),
  archiveWorkspace: (workspaceId: string, archived: boolean) =>
    invoke<Workspace>("archive_workspace", { workspaceId, archived }),
  deleteWorkspace: (workspaceId: string) => invoke<void>("delete_workspace", { workspaceId }),
  setWorkspaceProjects: (workspaceId: string, projectIds: string[]) =>
    invoke<Workspace>("set_workspace_projects", { workspaceId, projectIds }),
  setWorkspaceNotes: (workspaceId: string, noteIds: string[]) =>
    invoke<Workspace>("set_workspace_notes", { workspaceId, noteIds }),
  addWorkspaceResource: (workspaceId: string, kind: "folder" | "app", path: string) =>
    invoke<Workspace>("add_workspace_resource", { workspaceId, kind, path }),
  removeWorkspaceResource: (resourceId: string) =>
    invoke<void>("remove_workspace_resource", { resourceId }),
  openWorkspaceResources: (workspaceId: string, resourceId?: string) =>
    invoke<void>("open_workspace_resources", { workspaceId, resourceId: resourceId ?? null }),
  clipboardSettings: () => invoke<ClipboardSettings>("get_clipboard_settings"),
  updateClipboardSettings: (settings: ClipboardSettings) =>
    invoke<ClipboardSettings>("update_clipboard_settings", { settings }),
  clipboard: (search: string, favoritesOnly: boolean) =>
    invoke<ClipboardItem[]>("list_clipboard", { search: search || null, favoritesOnly }),
  copyClipboardItem: (itemId: string) => invoke<void>("copy_clipboard_item", { itemId }),
  setClipboardFavorite: (itemId: string, favorite: boolean) =>
    invoke<void>("set_clipboard_favorite", { itemId, favorite }),
  deleteClipboardItem: (itemId: string) => invoke<void>("delete_clipboard_item", { itemId }),
  clearClipboard: () => invoke<void>("clear_clipboard"),
  clipboardImage: (itemId: string) => invoke<ArrayBuffer>("get_clipboard_image", { itemId }),
  excludeClipboardApp: (path: string) => invoke<ClipboardSettings>("exclude_clipboard_app", { path }),
  appTrackingSettings: () => invoke<AppTrackingSettings>("get_app_tracking_settings"),
  updateAppTrackingSettings: (settings: AppTrackingSettings) =>
    invoke<AppTrackingSettings>("update_app_tracking_settings", { settings }),
  appUsage: () => invoke<AppUsageReport>("get_app_usage"),
  excludeTrackingApp: (path: string) => invoke<AppTrackingSettings>("exclude_tracking_app", { path }),
  clearAppTracking: () => invoke<void>("clear_app_tracking"),
  openMain: (section?: "dashboard" | "tasks" | "projects" | "notes" | "focus" | "time" | "calendar" | "workspaces" | "clipboard" | "settings") =>
    invoke<void>("open_main_window", { section: section ?? null }),
  hideTrayPanel: () => invoke<void>("hide_tray_panel"),
  quit: () => invoke<void>("quit_flowdesk"),
  trayPreferences: () =>
    invoke<TrayPreferences>("get_tray_preferences"),
  updateTrayPreferences: (preferences: TrayPreferences) =>
    invoke<TrayPreferences>("update_tray_preferences", preferences),
  createNote: () => invoke<Note>("create_note"),
  note: (noteId: string) => invoke<Note>("get_note", { noteId }),
  notes: (includeArchived = false, allWorkspaces = false) =>
    invoke<Note[]>("list_notes", { includeArchived, allWorkspaces }),
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
