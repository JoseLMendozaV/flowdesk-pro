// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { ChartValue } from "./ChartValue";
import type { RiskStudent } from "./RiskStudent";

export type Analytics = { totalStudents: number, approved: number, atRisk: number, ungraded: number, attendanceAverage: number, gradeAverage: number | null, performanceBands: Array<ChartValue>, attendanceBands: Array<ChartValue>, groupPerformance: Array<ChartValue>, risks: Array<RiskStudent>, };
