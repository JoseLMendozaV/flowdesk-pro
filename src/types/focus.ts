export type SessionType = "focus" | "short_break" | "long_break";

export type PomodoroSettings = {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  notifications: boolean;
};

export type WorkContext = {
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
};

export type ActivePomodoro = WorkContext & {
  id: string;
  sessionType: SessionType;
  status: "running" | "paused";
  plannedSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  startedAt: number;
  expectedEndAt: number | null;
};

export type ActiveEntry = WorkContext & {
  id: string;
  status: "running" | "paused";
  elapsedSeconds: number;
  startedAt: number;
  description: string;
};

export type TimerSnapshot = {
  pomodoro: ActivePomodoro | null;
  entry: ActiveEntry | null;
  nextSessionType: SessionType;
  cyclePosition: number;
  focusCompletedToday: number;
  settings: PomodoroSettings;
  asOfMs: number;
};

export type StartPomodoroInput = {
  sessionType: SessionType;
  minutes?: number | null;
  taskId?: string | null;
  projectId?: string | null;
};

export type EntryInput = {
  taskId?: string | null;
  projectId?: string | null;
  description?: string;
};

export type TimeEntry = WorkContext & {
  id: string;
  source: "manual" | "pomodoro" | "automatic";
  status: "running" | "paused" | "completed";
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number;
  description: string;
};

export type FocusSession = WorkContext & {
  id: string;
  sessionType: SessionType;
  status: "running" | "paused" | "completed" | "cancelled";
  plannedSeconds: number;
  elapsedSeconds: number;
  startedAt: number;
  completedAt: number | null;
};

export type DayStat = { dayStart: number; trackedSeconds: number; focusSeconds: number };

export type ProjectTime = {
  projectId: string | null;
  name: string | null;
  color: string | null;
  seconds: number;
};

export type TimeStats = {
  weekStart: number;
  days: DayStat[];
  todayTrackedSeconds: number;
  todayFocusSeconds: number;
  weekTrackedSeconds: number;
  weekFocusSeconds: number;
  focusSessionsToday: number;
  projects: ProjectTime[];
};
