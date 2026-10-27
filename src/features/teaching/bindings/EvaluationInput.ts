// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

export type EvaluationInput = { id: number | null, courseId: number, name: string, evaluationType: string, gradingMode: string, weight: number, maxScore: number, active: boolean, dueDate: string | null, };
