import { invoke } from "@tauri-apps/api/core";

// Comandos de Docencia (src-tauri/src/teaching/), todos con el prefijo `teaching_`.
import type {
  AcademicDay,
  AcademicDayInput,
  AcademicEventInput,
  AcademicEventRow,
  AcademicPeriodInput,
  AcademicPeriodRow,
  Analytics,
  AnnouncementInput,
  AnnouncementRow,
  AttendanceMatrix,
  AttendanceUpdate,
  Bootstrap,
  CalendarChange,
  CourseInput,
  CourseOverview,
  CourseSettings,
  CourseSettingsInput,
  DistributeResult,
  EvaluationInput,
  EvaluationRow,
  GenerateSessionsResult,
  GradeUpdate,
  Gradebook,
  GroupGradeUpdate,
  GroupGradebook,
  GroupInput,
  GroupRow,
  ImportResult,
  ImportStudentsResult,
  ObservationInput,
  OverviewLayout,
  RecoveryInput,
  ReportSummary,
  RubricCriterionInput,
  RubricCriterionRow,
  RubricMatrix,
  RubricScoreInput,
  ScheduleSlot,
  ScheduleSlotInput,
  SessionInput,
  StudentInput,
  StudentProfile,
  StudentRow,
  Syllabus,
  TimeBlocks,
  TopicInput,
} from "../types";

