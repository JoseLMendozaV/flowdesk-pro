// Datos de demostración para las capturas de la guía. Ficticios y relativos a hoy,
// para que «Hoy», «Mañana» y la semana del calendario tengan sentido en cualquier fecha.

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);
const midnight = (() => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
})();
const at = (dayOffset: number, hour: number, minute = 0) => midnight + dayOffset * DAY + hour * 3600 + minute * 60;
const noon = (dayOffset: number) => at(dayOffset, 12);
const weekStart = (() => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return Math.floor(date.getTime() / 1000);
})();

export const projects = [
  { id: "p-thesis", name: "Tesis doctoral", description: "Capítulos, experimentos y bibliografía", color: "#6C8CFF", status: "active", progress: 62, tasks: 21, done: 13, open: 8, overdue: 1, notes: 6, tracked: 38 * 3600 },
  { id: "p-course", name: "Curso de Programación", description: "Clases, prácticas y evaluación", color: "#F59E0B", status: "active", progress: 45, tasks: 18, done: 8, open: 10, overdue: 0, notes: 4, tracked: 22 * 3600 },
  { id: "p-app", name: "App de laboratorio", description: "Panel de control de los sensores", color: "#10B981", status: "active", progress: 78, tasks: 14, done: 11, open: 3, overdue: 0, notes: 2, tracked: 17 * 3600 },
  { id: "p-paper", name: "Artículo para congreso", description: "Envío antes de la fecha límite", color: "#EC4899", status: "paused", progress: 30, tasks: 10, done: 3, open: 7, overdue: 0, notes: 3, tracked: 9 * 3600 },
].map((project) => ({
  id: project.id,
  name: project.name,
  description: project.description,
  color: project.color,
  status: project.status,
  startsAt: midnight - 40 * DAY,
  targetAt: midnight + 35 * DAY,
  createdAt: midnight - 40 * DAY,
  updatedAt: now - 3600,
  archivedAt: null,
  taskCount: project.tasks,
  completedTaskCount: project.done,
  openTaskCount: project.open,
  overdueTaskCount: project.overdue,
  noteCount: project.notes,
  trackedSeconds: project.tracked,
  progressPercent: project.progress,
}));

const projectById = Object.fromEntries(projects.map((project) => [project.id, project]));
export const tags = [
  { id: "t-writing", name: "redacción", color: "#8b5cf6" },
  { id: "t-class", name: "clase", color: "#f59e0b" },
  { id: "t-review", name: "revisión", color: "#0ea5e9" },
];

const taskSeeds = [
  { id: "k1", title: "Revisar el borrador del capítulo 3", priority: "high", project: "p-thesis", due: at(0, 11), hasTime: true, tags: ["t-writing"], sub: [4, 2], est: 90 },
  { id: "k2", title: "Preparar la clase del jueves", priority: "medium", project: "p-course", due: noon(0), hasTime: false, tags: ["t-class"], sub: [3, 1], est: 60 },
  { id: "k3", title: "Responder correos de estudiantes", priority: "low", project: "p-course", due: at(0, 17, 30), hasTime: true, tags: [], sub: [0, 0], est: 30, repeat: "weekdays" },
  { id: "k4", title: "Corregir la prueba inestable del sensor", priority: "urgent", project: "p-app", due: noon(-1), hasTime: false, tags: ["t-review"], sub: [2, 0], est: 45 },
  { id: "k5", title: "Actualizar la bibliografía", priority: "medium", project: "p-thesis", due: noon(1), hasTime: false, tags: ["t-writing"], sub: [0, 0], est: null },
  { id: "k6", title: "Enviar el resumen del artículo", priority: "high", project: "p-paper", due: at(2, 10), hasTime: true, tags: ["t-writing"], sub: [5, 3], est: 120 },
  { id: "k7", title: "Planificar las prácticas de la semana", priority: "none", project: "p-course", due: noon(3), hasTime: false, tags: ["t-class"], sub: [0, 0], est: null },
  { id: "k8", title: "Leer artículos del estado del arte", priority: "low", project: "p-thesis", due: null, hasTime: false, tags: [], sub: [0, 0], est: null },
  { id: "k9", title: "Reunión de seguimiento con la directora", priority: "medium", project: "p-thesis", due: at(0, 9), hasTime: true, tags: [], sub: [0, 0], est: 30, completed: true },
];

