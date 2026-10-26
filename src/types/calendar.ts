import type { TaskPriority, TaskStatus } from "./tasks";

/** Los eventos de todo el día terminan a medianoche del día siguiente al último (fin exclusivo). */
export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  startsAt: number;
  endsAt: number;
  isAllDay: boolean;
  location: string | null;
  reminderMinutes: number | null;
};

export type EventInput = {
  title: string;
  description: string;
  projectId: string | null;
  startsAt: number;
  endsAt: number;
  isAllDay: boolean;
  location: string | null;
  reminderMinutes: number | null;
};

export type CalendarTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: number;
  dueHasTime: boolean;
  projectColor: string | null;
  /** Duración del bloque en la cuadrícula; sin estimación ocupa 30 minutos. */
  estimatedMinutes: number | null;
};

export type CalendarRange = {
  events: CalendarEvent[];
  tasks: CalendarTask[];
};

export type CalendarMode = "day" | "week" | "month";

/** Horas en minutos desde la medianoche local. */
export type ReminderSettings = {
  enabled: boolean;
  taskLeadMinutes: number;
  dailyDigest: boolean;
  digestMinute: number;
  quietHours: boolean;
  quietStart: number;
  quietEnd: number;
};

export type ReminderItem = {
  id: string;
  entityType: "task" | "note" | "event";
  entityId: string;
  title: string;
  remindAt: number;
  status: "scheduled" | "delivered" | "silenced";
};
