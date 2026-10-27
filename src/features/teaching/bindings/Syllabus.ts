// Igual que los structs del mismo nombre en src-tauri/src/teaching/models.rs.

/** Tema del plan del curso. Fechas `AAAA-MM-DD`. */
export type CourseTopic = {
  id: number;
  position: number;
  title: string;
  /** Semana prevista cuando el tema aún no tiene sesión. */
  week: number | null;
  details: string;
  sessionId: number | null;
  sessionNumber: number | null;
  sessionDate: string | null;
  /** Semana del curso de la sesión (la 1 es la de la primera sesión). */
  sessionWeek: number | null;
  done: boolean;
  noteId: string | null;
};

/** Sesión de asistencia a la que se puede asignar un tema. */
export type TopicSession = {
  id: number;
  number: number;
  date: string | null;
  week: number | null;
  held: boolean;
  dayOff: boolean;
};

/** «Vamos en el tema 7 de 15». */
export type SyllabusProgress = {
  total: number;
  done: number;
  /** Posición (desde 1) del primer tema pendiente. */
  current: number | null;
  currentTitle: string | null;
  currentId: number | null;
  currentDate: string | null;
  /** Temas pendientes cuya sesión ya pasó. */
  behind: number;
};

export type Syllabus = { topics: CourseTopic[]; sessions: TopicSession[]; progress: SyllabusProgress };

export type TopicInput = {
  id: number | null;
  courseId: number;
  title: string;
  week: number | null;
  details: string;
  sessionId: number | null;
  done: boolean;
};

export type DistributeResult = { linked: number; left: number };
