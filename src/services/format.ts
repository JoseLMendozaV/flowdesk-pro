export function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes.toString().padStart(2, "0")} min`;
}

export function formatMinutes(minutes: number) {
  return formatDuration(minutes * 60);
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Las fechas sin hora se guardan a mediodía local para no cambiar de día con el horario de verano. */
export function noonUnix(date: Date) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return Math.floor(copy.getTime() / 1000);
}

export function noonTodayUnix() {
  return noonUnix(new Date());
}

const timeFormatter = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });
const weekdayFormatter = new Intl.DateTimeFormat("es-ES", { weekday: "long" });
const shortDateFormatter = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
const longDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatTime(timestamp: number) {
  return timeFormatter.format(new Date(timestamp * 1000));
}

export function formatDate(timestamp: number) {
  return longDateFormatter.format(new Date(timestamp * 1000));
}

export type DueInfo = { label: string; overdue: boolean; today: boolean };

export function describeDue(dueAt: number, hasTime: boolean, now = new Date()): DueInfo {
  const due = new Date(dueAt * 1000);
  const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000);
  let label: string;
  if (days === 0) label = "Hoy";
  else if (days === 1) label = "Mañana";
  else if (days === -1) label = "Ayer";
  else if (days > 1 && days < 7) label = weekdayFormatter.format(due);
  else label = due.getFullYear() === now.getFullYear() ? shortDateFormatter.format(due) : longDateFormatter.format(due);
  if (hasTime) label = `${label} · ${timeFormatter.format(due)}`;
  const overdue = days < 0 || (hasTime && due.getTime() < now.getTime());
  return { label: label.charAt(0).toUpperCase() + label.slice(1), overdue, today: days === 0 };
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function dateInputValue(timestamp: number | null) {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function timeInputValue(timestamp: number | null, hasTime: boolean) {
  if (!timestamp || !hasTime) return "";
  const date = new Date(timestamp * 1000);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convierte los valores de `<input type="date">` y `<input type="time">` en marca temporal local. */
export function timestampFromInputs(date: string, time: string): { dueAt: number | null; dueHasTime: boolean } {
  if (!date) return { dueAt: null, dueHasTime: false };
  const [year, month, day] = date.split("-").map(Number);
  if (!time) return { dueAt: noonUnix(new Date(year, month - 1, day)), dueHasTime: false };
  const [hours, minutes] = time.split(":").map(Number);
  return {
    dueAt: Math.floor(new Date(year, month - 1, day, hours, minutes).getTime() / 1000),
    dueHasTime: true,
  };
}

/** "Hoy · 10:00", o "Hoy · Todo el día" para eventos sin hora. */
export function describeEventStart(startsAt: number, isAllDay: boolean) {
  const label = describeDue(startsAt, !isAllDay).label;
  return isAllDay ? `${label} · Todo el día` : label;
}

export function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