export const tasks = taskSeeds.map((seed) => {
  const project = seed.project ? projectById[seed.project] : null;
  return {
    id: seed.id,
    title: seed.title,
    status: seed.completed ? "completed" : seed.id === "k1" ? "in_progress" : "pending",
    priority: seed.priority,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    projectColor: project?.color ?? null,
    dueAt: seed.due,
    dueHasTime: seed.hasTime,
    // «Planificar las prácticas» se puede empezar dentro de dos días.
    startsAt: seed.id === "k7" ? noon(2) : null,
    completedAt: seed.completed ? at(0, 9, 40) : null,
    createdAt: now - 5 * DAY,
    updatedAt: now - 3600,
    estimatedMinutes: seed.est,
    trackedSeconds: seed.id === "k1" ? 3 * 3600 : 0,
    subtaskCount: seed.sub[0],
    subtasksCompleted: seed.sub[1],
    noteCount: seed.id === "k1" ? 2 : 0,
    tags: tags.filter((tag) => seed.tags.includes(tag.id)),
    recurrence: "repeat" in seed ? { frequency: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5], fromCompletion: false, until: null } : null,
    recurrenceNextId: null,
  };
});

export function listTasks(filter: { view: string; projectId?: string | null; includeCompleted?: boolean }) {
  const endOfToday = midnight + DAY;
  const open = (task: (typeof tasks)[number]) => task.status !== "completed" && task.status !== "cancelled";
  return tasks.filter((task) => {
    if (filter.projectId && task.projectId !== filter.projectId) return false;
    if (filter.view === "completed") return !open(task);
    if (!open(task) && !(filter.includeCompleted && filter.view === "today")) return false;
    if (filter.view === "today") return task.dueAt !== null && task.dueAt < endOfToday;
    if (filter.view === "upcoming") return task.dueAt !== null && task.dueAt >= endOfToday;
    return true;
  });
}

const noteWindow = { x: null, y: null, width: 320, height: 280, expandedHeight: 280, opacity: 1, fontSize: 15, displayMode: "normal", isCollapsed: false, isVisible: true };
export const notes = [
  { id: "n1", title: "Ideas para el capítulo 3", content: "## Estructura\n- Motivación y contexto\n- Diseño del experimento\n- **Resultados preliminares**", color: "#FFF2A8", projectId: "p-thesis" },
  { id: "n2", title: "Dudas frecuentes del curso", content: "¿Cómo se entrega la práctica 2?\nRepasar recursión con ejemplos visuales.", color: "#D9E8FF", projectId: "p-course" },
  { id: "n3", title: "Comandos útiles", content: "cargo test -- --nocapture\nnpm run build", color: "#D9F7D6", projectId: "p-app" },
  { id: "n4", title: "Lista de lectura", content: "Deep Work — Cal Newport\nAtomic Habits — James Clear", color: "#FFD6DE", projectId: null },
  { id: "n5", title: "Acuerdos de la reunión", content: "Enviar borrador el viernes.\nRevisar figuras 4 y 5.", color: "#E8DDFF", projectId: "p-thesis" },
].map((note, index) => ({
  ...note,
  reminderAt: null,
  isArchived: false,
  createdAt: now - (index + 2) * DAY,
  updatedAt: now - (index + 1) * 5400,
  window: noteWindow,
  contentFormat: "markdown",
  contentJson: null as string | null,
  revision: 0,
  pinnedGlobal: index === 3,
  links: { taskIds: [] as string[], workspaceIds: [] as string[], eventIds: [] as string[], attachmentCount: 0, checklistTotal: 0, checklistDone: 0 },
}));

