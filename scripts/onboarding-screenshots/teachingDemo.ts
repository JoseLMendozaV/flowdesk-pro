// Datos ficticios de Docencia para el arnés: dos materias con estudiantes inventados.
const names = [
  "Ana Castillo", "Bruno Díaz", "Carla Herrera", "Daniel Ortega", "Elena Quintero", "Fabián Ríos",
  "Gabriela Solís", "Hugo Vargas", "Irene Navarro", "Javier Molina", "Karen Pinzón", "Luis Barrios",
];

export const courses = [
  { id: 1, title: "Desarrollo de Software VIII", code: "8408", groupName: "2GS131", periodLabel: "Segundo semestre", professor: "Prof. Demo", isArchived: false, projectId: "p-course", color: "#E8A33D" },
  { id: 2, title: "Desarrollo de Software V", code: "8400", groupName: "2GS221", periodLabel: "Segundo semestre", professor: "Prof. Demo", isArchived: false, projectId: "p-app", color: "#2FB67C" },
];

const bootstrap = { databasePath: "~/Library/Application Support/com.flowdesk.pro/flowdesk.sqlite3", hasLegacyImport: true, courses, desktopDatabase: null };

const students = names.map((name, index) => ({
  enrollmentId: index + 1,
  studentId: index + 1,
  identification: `8-${900 + index * 7}-${1200 + index * 13}`,
  name,
  email: `${name.split(" ")[0].toLowerCase()}@demo.edu`,
  guardianName: "",
  guardianPhone: index % 3 ? `6${100 + index}-${4000 + index * 11}` : "",
  status: index === 11 ? "inactive" : "active",
  groupName: index < 4 ? "Equipo Alfa" : index < 8 ? "Equipo Beta" : null,
}));

const matrixStudents = students.filter((student) => student.status === "active").map(({ enrollmentId, name, identification }) => ({ enrollmentId, name, identification }));

const sessionDates = ["2026-09-29", "2026-10-01", "2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15"];
const sessions = sessionDates.map((date, index) => ({
  id: index + 1,
  number: index + 1,
  title: "",
  date,
  startTime: "19:30",
  endTime: "22:00",
  topic: ["Repaso de patrones", "Pruebas unitarias", "Integración continua", "Parcial 1", "Revisión del proyecto", "Arquitectura limpia"][index],
  isHeld: index < 5,
}));
const statuses = ["P", "P", "P", "T", "P", "A", "P", "J"] as const;
const attendanceCells = matrixStudents.flatMap((student, row) =>
  sessions.filter((session) => session.isHeld).map((session, column) => ({
    enrollmentId: student.enrollmentId,
    sessionId: session.id,
    status: statuses[(row * 3 + column) % statuses.length],
  })),
);

const evaluations = [
  { id: 1, name: "Taller 1", evaluationType: "task", gradingMode: "individual", weight: 15, maxScore: 100, active: true, sortOrder: 1, dueDate: "2026-09-24T23:59", rubricCount: 0 },
  { id: 2, name: "Parcial 1", evaluationType: "exam", gradingMode: "individual", weight: 25, maxScore: 100, active: true, sortOrder: 2, dueDate: "2026-10-08T19:30", rubricCount: 3 },
  { id: 3, name: "Proyecto integrador", evaluationType: "project", gradingMode: "group", weight: 30, maxScore: 100, active: true, sortOrder: 3, dueDate: "2026-11-26", rubricCount: 0 },
  { id: 4, name: "Participación", evaluationType: "participation", gradingMode: "individual", weight: 10, maxScore: 100, active: true, sortOrder: 4, dueDate: null, rubricCount: 0 },
];
const columns = evaluations.filter((evaluation) => evaluation.gradingMode === "individual").map(({ id, name, evaluationType, gradingMode, weight, maxScore }) => ({ id, name, evaluationType, gradingMode, weight, maxScore }));
const gradeCells = matrixStudents.flatMap((student, row) =>
  columns.slice(0, 2).map((column, index) => ({ enrollmentId: student.enrollmentId, evaluationId: column.id, score: 62 + ((row * 11 + index * 17) % 37) })),
);

