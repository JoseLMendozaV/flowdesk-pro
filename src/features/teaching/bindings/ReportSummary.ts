// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { CourseSummary } from "./CourseSummary";

export type ReportSummary = { course: CourseSummary, generatedAt: string, totalStudents: number, activeStudents: number, sessions: number, evaluations: number, groups: number, gradeAverage: number | null, attendanceAverage: number, };