const text = (value: string, marks?: { type: string; attrs?: Record<string, string> }[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const task = (label: string, checked: boolean) => ({ type: "taskItem", attrs: { checked }, content: [paragraph(text(label))] });

/** Nota con el editor enriquecido: formato, lista de verificación, tabla y adjuntos. */
export const richDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Estructura del capítulo")] },
    paragraph(text("Partir de la "), text("motivación", [{ type: "bold" }]), text(", luego el "), text("diseño experimental", [{ type: "italic" }]), text(" y cerrar con los "), text("resultados", [{ type: "underline" }]), text(". Ver la "), text("guía de estilo", [{ type: "link", attrs: { href: "https://example.com/guia" } }]), text(".")),
    { type: "taskList", content: [task("Revisar la bibliografía", true), task("Redactar la sección 3.2", false), task("Preparar las figuras 4 y 5", false)] },
    { type: "noteImage", attrs: { attachmentId: "a-image", fileName: "esquema.png", mimeType: "image/png", byteSize: 48213, width: 150 } },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [paragraph(text("Sección"))] }, { type: "tableHeader", content: [paragraph(text("Estado"))] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [paragraph(text("3.1"))] }, { type: "tableCell", content: [paragraph(text("Lista"))] }] },
    ] },
    { type: "blockquote", content: [paragraph(text("Lo importante es la pregunta, no la herramienta."))] },
    { type: "noteFile", attrs: { attachmentId: "a-pdf", fileName: "Rúbrica de evaluación.pdf", mimeType: "application/pdf", byteSize: 182340 } },
  ],
};
Object.assign(notes[0], {
  contentFormat: "rich-v1",
  contentJson: JSON.stringify(richDocument),
  content: "Estructura del capítulo\nPartir de la motivación…\n[x] Revisar la bibliografía\n[ ] Redactar la sección 3.2\n[ ] Preparar las figuras 4 y 5",
  revision: 12,
  links: { taskIds: ["k1"], workspaceIds: ["w1"], eventIds: ["e2"], attachmentCount: 2, checklistTotal: 3, checklistDone: 1 },
});
Object.assign(notes[1].links, { checklistTotal: 2, checklistDone: 2 });
Object.assign(notes[2].links, { attachmentCount: 1 });

export const noteAttachments = [
  { id: "a-image", noteId: "n1", kind: "image", fileName: "esquema.png", mimeType: "image/png", byteSize: 48213, createdAt: now - DAY, inUse: true },
  { id: "a-pdf", noteId: "n1", kind: "file", fileName: "Rúbrica de evaluación.pdf", mimeType: "application/pdf", byteSize: 182340, createdAt: now - DAY, inUse: true },
  { id: "a-audio", noteId: "n1", kind: "audio", fileName: "Idea grabada.m4a", mimeType: "audio/mp4", byteSize: 920000, createdAt: now - 3600, inUse: false },
];

export const noteVersions = [
  { id: "v3", revision: 10, format: "rich-v1", title: "Ideas para el capítulo 3", preview: "Estructura del capítulo\nPartir de la motivación…", reason: "snapshot", createdAt: now - 1800 },
  { id: "v2", revision: 4, format: "rich-v1", title: "Ideas para el capítulo 3", preview: "Estructura\nMotivación y contexto", reason: "snapshot", createdAt: now - DAY },
  { id: "v1", revision: 0, format: "markdown", title: "Ideas para el capítulo 3", preview: "## Estructura\n- Motivación y contexto", reason: "legacy", createdAt: now - 3 * DAY },
];

