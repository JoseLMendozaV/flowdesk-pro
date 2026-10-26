// Flujos de la guía sobre la interfaz real con el IPC simulado: navegación, preferencias,
// novedades, visita guiada, «Reducir movimiento» y ventanas pequeñas.
// Uso: npm run test:onboarding-ui
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { withHarness } from "./browser.mjs";

let open;
let finished;
before(async () => {
  await new Promise((ready, failed) => {
    finished = withHarness(async (harness) => {
      open = harness.open;
      ready();
      await new Promise((resolve) => (after.resolve = resolve));
    }).catch(failed);
  });
});
after(async () => {
  after.resolve?.();
  await finished;
});

const heading = "document.querySelector('[data-step-heading]')?.textContent.trim()";
const calls = (command) => `window.__flowdeskCalls.filter((call) => call.command === ${JSON.stringify(command)}).map((call) => call.args)`;
const text = "document.body.innerText";
const DATA_COMMANDS = /^(create|update|delete|set|add|remove|archive|start|stop|pause|resume|toggle|copy|clear|exclude|link)_/;

async function headingIs(page, expected) {
  await page.waitFor(`${heading} === ${JSON.stringify(expected)}`);
}

test("al abrir FlowDesk decide entre bienvenida, novedades o nada, y nunca con el dashboard oculto", async () => {
  const cases = [
    ["state=first-run", [{ mode: "welcome", featureId: null }], 0],
    ["state=news", [{ mode: "whats-new", featureId: null }], 0],
    ["state=seen", [], 1],
    ["state=first-run&hidden=1", [], 0],
  ];
  for (const [query, opened, silentlySeen] of cases) {
    const page = await open(`target=dashboard&${query}`, { width: 1180, height: 760 });
    try {
      await page.evaluate("new Promise((resolve) => setTimeout(resolve, 300))");
      assert.deepEqual(await page.evaluate(calls("open_onboarding")), opened, query);
      assert.equal((await page.evaluate(calls("mark_features_seen"))).length, silentlySeen, query);
    } finally {
      await page.close();
    }
  }
});

test("la bienvenida avanza, retrocede, salta a un paso y se completa", async () => {
  const page = await open("target=onboarding&mode=welcome");
  try {
    await headingIs(page, "¡Bienvenido a FlowDesk Pro!");
    const [seen] = await page.evaluate(calls("mark_features_seen"));
    assert.equal(Object.keys(seen.features).length, 10, "presenta las 10 funciones disponibles");
    assert.ok(!("widgets" in seen.features) && !("local-ai" in seen.features));

    await page.click("Comenzar recorrido");
    await headingIs(page, "Inicio");
    assert.match(await page.evaluate(text), /Paso 1 de 11/);
    await page.key("ArrowRight");
    await headingIs(page, "Tareas");
    assert.equal((await page.evaluate(calls("record_onboarding_step"))).at(-1).stepId, "feature:tasks");
    assert.equal(await page.evaluate("document.activeElement?.hasAttribute('data-step-heading')"), true, "el foco va al título para VoiceOver");
    await page.key("ArrowLeft");
    await headingIs(page, "Inicio");
    await page.click("Ir al paso 11: Todo listo");
    await headingIs(page, "¡Todo listo!");
    await page.click("Comenzar a trabajar");
    await page.waitFor(`${calls("close_onboarding")}.length === 1`);
    assert.deepEqual(await page.evaluate(calls("finish_welcome_onboarding")), [{ outcome: "completed" }]);
  } finally {
    await page.close();
  }
});

test("«Explorar por mi cuenta» y Esc omiten la bienvenida", async () => {
  for (const action of ["click", "escape"]) {
    const page = await open("target=onboarding&mode=welcome");
    try {
      await headingIs(page, "¡Bienvenido a FlowDesk Pro!");
      if (action === "click") await page.click("Explorar por mi cuenta");
      else await page.key("Escape");
      await page.waitFor(`${calls("close_onboarding")}.length === 1`);
      assert.deepEqual(await page.evaluate(calls("finish_welcome_onboarding")), [{ outcome: "skipped" }]);
    } finally {
      await page.close();
    }
  }
});

