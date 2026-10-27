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

const dashboard = {
  course: courses[0],
  stats: { activeStudents: 11, attendanceAverage: 86.4, gradeAverage: 78.9, configuredWeight: 80, heldSessions: 5, activeEvaluations: 4, studentGroups: 2, groupEvaluations: 1 },
  attention: [
    { enrollmentId: 6, name: "Fabián Ríos", identification: "8-935-1265", attendance: 60 },
    { enrollmentId: 9, name: "Irene Navarro", identification: "8-956-1304", attendance: 72 },
  ],
  upcomingEvents: [{ id: 1, title: "Entrega del avance del proyecto", eventType: "delivery", startsAt: "2026-10-29T23:59" }],
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

export const teachingHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  teaching_get_bootstrap: () => bootstrap,
  teaching_get_dashboard: () => dashboard,
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
  teaching_generate_sessions: () => ({ created: 30, updated: 1 }),
  teaching_save_schedule_slot: () => 5,
};
