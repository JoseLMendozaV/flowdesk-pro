export type DashboardTask = {
  id: string;
  title: string;
  priority: "none" | "low" | "medium" | "high" | "urgent";
  dueAt: number | null;
  dueHasTime: boolean;
  projectColor: string | null;
};

export type DashboardNote = {
  id: string;
  title: string;
  preview: string;
  color: string;
  updatedAt: number;
};

export type UpcomingEvent = {
  id: string;
  title: string;
  startsAt: number;
  isAllDay: boolean;
};

export type ActiveTimer = {
  id: string;
  status: "running" | "paused";
  sessionType: "focus" | "short_break" | "long_break";
  plannedSeconds: number;
  elapsedSeconds: number;
  startedAt: number;
  expectedEndAt: number | null;
};

export type DashboardSummary = {
  todayTasks: number;
  overdueTasks: number;
  completedToday: number;
  activeProjects: number;
  focusSecondsToday: number;
  trackedSecondsToday: number;
  completionPercent: number;
  upcomingTasks: DashboardTask[];
  recentNotes: DashboardNote[];
  nextEvent: UpcomingEvent | null;
  activeTimer: ActiveTimer | null;
};

export type TrayPreferences = {
  launchAtLogin: boolean;
  launchHidden: boolean;
  /** Minutos antes de un evento en que se anuncia junto al icono; 0 = nunca. */
  nextEventMinutes: number;
};

export type NoteWindow = {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  expandedHeight: number;
  opacity: number;
  fontSize: number;
  displayMode: "normal" | "always_on_top" | "desktop";
  isCollapsed: boolean;
  isVisible: boolean;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  color: string;
  projectId: string | null;
  reminderAt: number | null;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
  window: NoteWindow;
  /** `markdown`: nota anterior a la versión 2, aún sin convertir. */
  contentFormat: "markdown" | "rich-v1";
  /** Documento del editor (solo al abrir una nota; los listados no lo incluyen). */
  contentJson: string | null;
  revision: number;
  pinnedGlobal: boolean;
  links: NoteLinks;
};

export type NoteLinks = {
  taskIds: string[];
  workspaceIds: string[];
  eventIds: string[];
  attachmentCount: number;
  checklistTotal: number;
  checklistDone: number;
};

export type ShortcutStatus = {
  id: string;
  label: string;
  keys: string;
  registered: boolean;
  error: string | null;
};
