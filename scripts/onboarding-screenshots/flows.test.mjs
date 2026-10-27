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
    assert.equal(Object.keys(seen.features).length, 13, "presenta las 13 funciones disponibles");
    assert.ok(!("local-ai" in seen.features));

    await page.click("Comenzar recorrido");
    await headingIs(page, "Inicio");
    assert.match(await page.evaluate(text), /Paso 1 de 14/);
    await page.key("ArrowRight");
    await headingIs(page, "Paleta de comandos");
    assert.equal((await page.evaluate(calls("record_onboarding_step"))).at(-1).stepId, "feature:command-palette");
    assert.equal(await page.evaluate("document.activeElement?.hasAttribute('data-step-heading')"), true, "el foco va al título para VoiceOver");
    await page.key("ArrowLeft");
    await headingIs(page, "Inicio");
    await page.click("Ir al paso 14: Todo listo");
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
    for (const title of ["Agenda y recordatorios", "Espacios de trabajo", "Historial del portapapeles", "Paleta de comandos", "Papelera", "Docencia"]) assert.ok(body.includes(title));
    assert.equal((body.match(/Nuevo\b/g) ?? []).length, 6);
    assert.equal((body.match(/Mejorado/g) ?? []).length, 5);
    assert.ok(!body.includes("Proyectos\nMejorado"), "Proyectos no cambió");
    assert.equal((await page.evaluate(calls("record_onboarding_event")))[0].event, "whats_new_shown");
    assert.equal((await page.evaluate(calls("mark_features_seen"))).length, 1);
    await page.click("Ver novedades");
    await page.waitFor(`${text}.includes("Novedad 1 de 12")`);
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

