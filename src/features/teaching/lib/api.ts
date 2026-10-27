import { invoke } from "@tauri-apps/api/core";

// Comandos de Docencia (src-tauri/src/teaching/), todos con el prefijo `teaching_`.
import type {
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
  CourseInput,
  CourseSettings,
  CourseSettingsInput,
  Dashboard,
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
  TimeBlocks,
} from "../types";

export const api = {
  bootstrap: () => invoke<Bootstrap>("teaching_get_bootstrap"),
  dashboard: (courseId: number) => invoke<Dashboard>("teaching_get_dashboard", { courseId }),
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
};