test("«Mostrármelo en FlowDesk» no omite la bienvenida: pide volver a ella", async () => {
  const page = await open("target=onboarding&mode=welcome&feature=tasks");
  try {
    await headingIs(page, "Tareas");
    await page.click("Mostrármelo en FlowDesk");
    await page.waitFor(`${calls("start_guided_tour")}.length === 1`);
    assert.deepEqual(await page.evaluate(calls("start_guided_tour")), [{ featureId: "tasks", returnMode: "welcome" }]);
    assert.deepEqual(await page.evaluate(calls("finish_welcome_onboarding")), []);
  } finally {
    await page.close();
  }
});

test("al terminar o salir de la visita se vuelve a la bienvenida en la misma función", async () => {
  for (const exit of ["finish", "escape"]) {
    const page = await open("target=dashboard&state=seen&tour=tasks&return=1", { width: 1180, height: 760 });
    try {
      await page.waitFor("document.querySelector('#tour-step-title')?.textContent === 'Tareas'");
      if (exit === "escape") await page.key("Escape");
      else for (let step = 0; step < 5; step += 1) await page.key("ArrowRight");
      await page.waitFor(`${calls("open_onboarding")}.length === 1`, 4000);
      assert.deepEqual(await page.evaluate(calls("open_onboarding")), [{ mode: "welcome", featureId: "tasks" }], exit);
    } finally {
      await page.close();
    }
  }
});

test("la bienvenida ofrece continuar donde se dejó", async () => {
  const page = await open("target=onboarding&mode=welcome&state=resume");
  try {
    await headingIs(page, "¡Bienvenido a FlowDesk Pro!");
    await page.click("Continuar donde lo dejé: Proyectos");
    await headingIs(page, "Proyectos");
  } finally {
    await page.close();
  }
});

test("«No volver a mostrar» se guarda al momento y no toca las novedades", async () => {
  const page = await open("target=onboarding&mode=welcome");
  try {
    await page.click("No volver a mostrar esta bienvenida automáticamente");
    await page.waitFor(`${calls("update_onboarding_preferences")}.length === 1`);
    const [{ preferences }] = await page.evaluate(calls("update_onboarding_preferences"));
    assert.deepEqual(preferences, { showWelcomeOnStartup: false, showWhatsNewOnUpdate: true, resumeTour: true });
    assert.equal(await page.evaluate("document.querySelector('footer input[type=checkbox]').checked"), true);
  } finally {
    await page.close();
  }
});

test("las novedades muestran solo lo nuevo o mejorado y se marcan como vistas", async () => {
  const page = await open("target=onboarding&mode=whats-new&state=news");
  try {
    await headingIs(page, "¡FlowDesk Pro tiene novedades!");
    const body = await page.evaluate(text);
    for (const title of ["Agenda y recordatorios", "Espacios de trabajo", "Historial del portapapeles"]) assert.ok(body.includes(title));
    assert.equal((body.match(/Nuevo\b/g) ?? []).length, 3);
    assert.equal((body.match(/Mejorado/g) ?? []).length, 4);
    assert.ok(!body.includes("Proyectos\nMejorado"), "Proyectos no cambió");
    assert.equal((await page.evaluate(calls("record_onboarding_event")))[0].event, "whats_new_shown");
    assert.equal((await page.evaluate(calls("mark_features_seen"))).length, 1);
    await page.click("Ver novedades");
    await page.waitFor(`${text}.includes("Novedad 1 de 8")`);
  } finally {
    await page.close();
  }
});

