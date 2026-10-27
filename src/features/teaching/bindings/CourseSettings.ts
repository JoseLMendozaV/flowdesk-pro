// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

export type CourseSettings = { id: number, title: string, code: string, groupName: string, periodLabel: string, academicPeriodId: number | null, professor: string, passingGrade: number, attendanceMinimum: number, lowGradeAlert: number, lowAttendanceAlert: number, promotionRequiresAttendance: boolean, isArchived: boolean, };
