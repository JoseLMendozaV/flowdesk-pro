// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

export type StudentRow = { enrollmentId: number, studentId: number, identification: string, name: string, email: string, guardianName: string, guardianPhone: string, status: "active" | "inactive", groupName: string | null, };
