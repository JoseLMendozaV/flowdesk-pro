import type { CalendarEvent, CalendarMode, CalendarTask } from "../../types/calendar";

export const DAY_MINUTES = 24 * 60;

export function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Suma días de calendario: conserva la hora local aunque cambie el horario de verano. */
export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Las semanas empiezan en lunes. */
export function startOfWeek(date: Date) {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function unix(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

export function fromUnix(timestamp: number) {
  return new Date(timestamp * 1000);
}

/** Días visibles para cada vista. El mes ocupa siempre seis semanas completas. */
export function visibleDays(mode: CalendarMode, anchor: Date) {
  if (mode === "day") return [startOfDay(anchor)];
  if (mode === "week") {
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }
  const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

export function shiftAnchor(mode: CalendarMode, anchor: Date, direction: -1 | 1) {
  if (mode === "day") return addDays(anchor, direction);
  if (mode === "week") return addDays(anchor, 7 * direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

const monthTitle = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function rangeTitle(mode: CalendarMode, anchor: Date) {
  if (mode === "month") return capitalize(monthTitle.format(anchor));
  if (mode === "day") return capitalize(dayTitle.format(anchor));
  const days = visibleDays("week", anchor);
  const last = days[6];
  return `${shortDay.format(days[0])} – ${shortDay.format(last)} ${last.getFullYear()}`;
}

export function eventsOnDay(events: CalendarEvent[], day: Date) {
  const start = unix(startOfDay(day));
  const end = unix(addDays(startOfDay(day), 1));
  return events.filter((event) => event.startsAt < end && event.endsAt > start);
}

export function tasksOnDay(tasks: CalendarTask[], day: Date) {
  return tasks.filter((task) => sameDay(fromUnix(task.dueAt), day));
}

/** Duración de una tarea en la cuadrícula si no tiene tiempo estimado. */
export const DEFAULT_TASK_MINUTES = 30;

type Placed = {
  /** Minutos desde la medianoche, recortados al día. */
  top: number;
  height: number;
  column: number;
  columns: number;
};

export type PlacedItem = Placed &
  (
    | { kind: "event"; event: CalendarEvent }
    /** `defaultTime`: tarea sin hora colocada en la hora por defecto elegida. */
    | { kind: "task"; task: CalendarTask; defaultTime: boolean }
  );

/**
 * Reparte en columnas los elementos que se solapan; cada grupo de solapamientos usa
 * tantas columnas como necesite.
 */
function layoutColumns<T extends Placed>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.height - a.height);
  let group: T[] = [];
  let groupEnd = -1;
  const closeGroup = () => {
    const columns = Math.max(1, ...group.map((item) => item.column + 1));
    group.forEach((item) => (item.columns = columns));
    group = [];
  };
  for (const item of sorted) {
    if (item.top >= groupEnd) {
      closeGroup();
      groupEnd = -1;
    }
    const used = new Set(group.filter((other) => other.top + other.height > item.top).map((other) => other.column));
    let column = 0;
    while (used.has(column)) column += 1;
    item.column = column;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.top + item.height);
  }
  closeGroup();
  return sorted;
}

/**
 * Eventos con hora y tareas de un día en la cuadrícula horaria. Las tareas con hora van
 * a su hora; las que no la tienen, a `untimedMinute` (o a la franja de todo el día si es
 * `null`). Cada tarea ocupa su tiempo estimado.
 */
export function placeDayItems(events: CalendarEvent[], tasks: CalendarTask[], day: Date, untimedMinute: number | null): PlacedItem[] {
  const dayStart = startOfDay(day).getTime() / 1000;
  const items: PlacedItem[] = events
    .filter((event) => !event.isAllDay)
    .map((event) => {
      const top = Math.max(0, (event.startsAt - dayStart) / 60);
      const bottom = Math.min(DAY_MINUTES, (event.endsAt - dayStart) / 60);
      return { kind: "event" as const, event, top, height: Math.max(bottom - top, 15), column: 0, columns: 1 };
    });
  for (const task of tasks) {
    if (!task.dueHasTime && untimedMinute === null) continue;
    const due = fromUnix(task.dueAt);
    const start = task.dueHasTime ? due.getHours() * 60 + due.getMinutes() : (untimedMinute ?? 0);
    const top = Math.min(start, DAY_MINUTES - 15);
    const length = Math.max(15, task.estimatedMinutes ?? DEFAULT_TASK_MINUTES);
    items.push({ kind: "task", task, defaultTime: !task.dueHasTime, top, height: Math.min(length, DAY_MINUTES - top), column: 0, columns: 1 });
  }
  return layoutColumns(items);
}

export function minutesLabel(minutes: number) {
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}