test("el catálogo no presenta la IA local", async () => {
  const page = await open("target=onboarding&mode=features&state=seen");
  try {
    await headingIs(page, "Funcionalidades disponibles");
    const body = await page.evaluate(text);
    assert.ok(body.includes("Notas flotantes") && body.includes("Barra de menús"));
    assert.ok(!/Inteligencia artificial/.test(body));
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

const savedDocuments = `${calls("update_note")}.map((call) => call.input.contentJson).filter(Boolean)`;

test("la nota enriquecida muestra formato, lista, tabla e imágenes y archivos adjuntos", async () => {
  const page = await open("target=note&id=n1", { width: 380, height: 640 });
  try {
    await page.waitFor("document.querySelector('.note-editor h2')?.textContent === 'Estructura del capítulo'");
    assert.equal(await page.evaluate("document.querySelectorAll('.note-editor ul[data-type=taskList] li').length"), 3);
    assert.equal(await page.evaluate("document.querySelectorAll('.note-editor table th').length"), 2);
    assert.equal(await page.evaluate("Boolean(document.querySelector('.note-editor strong, .note-editor b'))"), true);
    await page.waitFor("document.querySelector('.note-image-frame img')?.src.startsWith('blob:')");
    assert.match(await page.evaluate("document.querySelector('.note-file-node')?.textContent ?? ''"), /Rúbrica de evaluación\.pdf/);
    assert.equal(await page.evaluate("document.querySelector('.note-editor a')?.getAttribute('href')"), "https://example.com/guia");
  } finally {
    await page.close();
  }
});

test("una nota antigua no se convierte al abrirla, solo al editarla", async () => {
  const page = await open("target=note&id=n2", { width: 380, height: 480 });
  try {
    await page.waitFor(`${text}.includes("Nota del editor anterior")`);
    await page.evaluate("new Promise((resolve) => setTimeout(resolve, 900))");
    assert.equal((await page.evaluate(calls("update_note"))).length, 0, "abrir no guarda nada");
    await page.clickSelector(".note-editor p");
    await page.type(" Añadido");
    await page.waitFor(`${savedDocuments}.length > 0`, 4000);
    const [json] = await page.evaluate(savedDocuments);
    assert.match(json, /Añadido/);
    assert.match(json, /"type":"doc"/);
  } finally {
    await page.close();
  }
});

test("la barra aplica negrita y el documento se guarda con ella", async () => {
  const page = await open("target=note&id=n3", { width: 380, height: 480 });
  try {
    await page.clickSelector(".note-editor p");
    await page.click("Negrita (⌘B)");
    await page.type("fuerte");
    await page.waitFor(`${savedDocuments}.some((json) => json.includes("fuerte"))`, 4000);
    const document = JSON.parse((await page.evaluate(savedDocuments)).at(-1));
    const nodes = JSON.stringify(document).match(/\{[^{}]*"text":"fuerte"[^{}]*\}|\{"type":"text","marks":\[\{"type":"bold"\}\],"text":"fuerte"\}/g) ?? [];
    assert.ok(nodes.some((node) => node.includes('"bold"')), `negrita en ${JSON.stringify(document)}`);
  } finally {
    await page.close();
  }
});

test("un conflicto entre ventanas se avisa y no sobrescribe nada", async () => {
  const page = await open("target=note&id=n1&conflict=1", { width: 380, height: 560 });
  try {
    await page.clickSelector(".note-editor p");
    await page.type(" cambio");
    await page.waitFor(`${text}.includes("Otra ventana guardó cambios en esta nota.")`, 4000);
    assert.ok((await page.evaluate(text)).includes("Conservar la mía"));
  } finally {
    await page.close();
  }
});

test("lo escrito antes de un cierre inesperado se puede recuperar", async () => {
  const page = await open("target=note&id=n1&draft=1", { width: 380, height: 560 });
  try {
    await page.waitFor(`${text}.includes("Hay cambios sin guardar de la última sesión.")`);
    await page.click("Recuperar");
    await page.waitFor("document.querySelector('.note-editor')?.textContent.includes('Texto recuperado tras el cierre')");
    await page.waitFor(`${savedDocuments}.some((json) => json.includes("Texto recuperado"))`, 4000);
  } finally {
    await page.close();
  }
});

test("el panel de adjuntos distingue lo que usa la nota", async () => {
  const page = await open("target=note&id=n1&panel=Adjuntos", { width: 380, height: 560 });
  try {
    await page.waitFor(`${text}.includes("Idea grabada.m4a")`);
    const body = await page.evaluate(text);
    assert.equal((body.match(/no usado en la nota/g) ?? []).length, 1);
    assert.equal((body.match(/· en la nota/g) ?? []).length, 2);
  } finally {
    await page.close();
  }
});

test("la página Notas filtra por contexto", async () => {
  const page = await open("target=notes", { width: 1180, height: 760 });
  const cards = "document.querySelectorAll('[data-tour-id=notes-list] article').length";
  try {
    await page.waitFor(`${cards} === 5`);
    await page.click("Con adjuntos");
    await page.waitFor(`${cards} === 2`);
    await page.click("Fijadas");
    await page.waitFor(`${cards} === 1`);
    await page.click("Con pendientes");
    await page.waitFor(`${cards} === 1`);
  } finally {
    await page.close();
  }
});


test("el calendario coloca las tareas a su hora y las sin hora en la hora por defecto", async () => {
  const page = await open("target=calendar", { width: 1180, height: 900 });
  const block = (label) => `Boolean(document.querySelector('[aria-label=${JSON.stringify(label)}]'))`;
  try {
    await page.waitFor(block("Tarea: Revisar el borrador del capítulo 3, 11:00"));
    await page.waitFor(block("Tarea: Preparar la clase del jueves, sin hora fija"));
    // A «Todo el día»: deja la cuadrícula y pasa a la franja superior como casilla.
    await page.evaluate(`(() => {
      const select = document.querySelector('[aria-label="Hora de las tareas sin hora"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "all-day");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await page.waitFor(`!${block("Tarea: Preparar la clase del jueves, sin hora fija")}`);
    await page.waitFor(block("Completar: Preparar la clase del jueves"));
    // Pulsar el bloque abre la tarea en su sección, con el detalle.
    await page.clickSelector('[aria-label="Tarea: Revisar el borrador del capítulo 3, 11:00"]');
    await page.waitFor("document.querySelector('nav [aria-current=page]')?.textContent.trim() === 'Tareas'");
    await page.waitFor(`${calls("get_task")}.some((args) => args.taskId === "k1")`);
  } finally {
    await page.close();
  }
});

const pressShortcut = (key) =>
  `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, metaKey: true, bubbles: true }))`;
const clickRole = (role, label) =>
  `[...document.querySelectorAll('[role=${role}]')].find((element) => element.textContent.includes(${JSON.stringify(label)}))?.click()`;

test("⌘K abre la paleta, busca sin tildes y lleva a la sección", async () => {
  const page = await open("target=dashboard&state=seen", { width: 1180, height: 760 });
  try {
    await page.evaluate(pressShortcut("k"));
    await page.waitFor("Boolean(document.querySelector('[aria-label=\"Paleta de comandos\"]'))");
    assert.equal(await page.evaluate("document.activeElement?.getAttribute('aria-label')"), "Buscar");
    await page.type("papelera");
    // El IPC simulado no filtra tareas: basta con que la sección sea el primer resultado.
    await page.waitFor(`document.querySelector('[role=option]')?.textContent === "Papelera"`);
    await page.key("Enter");
    await page.waitFor(`document.querySelector('h1')?.textContent === "Papelera"`);
    assert.equal(await page.evaluate("Boolean(document.querySelector('[aria-label=\"Paleta de comandos\"]'))"), false);
    assert.ok((await page.evaluate(text)).includes("Clase de Programación"));

    await page.evaluate(pressShortcut("k"));
    await page.type("concentracion");
    await page.waitFor(`[...document.querySelectorAll('[role=option]')].some((option) => option.textContent === "Concentración")`);
  } finally {
    await page.close();
  }
});

test("una tarea repetida muestra su regla y al borrarla se puede deshacer", async () => {
  const page = await open("target=tasks&state=seen", { width: 1180, height: 760 });
  try {
    await page.evaluate(clickRole("button", "Responder correos de estudiantes"));
    await page.waitFor(`[...document.querySelectorAll('select')].some((select) => select.value === "weekdays")`);
    assert.ok((await page.evaluate(text)).includes("Saltar esta vez"));
    await page.click("Eliminar tarea");
    assert.deepEqual(await page.evaluate(calls("delete_task")), [{ taskId: "k3" }]);
    await page.waitFor(`${text}.includes("movida a la papelera")`);
    await page.click("Deshacer");
    assert.deepEqual(await page.evaluate(calls("restore_trash_item")), [{ itemId: "trash-task" }]);
    await page.waitFor(`!${text}.includes("movida a la papelera")`);
  } finally {
    await page.close();
  }
});

test("al cambiar o borrar una repetición se elige a cuáles se aplica", async () => {
  const page = await open("target=calendar&state=seen", { width: 1180, height: 760 });
  try {
    const tutorial = "[...document.querySelectorAll('button')].find((button) => button.textContent.startsWith('Tutoría con estudiantes'))?.click()";
    await page.evaluate(tutorial);
    await page.waitFor(`${text}.includes("Editar evento")`);
    assert.ok((await page.evaluate(text)).includes("Cada semana el"));
    await page.click("Guardar cambios");
    await page.waitFor(`${text}.includes("¿A cuáles aplicas el cambio?")`);
    assert.ok((await page.evaluate(text)).includes("Este y los siguientes"));
    assert.equal((await page.evaluate(calls("update_event"))).length, 0, "no guarda hasta elegir");
    await page.click("Solo este evento");
    const [update] = await page.evaluate(calls("update_event"));
    assert.equal(update.scope, "this");
    assert.equal(typeof update.occurrenceStart, "number");

    await page.evaluate(tutorial);
    await page.waitFor(`${text}.includes("Editar evento")`);
    await page.click("Eliminar evento");
    await page.waitFor(`${text}.includes("¿Qué quieres eliminar?")`);
    await page.click("Todos los eventos");
    const [removal] = await page.evaluate(calls("delete_event"));
    assert.equal(removal.scope, "all");
    await page.waitFor(`${text}.includes("movido a la papelera")`);
  } finally {
    await page.close();
  }
});

/** Centro (x) y parte alta (y) del bloque cuyo texto empieza por `title`. */
const blockPoint = (title) => `(() => {
  const block = [...document.querySelectorAll('.group\\\\/block')].find((element) => element.textContent.trim().startsWith(${JSON.stringify(title)}));
  if (!block) return null;
  block.scrollIntoView({ block: 'center' });
  const rect = block.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + 8, bottom: rect.bottom - 2, width: rect.width };
})()`;

test("arrastrar un evento lo mueve de hora y de día, y estirarlo cambia su duración", async () => {
  const page = await open("target=calendar&state=seen", { width: 1180, height: 760 });
  try {
    const point = await page.evaluate(blockPoint("Revisión de prácticas"));
    assert.ok(point, "el evento de hoy está en la semana");
    // Una hora más tarde (44 px) y un día a la derecha (a la izquierda si hoy es domingo).
    const direction = new Date().getDay() === 0 ? -1 : 1;
    await page.drag(point, { x: point.x + direction * (point.width + 4), y: point.y + 44 });
    const [update] = await page.evaluate(calls("update_event"));
    assert.equal(update.eventId, "e6");
    assert.equal(update.input.endsAt - update.input.startsAt, 3600, "conserva la duración");
    const moved = new Date(update.input.startsAt * 1000);
    assert.equal(moved.getHours(), 14);
    const today = new Date();
    assert.equal(Math.round((new Date(moved).setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000), direction);
    assert.equal(update.scope, null, "un evento suelto no pregunta");
    assert.equal(await page.evaluate("Boolean(document.querySelector('#event-dialog-title'))"), false, "soltar no abre el diálogo");

    const resize = await page.evaluate(blockPoint("Revisión de prácticas"));
    await page.drag({ x: resize.x, y: resize.bottom }, { x: resize.x, y: resize.bottom + 22 });
    const [, stretched] = await page.evaluate(calls("update_event"));
    assert.equal(stretched.input.endsAt - stretched.input.startsAt, 90 * 60, "de 1 h a 1 h 30");
  } finally {
    await page.close();
  }
});

test("mover una repetición pregunta a cuáles se aplica y Cancelar la devuelve", async () => {
  const page = await open("target=calendar&state=seen", { width: 1180, height: 760 });
  try {
    const point = await page.evaluate(blockPoint("Tutoría con estudiantes"));
    await page.drag(point, { x: point.x, y: point.y + 88 });
    await page.waitFor(`${text}.includes("¿Qué repeticiones mueves?")`);
    assert.equal((await page.evaluate(calls("update_event"))).length, 0);
    await page.click("Cancelar");
    assert.equal((await page.evaluate(calls("update_event"))).length, 0);
    const back = await page.evaluate(blockPoint("Tutoría con estudiantes"));
    assert.ok(Math.abs(back.y - point.y) < 4, "vuelve a su hora");

    await page.drag(back, { x: back.x, y: back.y + 88 });
    await page.click("Solo este evento");
    const [update] = await page.evaluate(calls("update_event"));
    assert.equal(update.scope, "this");
    assert.equal(new Date(update.input.startsAt * 1000).getHours(), 17);
  } finally {
    await page.close();
  }
});

test("una tarea que empieza otro día lo indica y su detalle muestra la fecha de inicio", async () => {
  const page = await open("target=tasks&state=seen", { width: 1180, height: 760 });
  try {
    await page.click("Todas");
    await page.waitFor(`${text}.includes("Empieza pasado mañana") || /Empieza \\w+/.test(${text})`);
    await page.evaluate(clickRole("button", "Planificar las prácticas"));
    await page.waitFor(`${text}.includes("Hasta ese día no aparece en Hoy.")`);
  } finally {
    await page.close();
  }
});

test("Docencia: el horario añade clases con los datos de la materia y crea las sesiones", async () => {
  const page = await open("target=teaching&state=seen&tab=schedule", { width: 1180, height: 760 });
  try {
    // Vista por bloques, como la hoja oficial: el bloque de 2:30 del martes es teoría en 2D3.
    await page.waitFor(`${text}.includes("Horario de clases") && ${text}.includes("2:30 – 3:15")`);
    assert.ok((await page.evaluate(text)).includes("(T)(2D3)"));
    await page.click("Añadir clase");
    await page.waitFor(`${text}.includes("Añadir al horario")`);
    // Por bloques: elegir del de 7:30 p. m. al de 9:10 p. m.
    await page.evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      const pick = (label, value) => {
        const select = document.querySelector('select[aria-label="' + label + '"]');
        setter.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      pick('Bloque inicial', '19:30');
      pick('Bloque final', '21:55');
    })()`);
    await page.click("Añadir al horario");
    const [{ input }] = await page.evaluate(calls("teaching_save_schedule_slot"));
    // Toma el aula, el tipo y las fechas por defecto de la otra clase de la materia.
    assert.deepEqual(
      { courseId: input.courseId, kind: input.kind, weekday: input.weekday, startTime: input.startTime, endTime: input.endTime, room: input.room, startsOn: input.startsOn, reminderMinutes: input.reminderMinutes },
      { courseId: 1, kind: "theory", weekday: 1, startTime: "19:30", endTime: "21:55", room: "2D3", startsOn: "2026-08-03", reminderMinutes: 10 },
    );
    await page.click("Crear sesiones de asistencia");
    assert.deepEqual(await page.evaluate(calls("teaching_generate_sessions")), [{ courseId: 1 }]);
    await page.waitFor(`${text}.includes("30 sesiones nuevas")`);
  } finally {
    await page.close();
  }
});