// Como el horario oficial de la UTP: teoría y laboratorio, en bloques de 45 minutos.
const schedule = [
  { id: 1, courseId: 1, courseTitle: "Desarrollo de Software VIII", groupName: "2GS131", color: "#E8A33D", kind: "theory", weekday: 2, startTime: "14:30", endTime: "15:15", room: "2D3", startsOn: "2026-08-03", endsOn: "2026-12-04", reminderMinutes: 10, inCalendar: true },
  { id: 2, courseId: 1, courseTitle: "Desarrollo de Software VIII", groupName: "2GS131", color: "#E8A33D", kind: "lab", weekday: 2, startTime: "15:20", endTime: "16:55", room: "2D3", startsOn: "2026-08-03", endsOn: "2026-12-04", reminderMinutes: 10, inCalendar: true },
  { id: 3, courseId: 1, courseTitle: "Desarrollo de Software VIII", groupName: "2GS131", color: "#E8A33D", kind: "theory", weekday: 4, startTime: "12:50", endTime: "14:25", room: "2D3", startsOn: "2026-08-03", endsOn: "2026-12-04", reminderMinutes: 10, inCalendar: true },
  { id: 4, courseId: 2, courseTitle: "Desarrollo de Software V", groupName: "2GS221", color: "#2FB67C", kind: "theory", weekday: 3, startTime: "19:30", endTime: "20:15", room: "2A3", startsOn: "2026-08-03", endsOn: "2026-12-04", reminderMinutes: 10, inCalendar: true },
  { id: 5, courseId: 2, courseTitle: "Desarrollo de Software V", groupName: "2GS221", color: "#2FB67C", kind: "lab", weekday: 3, startTime: "20:20", endTime: "21:55", room: "2A3", startsOn: "2026-08-03", endsOn: "2026-12-04", reminderMinutes: 10, inCalendar: true },
  { id: 6, courseId: 2, courseTitle: "Desarrollo de Software V", groupName: "2GS221", color: "#2FB67C", kind: "theory", weekday: 5, startTime: "17:50", endTime: "19:25", room: "2A3", startsOn: "2026-08-03", endsOn: "2026-12-04", reminderMinutes: 10, inCalendar: true },
];

const overviewStudents = students.filter((student) => student.status === "active").map((student, index) => {
  const grade = index === 9 ? null : 58 + ((index * 13) % 40);
  const attendance = [100, 92, 85, 77, 100, 60, 92, 85, 72, 100, 92][index] ?? 90;
  const reasons = [grade !== null && grade < 71 ? "nota baja" : null, attendance < 80 ? "asistencia baja" : null].filter(Boolean) as string[];
  return {
    enrollmentId: student.enrollmentId,
    name: student.name,
    identification: student.identification,
    groupName: student.groupName,
    grade,
    attendance,
    absences: Math.round(((100 - attendance) / 100) * 13),
    status: reasons.length ? "at_risk" : grade === null ? "ungraded" : "approved",
    reasons,
  };
});