export const api = {
  bootstrap: () => invoke<Bootstrap>("teaching_get_bootstrap"),
  overview: (courseId: number) => invoke<CourseOverview>("teaching_get_overview", { courseId }),
  overviewLayout: () => invoke<OverviewLayout>("teaching_get_overview_layout"),
  saveOverviewLayout: (layout: OverviewLayout) => invoke<OverviewLayout>("teaching_save_overview_layout", { layout }),
  students: (courseId: number) => invoke<StudentRow[]>("teaching_get_students", { courseId }),
  attendance: (courseId: number) => invoke<AttendanceMatrix>("teaching_get_attendance", { courseId }),
  gradebook: (courseId: number) => invoke<Gradebook>("teaching_get_gradebook", { courseId }),
  createCourse: (input: CourseInput) => invoke<number>("teaching_create_course", { input }),
  addStudent: (courseId: number, input: StudentInput) =>
    invoke<number>("teaching_add_student", { courseId, input }),
  updateStudent: (enrollmentId: number, input: StudentInput, status: StudentRow["status"]) =>
    invoke<void>("teaching_update_student", { enrollmentId, input, status }),
  saveAttendance: (updates: AttendanceUpdate[]) => invoke<number>("teaching_save_attendance", { updates }),
  saveGrades: (updates: GradeUpdate[]) => invoke<number>("teaching_save_grades", { updates }),
  groupGradebook: (courseId: number) => invoke<GroupGradebook>("teaching_get_group_gradebook", { courseId }),
  saveGroupGrades: (updates: GroupGradeUpdate[]) =>
    invoke<number>("teaching_save_group_grades", { updates }),
  groups: (courseId: number) => invoke<GroupRow[]>("teaching_get_groups", { courseId }),
  saveGroup: (input: GroupInput) => invoke<number>("teaching_save_group", { input }),
  deleteGroup: (groupId: number) => invoke<void>("teaching_delete_group", { groupId }),
  evaluations: (courseId: number) => invoke<EvaluationRow[]>("teaching_get_evaluations", { courseId }),
  saveEvaluation: (input: EvaluationInput) => invoke<number>("teaching_save_evaluation", { input }),
  deleteEvaluation: (evaluationId: number) => invoke<void>("teaching_delete_evaluation", { evaluationId }),
  saveSession: (input: SessionInput) => invoke<number>("teaching_save_session", { input }),
  deleteSession: (sessionId: number) => invoke<void>("teaching_delete_session", { sessionId }),
  events: (courseId: number) => invoke<AcademicEventRow[]>("teaching_get_events", { courseId }),
  saveEvent: (input: AcademicEventInput) => invoke<number>("teaching_save_event", { input }),
  deleteEvent: (eventId: number) => invoke<void>("teaching_delete_event", { eventId }),
  analytics: (courseId: number) => invoke<Analytics>("teaching_get_analytics", { courseId }),
  report: (courseId: number) => invoke<ReportSummary>("teaching_get_report_summary", { courseId }),
  exportCsv: (courseId: number, path: string) =>
    invoke<void>("teaching_export_course_csv", { courseId, path }),
  exportExcel: (courseId: number, path: string) =>
    invoke<void>("teaching_export_course_excel", { courseId, path }),
  periods: () => invoke<AcademicPeriodRow[]>("teaching_get_periods"),
  savePeriod: (input: AcademicPeriodInput) => invoke<number>("teaching_save_period", { input }),
  deletePeriod: (periodId: number) => invoke<void>("teaching_delete_period", { periodId }),
  courseSettings: (courseId: number) => invoke<CourseSettings>("teaching_get_course_settings", { courseId }),
  saveCourseSettings: (input: CourseSettingsInput) =>
    invoke<void>("teaching_save_course_settings", { input }),
  rubric: (evaluationId: number) => invoke<RubricCriterionRow[]>("teaching_get_rubric", { evaluationId }),
  saveRubricCriterion: (input: RubricCriterionInput) =>
    invoke<number>("teaching_save_rubric_criterion", { input }),
  deleteRubricCriterion: (criterionId: number) =>
    invoke<void>("teaching_delete_rubric_criterion", { criterionId }),
  rubricMatrix: (evaluationId: number) =>
    invoke<RubricMatrix>("teaching_get_rubric_matrix", { evaluationId }),
  saveRubricScores: (evaluationId: number, updates: RubricScoreInput[]) =>
    invoke<number>("teaching_save_rubric_scores", { evaluationId, updates }),
  studentProfile: (enrollmentId: number) =>
    invoke<StudentProfile>("teaching_get_student_profile", { enrollmentId }),
  saveObservation: (input: ObservationInput) => invoke<number>("teaching_save_observation", { input }),
  toggleObservation: (observationId: number) =>
    invoke<void>("teaching_toggle_observation", { observationId }),
  applyRecovery: (input: RecoveryInput) => invoke<number>("teaching_apply_recovery", { input }),
  announcements: (courseId: number) => invoke<AnnouncementRow[]>("teaching_get_announcements", { courseId }),
  saveAnnouncement: (input: AnnouncementInput) => invoke<number>("teaching_save_announcement", { input }),
  deleteAnnouncement: (announcementId: number) =>
    invoke<void>("teaching_delete_announcement", { announcementId }),
  importStudentsExcel: (courseId: number, path: string) =>
    invoke<ImportStudentsResult>("teaching_import_students_excel", { courseId, path }),
  /** Base de la app de escritorio de Control Docente (control-docente.sqlite3). */
  importDesktop: (path: string) => invoke<ImportResult>("teaching_import_desktop", { path }),
  /** Base de la versión Django (db.sqlite3). */
  importDjango: (path: string) => invoke<ImportResult>("teaching_import_django", { path }),
  /** Respaldo de toda la base de FlowDesk. */
  backup: (path: string) => invoke<void>("teaching_backup_database", { path }),
  schedule: () => invoke<ScheduleSlot[]>("teaching_get_schedule"),
  saveScheduleSlot: (input: ScheduleSlotInput) => invoke<number>("teaching_save_schedule_slot", { input }),
  deleteScheduleSlot: (slotId: number) => invoke<void>("teaching_delete_schedule_slot", { slotId }),
  generateSessions: (courseId: number) =>
    invoke<GenerateSessionsResult>("teaching_generate_sessions", { courseId }),
  timeBlocks: () => invoke<TimeBlocks>("teaching_get_time_blocks"),
  saveTimeBlocks: (blocks: TimeBlocks) => invoke<TimeBlocks>("teaching_save_time_blocks", { blocks }),
  academicCalendar: () => invoke<AcademicDay[]>("teaching_get_academic_calendar"),
  saveAcademicDay: (input: AcademicDayInput) => invoke<CalendarChange>("teaching_save_academic_day", { input }),
  deleteAcademicDay: (dayId: number) => invoke<CalendarChange>("teaching_delete_academic_day", { dayId }),
  /** Feriados nacionales de Panamá (este año y el próximo) y calendario de la UTP. */
  loadOfficialCalendar: () => invoke<CalendarChange>("teaching_load_official_calendar"),
  syllabus: (courseId: number) => invoke<Syllabus>("teaching_get_syllabus", { courseId }),
  saveTopic: (input: TopicInput) => invoke<number>("teaching_save_topic", { input }),
  deleteTopic: (topicId: number) => invoke<void>("teaching_delete_topic", { topicId }),
  setTopicDone: (topicId: number, done: boolean) => invoke<void>("teaching_set_topic_done", { topicId, done }),
  /** Temario pegado, un tema por línea («Semana 3: …» fija la semana). */
  addTopics: (courseId: number, text: string) => invoke<number>("teaching_add_topics", { courseId, text }),
  reorderTopics: (courseId: number, ids: number[]) => invoke<void>("teaching_reorder_topics", { courseId, ids }),
  distributeTopics: (courseId: number, reset: boolean) =>
    invoke<DistributeResult>("teaching_distribute_topics", { courseId, reset }),
  /** Abre (o crea) la nota flotante para preparar la clase del tema. */
  prepareTopic: (topicId: number) => invoke<string>("teaching_prepare_topic", { topicId }),
};
