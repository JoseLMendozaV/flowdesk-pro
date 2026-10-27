import { invoke } from "@tauri-apps/api/core";
import type {
  CalendarEvent,
  CalendarRange,
  EventInput,
  EventScope,
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
  OnboardingEvent,
  OnboardingMode,
  OnboardingPreferences,
  OnboardingState,
} from "../types/onboarding";
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
import type {
  NoteAttachment,
  NoteContextKind,
  NoteContexts,
  NoteVersion,
  NoteVersionSummary,
} from "../types/notes";
import type { BackupEntry, BackupOverview } from "../types/backups";
import type { RestoredItem, TrashItem } from "../types/trash";
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
  /** Devuelve el elemento de la papelera, para deshacer. */
  deleteTask: (taskId: string) => invoke<string>("delete_task", { taskId }),
  skipTaskOccurrence: (taskId: string) => invoke<TaskDetail>("skip_task_occurrence", { taskId }),
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
    invoke<string>("delete_project", { projectId, mode }),
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
  /** En un evento que se repite, `occurrenceStart` es el inicio original de la repetición editada. */
  updateEvent: (eventId: string, input: EventInput, scope?: EventScope, occurrenceStart?: number) =>
    invoke<CalendarEvent>("update_event", { eventId, input, scope: scope ?? null, occurrenceStart: occurrenceStart ?? null }),
  deleteEvent: (eventId: string, scope?: EventScope, occurrenceStart?: number) =>
    invoke<string>("delete_event", { eventId, scope: scope ?? null, occurrenceStart: occurrenceStart ?? null }),
  trash: () => invoke<TrashItem[]>("list_trash"),
  restoreTrashItem: (itemId: string) => invoke<RestoredItem>("restore_trash_item", { itemId }),
  deleteTrashItem: (itemId: string) => invoke<void>("delete_trash_item", { itemId }),
  emptyTrash: () => invoke<void>("empty_trash"),
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
  onboarding: () => invoke<OnboardingState>("get_onboarding_state"),
  updateOnboardingPreferences: (preferences: OnboardingPreferences) =>
    invoke<OnboardingState>("update_onboarding_preferences", { preferences }),
  recordOnboardingStep: (stepId: string | null) => invoke<void>("record_onboarding_step", { stepId }),
  finishWelcome: (outcome: "completed" | "skipped") =>
    invoke<OnboardingState>("finish_welcome_onboarding", { outcome }),
  markFeaturesSeen: (features: Record<string, number>, revision: string) =>
    invoke<OnboardingState>("mark_features_seen", { features, revision }),
  recordOnboardingEvent: (event: OnboardingEvent, detail?: string) =>
    invoke<void>("record_onboarding_event", { event, detail: detail ?? null }),
  resetOnboarding: () => invoke<OnboardingState>("reset_onboarding"),
  openOnboarding: (mode: OnboardingMode, featureId?: string) =>
    invoke<void>("open_onboarding", { mode, featureId: featureId ?? null }),
  closeOnboarding: () => invoke<void>("close_onboarding"),
  /** Con `returnMode`, la guía vuelve a abrirse en esa función al terminar la visita. */
  startGuidedTour: (featureId?: string, returnMode?: OnboardingMode) =>
    invoke<void>("start_guided_tour", { featureId: featureId ?? null, returnMode: returnMode ?? null }),
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
  /**
   * Con `contentJson` guarda el documento enriquecido; Rust deriva `content`. Con
   * `baseRevision`, falla con `NOTE_CONFLICT` si otra ventana guardó antes.
   */
  updateNote: (
    note: Pick<Note, "id" | "title" | "content" | "color" | "reminderAt" | "projectId"> & {
      opacity: number;
      fontSize: number;
      contentJson?: string | null;
      baseRevision?: number | null;
    },
  ) =>
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
        contentJson: note.contentJson ?? null,
        baseRevision: note.baseRevision ?? null,
        source: "note",
      },
    }),
  noteVersions: (noteId: string) => invoke<NoteVersionSummary[]>("list_note_versions", { noteId }),
  noteVersion: (versionId: string) => invoke<NoteVersion>("get_note_version", { versionId }),
  restoreNoteVersion: (noteId: string, versionId: string, reason: "before-restore" | "conflict" = "before-restore") =>
    invoke<Note>("restore_note_version", { noteId, versionId, reason }),
  saveNoteConflictCopy: (noteId: string, title: string, contentJson: string) =>
    invoke<void>("save_note_conflict_copy", { noteId, title, contentJson }),
  preserveNoteVersion: (noteId: string) => invoke<void>("preserve_note_version", { noteId }),
  setNotePinnedGlobal: (noteId: string, pinned: boolean) =>
    invoke<Note>("set_note_pinned_global", { noteId, pinned }),
  /** Bytes en el cuerpo de la petición: sin conversión a JSON. */
  addNoteAttachment: (noteId: string, fileName: string, bytes: Uint8Array) =>
    invoke<NoteAttachment>("add_note_attachment", bytes, {
      headers: { "x-note-id": noteId, "x-file-name": encodeURIComponent(fileName) },
    }),
  attachNoteFiles: (noteId: string, paths: string[]) => invoke<NoteAttachment[]>("attach_note_files", { noteId, paths }),
  noteAttachments: (noteId: string) => invoke<NoteAttachment[]>("list_note_attachments", { noteId }),
  noteAttachmentData: (attachmentId: string) => invoke<ArrayBuffer>("get_note_attachment_data", { attachmentId }),
  openNoteAttachment: (attachmentId: string) => invoke<void>("open_note_attachment", { attachmentId }),
  deleteNoteAttachment: (attachmentId: string) => invoke<void>("delete_note_attachment", { attachmentId }),
  openNoteLink: (url: string) => invoke<void>("open_note_link", { url }),
  noteContexts: (noteId: string) => invoke<NoteContexts>("get_note_contexts", { noteId }),
  setNoteContext: (noteId: string, kind: NoteContextKind, entityId: string, linked: boolean) =>
    invoke<NoteContexts>("set_note_context", { noteId, kind, entityId, linked }),
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
  backups: () => invoke<BackupOverview>("get_backups"),
  updateBackupSettings: (folder: string | null, enabled: boolean, keep: number) =>
    invoke<BackupOverview>("update_backup_settings", { folder, enabled, keep }),
  backupNow: () => invoke<BackupEntry>("backup_now"),
  /** Deja lista la copia; después hay que reiniciar FlowDesk (`prepare_restart` + `relaunch`). */
  restoreBackup: (path: string) => invoke<void>("restore_backup", { path }),
  revealBackupFolder: () => invoke<void>("reveal_backup_folder"),
};
