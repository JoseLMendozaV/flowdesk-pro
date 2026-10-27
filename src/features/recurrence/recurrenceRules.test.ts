import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecurrenceRule } from "../../types/recurrence";
import { normalizeSearch, matchesQuery } from "../palette/paletteSearch.ts";
import { describeRecurrence, followStart, isoWeekday, presetOf, ruleForPreset } from "./recurrenceRules.ts";

// Lunes 2 de marzo de 2026 a las 9:00 locales.
const monday = Math.floor(new Date(2026, 2, 2, 9).getTime() / 1000);
const wednesday = Math.floor(new Date(2026, 2, 4, 9).getTime() / 1000);

function rule(overrides: Partial<RecurrenceRule>): RecurrenceRule {
  return { frequency: "daily", interval: 1, weekdays: [], fromCompletion: false, until: null, ...overrides };
}

test("las opciones del menú y las reglas se corresponden", () => {
  assert.equal(isoWeekday(monday), 1);
  for (const preset of ["none", "daily", "weekdays", "weekly", "monthly", "yearly"] as const) {
    assert.equal(presetOf(ruleForPreset(preset, monday, null), monday), preset);
  }
  assert.equal(presetOf(rule({ interval: 2 }), monday), "custom");
  assert.equal(presetOf(rule({ fromCompletion: true }), monday), "custom");
  assert.equal(presetOf(rule({ frequency: "weekly", weekdays: [1, 3] }), monday), "custom");
});

test("describe la regla en español", () => {
  assert.equal(describeRecurrence(rule({}), monday), "Cada día");
  assert.equal(describeRecurrence(rule({ frequency: "weekly", weekdays: [1, 2, 3, 4, 5] }), monday), "Los días laborables (de lunes a viernes)");
  assert.equal(describeRecurrence(rule({ frequency: "weekly", interval: 2, weekdays: [1, 3] }), monday), "Cada 2 semanas los lunes y miércoles");
  assert.equal(describeRecurrence(rule({ frequency: "monthly", dayOfMonth: 31 }), monday), "Cada mes el día 31");
  assert.equal(describeRecurrence(rule({ interval: 3, fromCompletion: true }), monday), "3 días después de completarla");
  assert.equal(describeRecurrence(rule({ frequency: "weekly", fromCompletion: true }), monday), "Una semana después de completarla");
  assert.match(describeRecurrence(rule({ until: monday + 7 * 86_400 }), monday), /^Cada día, hasta el 9 mar 2026$/);
});

test("la regla semanal sigue al nuevo día", () => {
  const weekly = rule({ frequency: "weekly", weekdays: [1] });
  assert.deepEqual(followStart(weekly, monday, wednesday)?.weekdays, [3]);
  const several = rule({ frequency: "weekly", weekdays: [1, 5] });
  assert.equal(followStart(several, monday, wednesday), several);
});

test("la paleta ignora tildes, mayúsculas y orden de palabras", () => {
  const query = normalizeSearch("  Menu CLASE ");
  assert.ok(matchesQuery(query, "Clase de programación · Menú"));
  assert.ok(!matchesQuery(query, "Clase de programación"));
  assert.ok(matchesQuery(normalizeSearch("programacion"), "Programación"));
});

test("nombres cortos de materias para el horario por bloques", async () => {
  const { shortCourseName } = await import("../teaching/lib/timeBlocks.ts");
  assert.equal(shortCourseName("Desarrollo de Software VIII"), "DS VIII");
  assert.equal(shortCourseName("Desarrollo de Software V"), "DS V");
  assert.equal(shortCourseName("Cálculo"), "Cálculo");
  assert.equal(shortCourseName("Bases de Datos 2"), "BD 2");
});
