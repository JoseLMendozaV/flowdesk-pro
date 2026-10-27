// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

export type GroupInput = { id: number | null, courseId: number, name: string, description: string, enrollmentIds: Array<number>, leaderEnrollmentId: number | null, };
