// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.

export type CourseSummary = {
  id: number;
  title: string;
  code: string;
  groupName: string;
  periodLabel: string;
  professor: string;
  isArchived: boolean;
  /** Proyecto de FlowDesk de la materia y su color. */
  projectId: string | null;
  color: string;
};
