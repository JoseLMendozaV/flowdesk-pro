// Igual que los structs del mismo nombre en src-tauri/src/teaching/models.rs.
import type { ChartValue } from "./ChartValue";
import type { CourseSummary } from "./CourseSummary";
import type { SyllabusProgress } from "./Syllabus";

export type OverviewRules = {
  passingGrade: number;
  attendanceMinimum: number;
  lowGradeAlert: number;
  lowAttendanceAlert: number;
  promotionRequiresAttendance: boolean;
};

export type OverviewStats = {
  activeStudents: number;
  attendanceAverage: number;
  gradeAverage: number | null;
  configuredWeight: number;
  heldSessions: number;
  totalSessions: number;
  activeEvaluations: number;
  studentGroups: number;
  approved: number;
  atRisk: number;
  ungraded: number;
};

export type StudentStatus = "approved" | "at_risk" | "ungraded";

/** Nota ponderada (0–100) sobre lo evaluado y asistencia sobre las clases realizadas. */
export type StudentOverview = {
  enrollmentId: number;
  name: string;
  identification: string;
  groupName: string | null;
  grade: number | null;
  attendance: number;
  absences: number;
  status: StudentStatus;
  reasons: string[];
};

/** `rate`: P, T y J sobre los estudiantes activos. */
export type SessionAttendance = {
  sessionId: number;
  number: number;
  date: string | null;
  present: number;
  late: number;
  excused: number;
  absent: number;
  unmarked: number;
  rate: number;
};

export type EvaluationAverage = {
  id: number;
  name: string;
  weight: number;
  maxScore: number;
  dueDate: string | null;
  /** Porcentaje del puntaje máximo. */
  average: number | null;
  graded: number;
  total: number;
};

export type UpcomingItem = { title: string; kind: string; startsAt: string };
export type NextClass = { startsAt: number; endsAt: number; kind: "class" | "theory" | "lab"; room: string };

export type CourseOverview = {
  course: CourseSummary;
  rules: OverviewRules;
  stats: OverviewStats;
  students: StudentOverview[];
  gradeBands: ChartValue[];
  sessions: SessionAttendance[];
  evaluations: EvaluationAverage[];
  groups: ChartValue[];
  agenda: UpcomingItem[];
  nextClasses: NextClass[];
  syllabus: SyllabusProgress;
};

export type OverviewWidgetId =
  | "kpis"
  | "attention"
  | "attendance-trend"
  | "grade-distribution"
  | "students"
  | "evaluations"
  | "groups"
  | "agenda"
  | "plan"
  | "quick-actions";

export type OverviewLayout = { widgets: { id: OverviewWidgetId; visible: boolean }[] };