test("Docencia: con asistencia sin guardar, cambiar de pestaña o de sección pide confirmación", async () => {
  const page = await open("target=teaching&state=seen&tab=attendance", { width: 1180, height: 760 });
  try {
    await page.waitFor(`${text}.includes("Control de asistencia")`);
    await page.evaluate(`(() => {
      window.confirm = () => (window.__confirmed = (window.__confirmed ?? 0) + 1) && false;
      const select = document.querySelector('.matrix-table tbody select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, select.value === 'A' ? 'P' : 'A');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await page.waitFor(`${text}.includes("1 cambios pendientes")`);
    await page.click("Informes");
    await page.click("Tareas");
    assert.equal(await page.evaluate("window.__confirmed"), 2, "pregunta en los dos casos");
    assert.ok((await page.evaluate(text)).includes("Control de asistencia"), "se queda en Asistencia");
    await page.evaluate("window.confirm = () => true");
    await page.click("Informes");
    await page.waitFor(`${text}.includes("Exportar Excel")`);
  } finally {
    await page.close();
  }
});

test("una clase de Docencia en el calendario se cambia desde Docencia", async () => {
  const page = await open("target=calendar&state=seen", { width: 1180, height: 760 });
  try {
    await page.evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.startsWith('Desarrollo de Software VIII'))?.click()");
    await page.waitFor(`${text}.includes("Viene de Docencia")`);
    assert.equal(await page.evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Guardar cambios')).disabled"), true);
    await page.click("Abrir Docencia");
    await page.waitFor(`document.querySelector('h1')?.textContent === "Docencia"`);
  } finally {
    await page.close();
  }
});

test("Docencia: «Marcar a todos» marca la clase entera y espera a guardar", async () => {
  const page = await open("target=teaching&state=seen&tab=attendance", { width: 1180, height: 760 });
  try {
    await page.waitFor(`${text}.includes("Control de asistencia")`);
    const choose = (session, value) => `(() => {
      const select = document.querySelector('select[aria-label="Marcar a todos en la clase ${session}"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, ${JSON.stringify(value)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`;
    // La clase 6 no tiene marcas: «Sin marcar → presentes» rellena a los 11 estudiantes activos.
    await page.evaluate(choose(6, "empty-P"));
    await page.waitFor(`${text}.includes("11 cambios pendientes")`);
    assert.equal((await page.evaluate(calls("teaching_save_attendance"))).length, 0, "aún no guarda");
    // «Todos ausentes» en la clase 1 sustituye las marcas que ya tenía.
    await page.evaluate(choose(1, "A"));
    await page.waitFor(`${text}.includes("22 cambios pendientes")`);
    await page.click("Guardar cambios");
    const [{ updates }] = await page.evaluate(calls("teaching_save_attendance"));
    assert.equal(updates.filter((update) => update.sessionId === 6 && update.status === "P").length, 11);
    assert.equal(updates.filter((update) => update.sessionId === 1 && update.status === "A").length, 11);
  } finally {
    await page.close();
  }
});

