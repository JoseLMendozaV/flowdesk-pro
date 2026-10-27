// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { ObservationRow } from "./ObservationRow";
import type { RecoveryRow } from "./RecoveryRow";
import type { StudentGradeRow } from "./StudentGradeRow";

export type StudentProfile = { enrollmentId: number, name: string, identification: string, email: string, guardianName: string, guardianEmail: string, guardianPhone: string, status: "active" | "inactive", grade: number | null, attendance: number, observations: Array<ObservationRow>, grades: Array<StudentGradeRow>, recoveries: Array<RecoveryRow>, };
