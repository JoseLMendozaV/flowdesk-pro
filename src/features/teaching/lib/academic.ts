import type { AcademicDay, AcademicDayKind, CalendarChange, GenerateSessionsResult } from "../types";

export const academicKinds: Record<AcademicDayKind, { label: string; cancels: boolean }> = {
  holiday: { label: "Feriado", cancels: true },
  break: { label: "Día libre", cancels: true },
  exams: { label: "Exámenes", cancels: true },
  term: { label: "Periodo de clases", cancels: false },
  deadline: { label: "Fecha límite", cancels: false },
};

export const academicSources: Record<AcademicDay["source"], string> = {
  panama: "Panamá",
  utp: "UTP",
  user: "Añadido",
};

/** Fecha local `AAAA-MM-DD` de hoy. */
export function todayIso() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parse(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** «mar 3 nov» o «7 – 22 dic» para un día o un periodo. */
export function rangeLabel(from: string, until: string) {
  const start = parse(from);
  if (from === until) return start.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  const end = parse(until);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const first = start.toLocaleDateString("es-ES", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  return `${first} – ${end.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`;
}

/** «Martes 3 de noviembre» de una fecha `AAAA-MM-DD`. */
export function longDate(value: string) {
  const text = parse(value).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Periodo de clases en curso o el siguiente, para proponer las fechas del horario. */
export function currentTerm(days: AcademicDay[], today = todayIso()) {
  const terms = days.filter((day) => day.kind === "term" && day.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return terms[0] ?? null;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Resumen de lo que hizo un cambio del calendario académico en la asistencia. */
export function changeMessage(change: CalendarChange, lead: string) {
  const parts = [lead];
  if (change.removedSessions) parts.push(`Se quitaron ${plural(change.removedSessions, "sesión vacía", "sesiones vacías")} de días sin clases.`);
  if (change.restoredSessions) parts.push(`${plural(change.restoredSessions, "sesión vuelve", "sesiones vuelven")} a la asistencia.`);
  if (change.keptSessions) parts.push(`${plural(change.keptSessions, "sesión en día sin clases se conserva", "sesiones en días sin clases se conservan")} porque ya tiene asistencia.`);
  return parts.join(" ");
}

/** Resultado de crear las sesiones de asistencia desde el horario. */
export function sessionsMessage(result: GenerateSessionsResult) {
  const skipped = result.skipped ? ` ${plural(result.skipped, "día sin clases se omite", "días sin clases se omiten")} (calendario académico).` : "";
  if (result.created || result.updated) return `Sesiones desde el horario: ${result.created} nuevas y ${result.updated} con su hora.${skipped}`;
  return `Todas las clases del horario ya tienen su sesión.${skipped}`;
}
