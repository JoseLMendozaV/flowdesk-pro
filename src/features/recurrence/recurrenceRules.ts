import type { RecurrenceFrequency, RecurrenceRule } from "../../types/recurrence";

export type RecurrencePreset = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

const WORKDAYS = [1, 2, 3, 4, 5];
export const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
export const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

const dayMonthFormatter = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long" });
const untilFormatter = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });

/** 1 = lunes … 7 = domingo, como en Rust. */
export function isoWeekday(timestamp: number) {
  return ((new Date(timestamp * 1000).getDay() + 6) % 7) + 1;
}

function plain(frequency: RecurrenceFrequency, weekdays: number[] = []): RecurrenceRule {
  return { frequency, interval: 1, weekdays, fromCompletion: false, until: null };
}

export function ruleForPreset(preset: RecurrencePreset, start: number | null, current: RecurrenceRule | null): RecurrenceRule | null {
  switch (preset) {
    case "none":
      return null;
    case "daily":
      return plain("daily");
    case "weekdays":
      return plain("weekly", WORKDAYS);
    case "weekly":
      return plain("weekly", start ? [isoWeekday(start)] : []);
    case "monthly":
      return plain("monthly");
    case "yearly":
      return plain("yearly");
    case "custom":
      return current ?? plain("weekly", start ? [isoWeekday(start)] : []);
  }
}

function sameDays(left: number[], right: number[]) {
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

/** Qué opción del menú corresponde a una regla; lo que no encaja en ninguna es «personalizada». */
export function presetOf(rule: RecurrenceRule | null, start: number | null): RecurrencePreset {
  if (!rule) return "none";
  if (rule.interval !== 1 || rule.fromCompletion || rule.until !== null) return "custom";
  const days = [...rule.weekdays].sort((left, right) => left - right);
  switch (rule.frequency) {
    case "daily":
      return "daily";
    case "weekly":
      if (sameDays(days, WORKDAYS)) return "weekdays";
      if (days.length === 0 || (start !== null && sameDays(days, [isoWeekday(start)]))) return "weekly";
      return "custom";
    default:
      return rule.frequency;
  }
}

const units: Record<RecurrenceFrequency, [string, string]> = {
  daily: ["día", "días"],
  weekly: ["semana", "semanas"],
  monthly: ["mes", "meses"],
  yearly: ["año", "años"],
};

export function unitLabel(frequency: RecurrenceFrequency, interval: number) {
  return units[frequency][interval === 1 ? 0 : 1];
}

function listDays(days: number[]) {
  const names = days.map((day) => WEEKDAY_NAMES[day - 1]);
  if (names.length === 1) return `el ${names[0]}`;
  return `los ${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** «Cada semana el lunes y miércoles», «3 días después de completarla, hasta el 12 mar 2026»… */
export function describeRecurrence(rule: RecurrenceRule, start: number | null): string {
  const { frequency, interval } = rule;
  const every = interval === 1 ? `Cada ${unitLabel(frequency, 1)}` : `Cada ${interval} ${unitLabel(frequency, interval)}`;
  let text: string;
  if (rule.fromCompletion) {
    text = `${interval === 1 ? `Un${frequency === "weekly" ? "a" : ""} ${unitLabel(frequency, 1)}` : `${interval} ${unitLabel(frequency, interval)}`} después de completarla`;
  } else if (frequency === "weekly") {
    const days = [...rule.weekdays].sort((left, right) => left - right);
    if (interval === 1 && sameDays(days, WORKDAYS)) text = "Los días laborables (de lunes a viernes)";
    else if (days.length > 0) text = `${every} ${listDays(days)}`;
    else text = start ? `${every} ${listDays([isoWeekday(start)])}` : every;
  } else if (frequency === "monthly" && start) {
    const day = rule.dayOfMonth ?? new Date(start * 1000).getDate();
    text = `${every} el día ${day}`;
  } else if (frequency === "yearly" && start) {
    text = `${every} el ${dayMonthFormatter.format(new Date(start * 1000))}`;
  } else {
    text = every;
  }
  if (rule.until !== null) text += `, hasta el ${untilFormatter.format(new Date(rule.until * 1000))}`;
  return text;
}

/** Último segundo del día local de `date` (YYYY-MM-DD), para `until`. */
export function endOfDayUnix(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(new Date(year, month - 1, day, 23, 59, 59).getTime() / 1000);
}

/** Si la regla semanal usaba el día de la fecha anterior, pasa al de la nueva. */
export function followStart(rule: RecurrenceRule | null, previous: number | null, next: number | null): RecurrenceRule | null {
  if (!rule || rule.frequency !== "weekly" || previous === null || next === null) return rule;
  if (rule.weekdays.length === 1 && rule.weekdays[0] === isoWeekday(previous)) return { ...rule, weekdays: [isoWeekday(next)] };
  return rule;
}
