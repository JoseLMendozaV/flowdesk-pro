// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

export type AcademicEventInput = { id: number | null, courseId: number, title: string, eventType: string, startsAt: string, endsAt: string | null, description: string, reminderDays: number, };