const overview = {
  course: courses[0],
  rules: { passingGrade: 71, attendanceMinimum: 80, lowGradeAlert: 71, lowAttendanceAlert: 80, promotionRequiresAttendance: true },
  stats: {
    activeStudents: 11, attendanceAverage: 86.8, gradeAverage: 78.4, configuredWeight: 80, heldSessions: 13, totalSessions: 32,
    activeEvaluations: 4, studentGroups: 2,
    approved: overviewStudents.filter((student) => student.status === "approved").length,
    atRisk: overviewStudents.filter((student) => student.status === "at_risk").length,
    ungraded: overviewStudents.filter((student) => student.status === "ungraded").length,
  },
  students: overviewStudents,
  gradeBands: [
    { label: "Crítico (menos de 60)", value: 1 },
    { label: "En riesgo", value: 2 },
    { label: "Satisfactorio", value: 5 },
    { label: "Excelente (90 o más)", value: 2 },
  ],
  sessions: Array.from({ length: 13 }, (_, index) => {
    const rate = [100, 91, 91, 82, 100, 73, 91, 64, 91, 100, 82, 91, 73][index];
    const attended = Math.round((rate / 100) * 11);
    return {
      sessionId: index + 1,
      number: index + 1,
      date: `2026-${index < 8 ? "09" : "10"}-${String(((index * 3) % 28) + 1).padStart(2, "0")}`,
      present: attended - 1,
      late: 1,
      excused: 0,
      absent: 11 - attended - (index === 7 ? 2 : 0),
      unmarked: index === 7 ? 2 : 0,
      rate,
    };
  }),
  evaluations: [
    { id: 1, name: "Taller 1", weight: 15, maxScore: 100, dueDate: "2026-09-24T23:59", average: 84.5, graded: 11, total: 11 },
    { id: 2, name: "Parcial 1", weight: 25, maxScore: 100, dueDate: "2026-10-08T19:30", average: 71.2, graded: 11, total: 11 },
    { id: 3, name: "Proyecto integrador", weight: 30, maxScore: 100, dueDate: "2026-11-26", average: 88, graded: 8, total: 11 },
    { id: 4, name: "Participación", weight: 10, maxScore: 100, dueDate: null, average: null, graded: 0, total: 11 },
  ],
  groups: [
    { label: "Equipo Alfa", value: 84 },
    { label: "Equipo Beta", value: 77 },
  ],
  agenda: [
    { title: "Entrega del avance del proyecto", kind: "delivery", startsAt: "2026-10-29T23:59" },
    { title: "Reunión de coordinación", kind: "meeting", startsAt: "2026-11-03T17:00" },
  ],
  nextClasses: [
    { startsAt: Math.floor(new Date(2026, 9, 27, 14, 30).getTime() / 1000), endsAt: Math.floor(new Date(2026, 9, 27, 15, 15).getTime() / 1000), kind: "theory", room: "2D3" },
    { startsAt: Math.floor(new Date(2026, 9, 27, 15, 20).getTime() / 1000), endsAt: Math.floor(new Date(2026, 9, 27, 16, 55).getTime() / 1000), kind: "lab", room: "2D3" },
    { startsAt: Math.floor(new Date(2026, 9, 29, 12, 50).getTime() / 1000), endsAt: Math.floor(new Date(2026, 9, 29, 14, 25).getTime() / 1000), kind: "theory", room: "2D3" },
  ],
  syllabus: { total: 15, done: 6, current: 7, currentTitle: "Pruebas unitarias con JUnit", currentId: 7, currentDate: "2026-10-22", behind: 1 },
};

// Plan del curso ficticio: 15 temas, 6 dados; el 7 tocaba el jueves pasado (atrasado) y el
// 8 es hoy. Del 3 al 10 de noviembre no hay clases (feriados).
const topicTitles = [
  "Introducción al desarrollo de software",
  "Requisitos y casos de uso",
  "Modelado con UML",
  "Patrones de diseño",
  "Arquitectura por capas",
  "Control de versiones con Git",
  "Pruebas unitarias con JUnit",
  "Integración continua",
  "Persistencia con JPA",
  "Servicios REST",
  "Seguridad en aplicaciones web",
  "Interfaces con React",
  "Despliegue en la nube",
  "Mantenimiento y refactorización",
  "Presentación del proyecto final",
];
const planDates = ["2026-09-29", "2026-10-01", "2026-10-06", "2026-10-08", "2026-10-13", "2026-10-20", "2026-10-22", "2026-10-27", "2026-10-29", "2026-11-12", "2026-11-17", "2026-11-19", "2026-11-24"];
export const syllabus = {
  topics: topicTitles.map((title, index) => ({
    id: index + 1,
    position: index + 1,
    title,
    week: index >= 13 ? 15 : null,
    details: index === 6 ? "Casos de prueba, aserciones y cobertura" : "",
    sessionId: index < 13 ? index + 1 : null,
    sessionNumber: index < 13 ? index + 1 : null,
    sessionDate: index < 13 ? planDates[index] : null,
    sessionWeek: index < 13 ? Math.floor(index / 2) + 1 : null,
    done: index < 6,
    noteId: index === 6 ? "n1" : null,
  })),
  sessions: planDates.map((date, index) => ({ id: index + 1, number: index + 1, date, week: Math.floor(index / 2) + 1, held: index < 6, dayOff: false })),
  progress: overview.syllabus,
};

