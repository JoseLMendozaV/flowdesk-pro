import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURES } from "./features.ts";
import {
  availableFeatures,
  featureRevision,
  needsSetup,
  registryProblems,
  releaseNotes,
  revisionMap,
  tourSteps,
  whatsNew,
} from "./registry.ts";
import type { FeatureDefinition } from "./types.ts";

// Capacidades que declara hoy `commands/onboarding.rs`.
const CURRENT = [
  "dashboard", "tasks", "projects", "notes", "global-shortcuts", "pomodoro", "time-tracking",
  "app-tracking", "calendar", "reminders", "workspaces", "clipboard", "menu-bar", "updates",
  "recurrence", "trash", "command-palette", "teaching",
];

function feature(overrides: Partial<FeatureDefinition>): FeatureDefinition {
  return {
    id: "demo",
    title: "Demo",
    summary: "",
    description: "",
    category: "tools",
    phase: 1,
    introducedInVersion: "0.1.0",
    revision: 1,
    implemented: true,
    verified: true,
    enabled: true,
    onboardingEnabled: true,
    requires: ["demo"],
    order: 1,
    icon: "home",
    tone: "blue",
    highlights: ["Algo"],
    example: "Ejemplo",
    tips: [],
    animation: "tasks",
    ...overrides,
  };
}

test("el registro no tiene errores de mantenimiento", () => {
  assert.deepEqual(registryProblems(), []);
});

test("solo se presentan las funciones operativas de hoy, sin IA", () => {
  const ids = availableFeatures(CURRENT).map((item) => item.id);
  assert.deepEqual(ids, [
    "dashboard", "command-palette", "tasks", "projects", "notes", "pomodoro", "time", "calendar", "teaching", "workspaces",
    "clipboard", "trash", "menu-bar",
  ]);
});

test("una función incompleta, sin verificar o deshabilitada no aparece", () => {
  const registry = [
    feature({ id: "ok" }),
    feature({ id: "unfinished", implemented: false, verified: false }),
    feature({ id: "unverified", verified: false }),
    feature({ id: "disabled", enabled: false }),
    feature({ id: "hidden", onboardingEnabled: false }),
    feature({ id: "unreleased", introducedInVersion: null }),
  ];
  assert.deepEqual(availableFeatures(["demo"], registry).map((item) => item.id), ["ok"]);
});

test("la capacidad de Rust es obligatoria aunque el registro diga que está lista", () => {
  const ai = FEATURES.find((item) => item.id === "local-ai")!;
  const finished = { ...ai, implemented: true, verified: true, introducedInVersion: "0.4.0", highlights: ["x"], example: "x", animation: "tasks" as const };
  assert.equal(availableFeatures(CURRENT, [finished]).length, 0);
  assert.equal(availableFeatures([...CURRENT, "local-ai"], [finished]).length, 1);
});

test("las novedades distinguen funciones nuevas y mejoradas y no se repiten", () => {
  const before = [feature({ id: "tasks" }), feature({ id: "notes" })];
  const seen = revisionMap(before);
  const after = [
    feature({ id: "tasks" }),
    feature({ id: "notes", revision: 2, updates: [{ revision: 2, version: "0.3.0", summary: "Recordatorios" }] }),
    feature({ id: "widgets", introducedInVersion: "0.3.0" }),
  ];
  const news = whatsNew(after, seen);
  assert.deepEqual(news.map((entry) => [entry.feature.id, entry.kind]), [["notes", "improved"], ["widgets", "new"]]);
  assert.equal(news[0].changes[0].summary, "Recordatorios");
  assert.deepEqual(whatsNew(after, { ...seen, ...revisionMap(after) }), []);
});

test("la huella cambia con funciones nuevas o revisiones, no con el orden", () => {
  const one = [feature({ id: "a" }), feature({ id: "b" })];
  assert.equal(featureRevision(one), featureRevision([...one].reverse()));
  assert.notEqual(featureRevision(one), featureRevision([...one, feature({ id: "c" })]));
  assert.notEqual(featureRevision(one), featureRevision([feature({ id: "a", revision: 2 }), feature({ id: "b" })]));
});

test("el historial por versión empieza por la más reciente", () => {
  const notes = releaseNotes(availableFeatures(CURRENT));
  assert.deepEqual(notes.map((entry) => entry.version), ["0.8.1", "0.8.0", "0.7.0", "0.6.0", "0.5.0", "0.4.0", "0.2.0", "0.1.0"]);
  assert.deepEqual(notes[0].improved.map((item) => item.feature.id), ["teaching"]);
  assert.deepEqual(notes[1].added.map((item) => item.id), ["teaching"]);
  assert.deepEqual(notes[2].improved.map((item) => item.feature.id), ["tasks", "calendar", "menu-bar"]);
  assert.deepEqual(notes[3].added.map((item) => item.id), ["command-palette", "trash"]);
  assert.deepEqual(notes[3].improved.map((item) => item.feature.id), ["tasks", "calendar"]);
  assert.deepEqual(notes[4].improved.map((item) => item.feature.id), ["calendar"]);
  assert.deepEqual(notes[5].improved.map((item) => item.feature.id), ["notes", "workspaces"]);
  assert.ok(notes[6].added.some((item) => item.id === "calendar"));
  assert.ok(notes[6].improved.some((item) => item.feature.id === "time"));
});

test("los pasos de la visita llevan su función y una IA sin modelo pide configuración", () => {
  const steps = tourSteps(availableFeatures(CURRENT));
  assert.equal(steps[0].featureId, "dashboard");
  assert.equal(new Set(steps.map((step) => step.id)).size, steps.length);
  const ai = FEATURES.find((item) => item.id === "local-ai")!;
  assert.match(needsSetup(ai, ["local-ai"]) ?? "", /configuración adicional/);
  assert.equal(needsSetup(ai, ["local-ai", "local-ai:model"]), null);
});