test("sin novedades pendientes muestra «Estás al día» y el historial real", async () => {
  const page = await open("target=onboarding&mode=whats-new&state=seen");
  try {
    await headingIs(page, "Estás al día");
    const body = await page.evaluate(text);
    assert.ok(body.includes("Versión 0.2.0") && body.includes("Versión 0.1.0"));
    assert.equal((await page.evaluate(calls("mark_features_seen"))).length, 0);
  } finally {
    await page.close();
  }
});

test("el catálogo no presenta widgets ni IA local", async () => {
  const page = await open("target=onboarding&mode=features&state=seen");
  try {
    await headingIs(page, "Funcionalidades disponibles");
    const body = await page.evaluate(text);
    assert.ok(body.includes("Notas flotantes") && body.includes("Barra de menús"));
    assert.ok(!/Widgets|Inteligencia artificial/.test(body));
  } finally {
    await page.close();
  }
});

test("la visita guiada omite un elemento oculto y termina sin tocar datos", async () => {
  const page = await open("target=dashboard&panel=0&tour=dashboard", { width: 1180, height: 760 });
  try {
    await page.waitFor("document.querySelector('#tour-step-title')?.textContent === 'Inicio'");
    for (let step = 0; step < 3; step += 1) await page.key("ArrowRight");
    await page.waitFor("document.querySelector('#tour-step-title')?.textContent === 'Acciones rápidas'");
    assert.match(await page.evaluate(text), /4 de 5/);
    await page.key("ArrowRight");
    // El panel derecho está oculto: tras buscarlo 1,5 s se omite el paso y la visita termina.
    await page.waitFor(`${calls("record_onboarding_event")}.at(-1)?.event === "guided_tour_completed"`, 4000);
    assert.equal(await page.evaluate("Boolean(document.querySelector('#tour-step-title'))"), false);
    const commands = await page.evaluate("window.__flowdeskCalls.map((call) => call.command)");
    assert.deepEqual(commands.filter((command) => DATA_COMMANDS.test(command) && command !== "record_onboarding_event"), []);
  } finally {
    await page.close();
  }
});

test("Esc sale de la visita y devuelve la sección inicial", async () => {
  const page = await open("target=dashboard&tour=tasks", { width: 1180, height: 760 });
  const current = "document.querySelector('nav [aria-current=page]')?.textContent.trim()";
  try {
    await page.waitFor("document.querySelector('#tour-step-title')?.textContent === 'Tareas'");
    assert.equal(await page.evaluate(current), "Tareas");
    await page.key("ArrowRight");
    await page.waitFor("document.querySelector('#tour-step-title')?.textContent === 'Vistas'");
    await page.key("Escape");
    await page.waitFor("!document.querySelector('#tour-step-title')");
    assert.equal(await page.evaluate(current), "Inicio");
  } finally {
    await page.close();
  }
});

test("«Reducir movimiento» detiene las animaciones de las demostraciones", async () => {
  for (const reducedMotion of [false, true]) {
    const page = await open("target=onboarding&mode=tour&feature=notes&demo=1", { reducedMotion });
    try {
      await page.waitFor("Boolean(document.querySelector('.demo-note'))");
      const animation = await page.evaluate("getComputedStyle(document.querySelector('.demo-note')).animationName");
      assert.equal(animation, reducedMotion ? "none" : "demo-note-drift");
    } finally {
      await page.close();
    }
  }
});

test("modo oscuro y ventana pequeña sin desbordamiento horizontal", async () => {
  const page = await open("target=onboarding&mode=tour&feature=time", { width: 720, height: 520, scheme: "dark" });
  try {
    await headingIs(page, "Seguimiento del tiempo");
    assert.equal(await page.evaluate("getComputedStyle(document.querySelector('#root > div')).backgroundColor"), "rgb(22, 23, 27)");
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    assert.equal(await page.evaluate("[...document.querySelectorAll('footer button')].every((button) => button.getBoundingClientRect().right <= window.innerWidth)"), true);
  } finally {
    await page.close();
  }
});