// Calendario académico ficticio: feriados de Panamá y días de la UTP del II semestre.
export const academicDays = [
  { id: 1, title: "Aniversario de la UTP", kind: "break", startsOn: "2026-08-14", endsOn: "2026-08-14", cancelsClasses: true, source: "utp" },
  { id: 2, title: "Clases del II semestre 2026", kind: "term", startsOn: "2026-08-17", endsOn: "2026-12-05", cancelsClasses: false, source: "utp" },
  { id: 3, title: "Día de los Difuntos", kind: "break", startsOn: "2026-11-02", endsOn: "2026-11-02", cancelsClasses: true, source: "utp" },
  { id: 4, title: "Separación de Panamá de Colombia", kind: "holiday", startsOn: "2026-11-03", endsOn: "2026-11-03", cancelsClasses: true, source: "panama" },
  { id: 5, title: "Día de los Símbolos Patrios", kind: "break", startsOn: "2026-11-04", endsOn: "2026-11-04", cancelsClasses: true, source: "utp" },
  { id: 6, title: "Consolidación de la Separación (Colón)", kind: "holiday", startsOn: "2026-11-05", endsOn: "2026-11-05", cancelsClasses: true, source: "panama" },
  { id: 7, title: "Día compensado", kind: "break", startsOn: "2026-11-06", endsOn: "2026-11-06", cancelsClasses: true, source: "utp" },
  { id: 8, title: "Primer Grito de Independencia", kind: "holiday", startsOn: "2026-11-10", endsOn: "2026-11-10", cancelsClasses: true, source: "panama" },
  { id: 9, title: "Últimos retiros de asignatura", kind: "deadline", startsOn: "2026-11-16", endsOn: "2026-11-16", cancelsClasses: false, source: "utp" },
  { id: 10, title: "Independencia de Panamá de España", kind: "holiday", startsOn: "2026-11-28", endsOn: "2026-11-28", cancelsClasses: true, source: "panama" },
  { id: 11, title: "Exámenes finales del II semestre", kind: "exams", startsOn: "2026-12-07", endsOn: "2026-12-22", cancelsClasses: true, source: "utp" },
  { id: 12, title: "Día de la Madre", kind: "holiday", startsOn: "2026-12-08", endsOn: "2026-12-08", cancelsClasses: true, source: "panama" },
  { id: 13, title: "Entrega de calificaciones del II semestre", kind: "deadline", startsOn: "2026-12-14", endsOn: "2026-12-29", cancelsClasses: false, source: "utp" },
];

let overviewLayout = {
  widgets: ["kpis", "attention", "agenda", "plan", "attendance-trend", "grade-distribution", "evaluations", "students", "groups", "quick-actions"].map((id) => ({ id, visible: true })),
};


const groups = [
  { id: 1, name: "Equipo Alfa", description: "Aplicación de inventarios", leaderName: "Ana Castillo", memberCount: 4, members: students.slice(0, 4).map((student, index) => ({ enrollmentId: student.enrollmentId, name: student.name, identification: student.identification, isLeader: index === 0 })) },
  { id: 2, name: "Equipo Beta", description: "Plataforma de reservas", leaderName: "Elena Quintero", memberCount: 4, members: students.slice(4, 8).map((student, index) => ({ enrollmentId: student.enrollmentId, name: student.name, identification: student.identification, isLeader: index === 0 })) },
];

