import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEvent, CalendarTask } from "../../types/calendar";
import { DEFAULT_TASK_MINUTES, placeDayItems } from "./calendarDates.ts";

const day = new Date(2026, 9, 26);
const at = (hour: number, minute = 0) => Math.floor(new Date(2026, 9, 26, hour, minute).getTime() / 1000);

function task(id: string, dueAt: number, dueHasTime: boolean, estimatedMinutes: number | null = null): CalendarTask {
  return { id, title: id, status: "pending", priority: "none", dueAt, dueHasTime, projectColor: null, estimatedMinutes };
}

function event(id: string, startsAt: number, endsAt: number): CalendarEvent {
  return { id, title: id, description: "", projectId: null, projectName: null, projectColor: null, startsAt, endsAt, isAllDay: false, location: null, reminderMinutes: null };
}

test("una tarea con hora ocupa su hora y su tiempo estimado", () => {
  const [item] = placeDayItems([], [task("t", at(11), true, 90)], day, 720);
  assert.equal(item.kind, "task");
  assert.equal(item.top, 11 * 60);
  assert.equal(item.height, 90);
  assert.equal(item.kind === "task" && item.defaultTime, false);
});

test("sin estimación ocupa 30 minutos", () => {
  const [item] = placeDayItems([], [task("t", at(17, 30), true)], day, 720);
  assert.equal(item.height, DEFAULT_TASK_MINUTES);
});

test("una tarea sin hora va a la hora por defecto, o a todo el día con null", () => {
  // Las tareas sin hora se guardan a mediodía; se colocan donde diga la preferencia.
  const untimed = task("t", at(12), false, 60);
  const [item] = placeDayItems([], [untimed], day, 9 * 60);
  assert.equal(item.top, 9 * 60);
  assert.equal(item.kind === "task" && item.defaultTime, true);
  assert.deepEqual(placeDayItems([], [untimed], day, null), []);
});

test("tareas y eventos que coinciden se reparten el ancho", () => {
  const items = placeDayItems([event("clase", at(9), at(11))], [task("t", at(10), true, 120), task("luego", at(15), true)], day, null);
  const byId = Object.fromEntries(items.map((item) => [item.kind === "event" ? item.event.id : item.task.id, item]));
  assert.equal(byId.clase.columns, 2);
  assert.equal(byId.t.columns, 2);
  assert.notEqual(byId.clase.column, byId.t.column);
  assert.equal(byId.luego.columns, 1, "lo que no coincide usa todo el ancho");
});

test("una tarea al final del día no se sale de la cuadrícula", () => {
  const [item] = placeDayItems([], [task("t", at(23, 50), true, 120)], day, null);
  assert.ok(item.top + item.height <= 24 * 60);
});
