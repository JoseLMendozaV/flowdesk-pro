// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

export type EvaluationRow = { id: number, name: string, evaluationType: string, gradingMode: string, weight: number, maxScore: number, active: boolean, sortOrder: number, dueDate: string | null, rubricCount: number, };