const events = [
  { id: 1, title: "Entrega del avance del proyecto", eventType: "delivery", startsAt: "2026-10-29T23:59", endsAt: null, description: "Por la plataforma", reminderDays: 1 },
  { id: 2, title: "Reunión de coordinación", eventType: "meeting", startsAt: "2026-11-03T17:00", endsAt: "2026-11-03T18:00", description: "", reminderDays: 1 },
];

const analytics = {
  totalStudents: 11, approved: 8, atRisk: 3, ungraded: 0, attendanceAverage: 86.4, gradeAverage: 78.9,
  performanceBands: [{ label: "Crítico", value: 1 }, { label: "En riesgo", value: 2 }, { label: "Satisfactorio", value: 5 }, { label: "Excelente", value: 3 }],
  attendanceBands: [{ label: "Baja", value: 2 }, { label: "Media", value: 4 }, { label: "Alta", value: 5 }],
  groupPerformance: [{ label: "Equipo Alfa", value: 84 }, { label: "Equipo Beta", value: 77 }],
  risks: [
    { name: "Fabián Ríos", identification: "8-935-1265", grade: 64.5, attendance: 60, reason: "nota baja y asistencia baja" },
    { name: "Irene Navarro", identification: "8-956-1304", grade: 81, attendance: 72, reason: "asistencia baja" },
  ],
};

// Hoja de notas del proyecto final (UTP): tres equipos ficticios y la plantilla ya elegida.
const sheetReasons = [
  "Que los alumnos alcancen o logren de manera práctica los objetivos de aprendizaje.",
  "Que los alumnos puedan elaborar proyectos que den respuesta a los problemas y / o retos de la vida real",
  "Que los alumnos pongan en práctica las etapas de desarrollo de un proyecto.",
  "Que los alumnos se motiven al desarrollo de investigaciones",
  "Que los alumnos apliquen estrategias y herramientas para resolver problemas",
  "Que los alumnos desarrollen competencias como el trabajo en equipo, la toma de decisiones y la búsqueda de información",
  "Otros (Explique)",
];
const sheetGrades = [91.5, 88, 84.25, 79.5, 95, 72.4, null, 86.5, 77, 90.5, 68.75];
let finalSheetSettings = {
  teacherName: "Prof. Demo",
  teacherIdentification: "4-700-1234",
  career: "Licenciatura en Desarrollo de Software",
  subject: courses[0].title,
  subjectCode: "8408",
  scheduleCode: "",
  groupName: "2GS131",
  year: "2026",
  period: "II Semestre",
  evaluationId: 3 as number | null,
  decimals: 0,
  reasons: [0, 5],
  otherReason: "",
  teamNotes: { "1": "Entregaron a tiempo y con buena documentación." } as Record<string, string>,
};
function finalSheetPreview() {
  const decimals = finalSheetSettings.decimals;
  const round = (value: number) => Math.round(value * 10 ** decimals + 1e-9) / 10 ** decimals;
  const teams = [
    { id: 1, name: "Equipo Alfa", from: 0, to: 4 },
    { id: 2, name: "Equipo Beta", from: 4, to: 8 },
    { id: 3, name: "Equipo Gamma", from: 8, to: 11 },
  ].map((team, index) => ({
    id: team.id,
    name: team.name,
    sheet: `GRUPO ${index + 1}`,
    members: students.slice(team.from, team.to).map((student, offset) => {
      const grade = sheetGrades[team.from + offset];
      return { name: student.name, identification: team.from + offset === 9 ? "" : student.identification, grade, value: grade == null ? null : round(grade) };
    }),
  }));
  const issues = [
    ...(finalSheetSettings.scheduleCode ? [] : [{ level: "warning", message: "Falta: código de horario." }]),
    { level: "warning", message: `Sin nota (la celda queda vacía): ${students[6].name}.` },
    { level: "warning", message: `Sin cédula: ${students[9].name}.` },
  ];
  return {
    settings: finalSheetSettings,
    template: { name: "FORMATO DE REGISTRO DE PROYECTOS POR SEMESTRAL_.xlsx", groups: 8, rowsPerGroup: 10, reasons: sheetReasons },
    evaluations: evaluations.map((evaluation) => ({ id: evaluation.id, name: evaluation.name, gradingMode: evaluation.gradingMode, maxScore: evaluation.maxScore })),
    teams,
    unassigned: [],
    issues,
    canExport: true,
    suggestedFileName: `Registro de proyectos finales - ${courses[0].title} 2GS131.xlsx`,
  };
}

