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
};

export type ShortcutStatus = {
  id: string;
  label: string;
  keys: string;
  registered: boolean;
  error: string | null;
};
