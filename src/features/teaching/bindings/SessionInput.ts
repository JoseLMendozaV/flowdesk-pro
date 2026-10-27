// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

export type SessionInput = { id: number | null, courseId: number, number: number, title: string, date: string | null, startTime: string | null, endTime: string | null, topic: string, isHeld: boolean, };