export const teachingHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  teaching_get_bootstrap: () => bootstrap,
  teaching_get_overview: () => overview,
  teaching_get_overview_layout: () => overviewLayout,
  teaching_save_overview_layout: (args) => (overviewLayout = args.layout as typeof overviewLayout),
  teaching_get_schedule: () => schedule,
  teaching_get_time_blocks: () => ({ first: "07:00", minutes: 45, gap: 5, count: 19 }),
  teaching_get_periods: () => [],
  teaching_get_students: () => students,
  teaching_get_attendance: () => ({ students: matrixStudents, sessions, cells: attendanceCells }),
  teaching_get_gradebook: () => ({ students: matrixStudents, evaluations: columns, cells: gradeCells }),
  teaching_get_group_gradebook: () => ({ groups: groups.map((group) => ({ groupId: group.id, name: group.name, memberCount: group.memberCount })), evaluations: [], cells: [] }),
  teaching_get_groups: () => groups,
  teaching_get_evaluations: () => evaluations,
  teaching_get_events: () => events,
  teaching_get_announcements: () => [],
  teaching_get_analytics: () => analytics,
  teaching_get_report_summary: () => ({ course: courses[0], generatedAt: new Date().toISOString(), totalStudents: 12, activeStudents: 11, sessions: 6, evaluations: 4, groups: 2, gradeAverage: 78.9, attendanceAverage: 86.4 }),
  teaching_get_course_settings: () => ({ id: 1, title: courses[0].title, code: "8408", groupName: "2GS131", periodLabel: "Segundo semestre", academicPeriodId: null, professor: "Prof. Demo", passingGrade: 71, attendanceMinimum: 80, lowGradeAlert: 71, lowAttendanceAlert: 80, promotionRequiresAttendance: true, isArchived: false }),
  teaching_generate_sessions: () => ({ created: 30, updated: 1, skipped: 6 }),
  teaching_get_syllabus: () => syllabus,
  teaching_get_final_sheet: () => finalSheetPreview(),
  teaching_save_final_sheet_settings: (args) => {
    finalSheetSettings = args.settings as typeof finalSheetSettings;
    return finalSheetPreview();
  },
  teaching_set_final_sheet_template: () => ({ name: "FORMATO DE REGISTRO DE PROYECTOS POR SEMESTRAL_.xlsx", groups: 8, rowsPerGroup: 10, reasons: sheetReasons }),
  teaching_export_final_sheet: () => ({ teams: 3, students: 11 }),
  teaching_prepare_topic: () => "n1",
  teaching_set_topic_done: () => null,
  teaching_add_topics: (args) => String(args.text).split("\n").filter((line) => line.trim()).length,
  teaching_distribute_topics: () => ({ linked: 2, left: 0 }),
  teaching_reorder_topics: () => null,
  teaching_get_academic_calendar: () => academicDays,
  teaching_load_official_calendar: () => ({ added: 29, removedSessions: 4, keptSessions: 1, restoredSessions: 0 }),
  teaching_save_academic_day: () => ({ added: 0, removedSessions: 1, keptSessions: 0, restoredSessions: 0 }),
  teaching_delete_academic_day: () => ({ added: 0, removedSessions: 0, keptSessions: 0, restoredSessions: 1 }),
  teaching_save_schedule_slot: () => 5,
};