export const noteContexts = {
  project: { id: "p-thesis", title: "Tesis doctoral", color: "#6C8CFF", at: null, status: null },
  tasks: [{ id: "k1", title: "Revisar el borrador del capítulo 3", color: "#6C8CFF", at: now + 3600, status: "in_progress" }],
  workspaces: [{ id: "w1", title: "Investigación", color: "#0EA5E9", at: null, status: null }],
  events: [{ id: "e2", title: "Seminario del grupo", color: "#6C8CFF", at: now + DAY, status: null }],
};

export const events = [
  { id: "e1", title: "Tutoría con estudiantes", day: 0, start: [15, 0], end: [16, 0], project: "p-course", location: "Despacho 2.14", weekly: true },
  { id: "e2", title: "Seminario del grupo", day: 1, start: [10, 0], end: [11, 30], project: "p-thesis", location: "Sala de reuniones" },
  { id: "e3", title: "Clase de Programación", day: 2, start: [9, 0], end: [11, 0], project: "p-course", location: "Aula 3", weekly: true },
  { id: "e4", title: "Revisión del panel", day: -1, start: [12, 0], end: [13, 0], project: "p-app", location: null },
  { id: "e5", title: "Llamada con el congreso", day: 3, start: [16, 30], end: [17, 0], project: "p-paper", location: null },
  { id: "e6", title: "Revisión de prácticas", day: 0, start: [13, 0], end: [14, 0], project: "p-course", location: null },
  // Una clase del horario de Docencia: se cambia desde allí.
  { id: "e7", title: "Desarrollo de Software VIII", day: 0, start: [19, 30], end: [22, 0], project: "p-course", location: "Laboratorio 2", weekly: true, teaching: true },
].map((event) => {
  const project = projectById[event.project];
  return {
    id: event.id,
    title: event.title,
    description: "",
    projectId: project.id,
    projectName: project.name,
    projectColor: project.color,
    startsAt: at(event.day, event.start[0], event.start[1]),
    endsAt: at(event.day, event.end[0], event.end[1]),
    isAllDay: false,
    location: event.location,
    reminderMinutes: 15,
    recurrence: "weekly" in event ? { frequency: "weekly", interval: 1, weekdays: [], fromCompletion: false, until: null } : null,
    // Las semanales empezaron la semana pasada: la de esta semana no es la primera.
    seriesStartsAt: at(event.day - ("weekly" in event ? 7 : 0), event.start[0], event.start[1]),
    source: "teaching" in event ? "teaching" : "local",
  };
});

export const trashItems = [
  { id: "x1", entityType: "task", entityId: "k10", title: "Revisar la rúbrica antigua", deletedAt: now - 2 * 3600, childCount: 3 },
  { id: "x2", entityType: "event_occurrences", entityId: "e3", title: "Clase de Programación", deletedAt: now - DAY, childCount: 0, occurrenceStart: at(-5, 9), occurrenceScope: "this" },
  { id: "x3", entityType: "project", entityId: "p-old", title: "Congreso 2025", deletedAt: now - 4 * DAY, childCount: 6 },
  { id: "x4", entityType: "event", entityId: "e9", title: "Café con el equipo", deletedAt: now - 12 * DAY, childCount: 0 },
].map((item) => ({ occurrenceStart: null, occurrenceScope: null, ...item, expiresAt: item.deletedAt + 30 * DAY }));

