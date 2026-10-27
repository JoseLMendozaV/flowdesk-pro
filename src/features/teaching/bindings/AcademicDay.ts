// Igual que los structs del mismo nombre en src-tauri/src/teaching/models.rs.

export type AcademicDayKind = "holiday" | "break" | "exams" | "term" | "deadline";

/** Día o periodo del calendario académico. Fechas `AAAA-MM-DD`, ambas incluidas. */
export type AcademicDay = {
  id: number;
  title: string;
  kind: AcademicDayKind;
  startsOn: string;
  endsOn: string;
  cancelsClasses: boolean;
  source: "panama" | "utp" | "user";
};

export type AcademicDayInput = Omit<AcademicDay, "id" | "source"> & { id: number | null };

/** Efecto de un cambio del calendario académico en Docencia. */
export type CalendarChange = {
  /** Días añadidos al cargar el calendario oficial. */
  added: number;
  /** Sesiones de asistencia vacías que caían en días sin clases y se quitaron. */
  removedSessions: number;
  /** Sesiones en días sin clases que se conservan porque ya tienen asistencia. */
  keptSessions: number;
  /** Sesiones que vuelven a crearse en días que dejaron de ser libres. */
  restoredSessions: number;
};
