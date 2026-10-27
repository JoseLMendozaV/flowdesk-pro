// Los tipos de datos se generan desde los structs de Rust (src-tauri/src/models.rs) con
// `npm run bindings`. Aquí se reexportan para importarlos desde un solo lugar.
export type { AcademicEventInput } from "./bindings/AcademicEventInput";
export type { AcademicEventRow } from "./bindings/AcademicEventRow";
export type { AcademicPeriodInput } from "./bindings/AcademicPeriodInput";
export type { AcademicPeriodRow } from "./bindings/AcademicPeriodRow";
export type { Analytics } from "./bindings/Analytics";
export type { AnnouncementInput } from "./bindings/AnnouncementInput";
export type { AnnouncementRow } from "./bindings/AnnouncementRow";
export type { AttendanceCell } from "./bindings/AttendanceCell";
export type { AttendanceMatrix } from "./bindings/AttendanceMatrix";
export type { AttendanceUpdate } from "./bindings/AttendanceUpdate";
export type { AttentionStudent } from "./bindings/AttentionStudent";
export type { Bootstrap } from "./bindings/Bootstrap";
export type { ChartValue } from "./bindings/ChartValue";
export type { CourseInput } from "./bindings/CourseInput";
export type { CourseSettings } from "./bindings/CourseSettings";
export type { CourseSettingsInput } from "./bindings/CourseSettingsInput";
export type { CourseSummary } from "./bindings/CourseSummary";
export type { Dashboard } from "./bindings/Dashboard";
export type { DashboardStats } from "./bindings/DashboardStats";
export type { EvaluationColumn } from "./bindings/EvaluationColumn";
export type { EvaluationInput } from "./bindings/EvaluationInput";
export type { EvaluationRow } from "./bindings/EvaluationRow";
export type { GradeCell } from "./bindings/GradeCell";
export type { GradeUpdate } from "./bindings/GradeUpdate";
export type { Gradebook } from "./bindings/Gradebook";
export type { GroupGradeCell } from "./bindings/GroupGradeCell";
export type { GroupGradeRow } from "./bindings/GroupGradeRow";
export type { GroupGradeUpdate } from "./bindings/GroupGradeUpdate";
export type { GroupGradebook } from "./bindings/GroupGradebook";
export type { GroupInput } from "./bindings/GroupInput";
export type { GroupMember } from "./bindings/GroupMember";
export type { GroupRow } from "./bindings/GroupRow";
export type { ImportResult } from "./bindings/ImportResult";
export type { ImportStudentsResult } from "./bindings/ImportStudentsResult";
export type { MatrixStudent } from "./bindings/MatrixStudent";
export type { ObservationInput } from "./bindings/ObservationInput";
export type { ObservationRow } from "./bindings/ObservationRow";
export type { RecoveryInput } from "./bindings/RecoveryInput";
export type { RecoveryRow } from "./bindings/RecoveryRow";
export type { ReportSummary } from "./bindings/ReportSummary";
export type { RiskStudent } from "./bindings/RiskStudent";
export type { RubricCriterionInput } from "./bindings/RubricCriterionInput";
export type { RubricCriterionRow } from "./bindings/RubricCriterionRow";
export type { RubricMatrix } from "./bindings/RubricMatrix";
export type { RubricScoreCell } from "./bindings/RubricScoreCell";
export type { RubricScoreInput } from "./bindings/RubricScoreInput";
export type { GenerateSessionsResult, ScheduleKind, ScheduleSlot, ScheduleSlotInput, TimeBlocks } from "./bindings/ScheduleSlot";
export type { SessionColumn } from "./bindings/SessionColumn";
export type { SessionInput } from "./bindings/SessionInput";
export type { StudentGradeRow } from "./bindings/StudentGradeRow";
export type { StudentInput } from "./bindings/StudentInput";
export type { StudentProfile } from "./bindings/StudentProfile";
export type { StudentRow } from "./bindings/StudentRow";
export type { UpcomingEvent } from "./bindings/UpcomingEvent";

export type Page =
  | "dashboard"
  | "schedule"
  | "students"
  | "groups"
  | "attendance"
  | "evaluations"
  | "grades"
  | "planning"
  | "analytics"
  | "reports"
  | "settings";
