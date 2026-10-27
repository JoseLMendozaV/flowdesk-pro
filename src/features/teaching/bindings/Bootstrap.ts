// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { CourseSummary } from "./CourseSummary";

export type Bootstrap = {
  databasePath: string;
  hasLegacyImport: boolean;
  courses: Array<CourseSummary>;
  /** Base de la app de escritorio de Control Docente en este Mac, para importarla. */
  desktopDatabase: string | null;
};