export const dashboard = {
  todayTasks: listTasks({ view: "today" }).length,
  overdueTasks: 1,
  completedToday: 1,
  activeProjects: 3,
  focusSecondsToday: 75 * 60,
  trackedSecondsToday: 3 * 3600 + 20 * 60,
  completionPercent: 25,
  upcomingTasks: tasks
    .filter((task) => task.status !== "completed" && task.dueAt !== null)
    .sort((left, right) => (left.dueAt ?? 0) - (right.dueAt ?? 0))
    .slice(0, 5)
    .map((task) => ({ id: task.id, title: task.title, priority: task.priority, dueAt: task.dueAt, dueHasTime: task.dueHasTime, projectColor: task.projectColor })),
  recentNotes: notes.slice(0, 3).map((note) => ({ id: note.id, title: note.title, preview: note.content.replace(/[#*]/g, "").split("\n").filter(Boolean).slice(0, 2).join(" "), color: note.color, updatedAt: note.updatedAt })),
  nextEvent: { id: "e1", title: "Tutoría con estudiantes", startsAt: at(0, 15), isAllDay: false },
  activeTimer: null,
};

const pomodoroSettings = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, autoStartBreaks: true, autoStartFocus: false, notifications: true };
const thesisContext = { taskId: "k1", taskTitle: "Revisar el borrador del capítulo 3", projectId: "p-thesis", projectName: "Tesis doctoral", projectColor: "#6C8CFF" };

export const timer = {
  pomodoro: { ...thesisContext, id: "s-now", sessionType: "focus", status: "running", plannedSeconds: 1500, elapsedSeconds: 396, remainingSeconds: 1104, startedAt: now - 396, expectedEndAt: now + 1104 },
  entry: null,
  nextSessionType: "short_break",
  cyclePosition: 2,
  focusCompletedToday: 2,
  settings: pomodoroSettings,
  asOfMs: Date.now(),
};

export const idleTimer = { ...timer, pomodoro: null, nextSessionType: "focus" };
export { pomodoroSettings };

export const focusSessions = [
  { ...thesisContext, id: "s1", sessionType: "focus", status: "completed", plannedSeconds: 1500, elapsedSeconds: 1500, startedAt: at(0, 8, 30), completedAt: at(0, 8, 55) },
  { ...thesisContext, id: "s2", sessionType: "short_break", status: "completed", plannedSeconds: 300, elapsedSeconds: 300, startedAt: at(0, 8, 55), completedAt: at(0, 9, 0) },
  { ...thesisContext, id: "s3", sessionType: "focus", status: "completed", plannedSeconds: 1500, elapsedSeconds: 1500, startedAt: at(0, 9, 45), completedAt: at(0, 10, 10) },
];

const dayHours = [5.5, 6.2, 4.1, 7, 3.4, 1.2, 0];
const todayIndex = Math.round((midnight - weekStart) / DAY);
export const timeStats = {
  weekStart,
  days: dayHours.map((hours, index) => ({
    dayStart: weekStart + index * DAY,
    trackedSeconds: index < todayIndex ? Math.round(hours * 3600) : index === todayIndex ? 3 * 3600 + 20 * 60 : 0,
    focusSeconds: index < todayIndex ? Math.round(hours * 0.45 * 3600) : index === todayIndex ? 75 * 60 : 0,
  })),
  todayTrackedSeconds: 3 * 3600 + 20 * 60,
  todayFocusSeconds: 75 * 60,
  weekTrackedSeconds: Math.round(dayHours.slice(0, todayIndex).reduce((sum, hours) => sum + hours, 0) * 3600) + 3 * 3600 + 20 * 60,
  weekFocusSeconds: 9 * 3600 + 40 * 60,
  focusSessionsToday: 2,
  projects: projects.slice(0, 3).map((project, index) => ({ projectId: project.id, name: project.name, color: project.color, seconds: [12, 7, 4][index] * 3600 })),
};

export const timeEntries = [
  { ...thesisContext, id: "te1", source: "pomodoro", status: "completed", startedAt: at(0, 8, 30), endedAt: at(0, 8, 55), durationSeconds: 1500, description: "" },
  { taskId: null, taskTitle: null, projectId: "p-course", projectName: "Curso de Programación", projectColor: "#F59E0B", id: "te2", source: "manual", status: "completed", startedAt: at(0, 7, 30), endedAt: at(0, 8, 20), durationSeconds: 3000, description: "Correo del curso" },
];

export const runningEntry = {
  taskId: null, taskTitle: null, projectId: "p-course", projectName: "Curso de Programación", projectColor: "#F59E0B",
  id: "te-now", status: "running", elapsedSeconds: 42 * 60 + 10, startedAt: now - (42 * 60 + 10), description: "Preparar ejercicios de recursión",
};

export const reminders = [
  { id: "r1", entityType: "task", entityId: "k1", title: "Revisar el borrador del capítulo 3", remindAt: at(0, 10, 50), status: "scheduled" },
  { id: "r2", entityType: "event", entityId: "e1", title: "Tutoría con estudiantes", remindAt: at(0, 14, 45), status: "scheduled" },
  { id: "r3", entityType: "task", entityId: "k3", title: "Responder correos de estudiantes", remindAt: at(0, 17, 20), status: "scheduled" },
];

export const workspaceState = {
  activeId: null,
  workspaces: [
    { id: "w1", name: "Investigación", color: "#0EA5E9", icon: "flask", taskView: "today", isArchived: false, projectIds: ["p-thesis", "p-paper"], noteIds: ["n1", "n5"], resources: [], openTaskCount: 12 },
    { id: "w2", name: "Programación", color: "#8B5CF6", icon: "code", taskView: "all", isArchived: false, projectIds: ["p-app"], noteIds: ["n3"], resources: [], openTaskCount: 3 },
    { id: "w3", name: "Docencia", color: "#F59E0B", icon: "graduation", taskView: "today", isArchived: false, projectIds: ["p-course"], noteIds: ["n2"], resources: [], openTaskCount: 10 },
  ].map((workspace) => ({ ...workspace, resources: [{ id: `${workspace.id}-folder`, kind: "folder", path: `/Users/demo/Documents/${workspace.name}`, label: workspace.name, exists: true }] })),
};

export const clipboardSettings = { enabled: true, paused: false, maxItems: 200, captureImages: true, skipSensitive: true, excludedApps: [] };
export const clipboardItems = [
  { preview: "La productividad no consiste en hacer más, sino en hacer lo importante.", app: "Safari", minutes: 3, favorite: true },
  { preview: "https://example.com/articulos/estado-del-arte.pdf", app: "Mail", minutes: 18, favorite: false },
  { preview: "SELECT nombre, nota FROM estudiantes WHERE curso = 'PRG-101' ORDER BY nota DESC;", app: "Visual Studio Code", minutes: 42, favorite: false },
  { preview: "Reunión de seguimiento: jueves 10:00, sala 2", app: "Notas", minutes: 95, favorite: true },
  { preview: "Smith, J. (2024). Deep learning for sensor data. Journal of Applied AI, 12(3), 45–67.", app: "Zotero", minutes: 160, favorite: false },
  { preview: "git commit -m \"Corrige la prueba del sensor\"", app: "Terminal", minutes: 300, favorite: false },
].map((item, index) => ({
  id: `c${index + 1}`,
  contentType: "text",
  preview: item.preview,
  charCount: item.preview.length,
  byteSize: item.preview.length,
  sourceApp: item.app,
  isFavorite: item.favorite,
  isSensitive: false,
  createdAt: now - item.minutes * 60,
}));

export const shortcuts = [
  { id: "new-note", label: "Nueva nota", keys: "⌥N", registered: true, error: null },
  { id: "new-task", label: "Nueva tarea", keys: "⌥⇧T", registered: true, error: null },
  { id: "open", label: "Abrir FlowDesk", keys: "⌥⇧F", registered: true, error: null },
  { id: "pomodoro", label: "Iniciar o pausar Pomodoro", keys: "⌥⇧P", registered: true, error: null },
];

export const capabilities = [
  "dashboard", "tasks", "projects", "notes", "global-shortcuts", "pomodoro", "time-tracking",
  "app-tracking", "calendar", "reminders", "workspaces", "clipboard", "menu-bar", "updates",
  "recurrence", "trash", "command-palette", "teaching", "backups",
];
