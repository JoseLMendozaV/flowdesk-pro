// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

/** Franja semanal del horario. `weekday`: 1 = lunes … 7 = domingo; horas `HH:MM`. */
export type ScheduleKind = "class" | "theory" | "lab";

export type ScheduleSlot = {
  id: number;
  courseId: number;
  kind: ScheduleKind;
  courseTitle: string;
  groupName: string;
  color: string;
  weekday: number;
  startTime: string;
  endTime: string;
  room: string;
  startsOn: string;
  endsOn: string;
  reminderMinutes: number | null;
  /** La clase está en el calendario (no se borró desde allí). */
  inCalendar: boolean;
};

export type ScheduleSlotInput = Omit<ScheduleSlot, "id" | "courseTitle" | "groupName" | "color" | "inCalendar"> & {
  id: number | null;
};

export type GenerateSessionsResult = { created: number; updated: number };

/**
 * Bloques horarios de la institución: `count` bloques de `minutes` minutos desde `first`
 * (`HH:MM`), con `gap` minutos entre uno y otro.
 */
export type TimeBlocks = { first: string; minutes: number; gap: number; count: number };
