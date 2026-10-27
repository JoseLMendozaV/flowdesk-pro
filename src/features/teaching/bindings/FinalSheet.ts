// Igual que los structs de src-tauri/src/teaching/final_sheet.rs.

/** Datos de la hoja que no están en la materia, guardados por materia. */
export type FinalSheetSettings = {
  teacherName: string;
  teacherIdentification: string;
  career: string;
  subject: string;
  subjectCode: string;
  scheduleCode: string;
  groupName: string;
  year: string;
  period: string;
  /** Evaluación cuya nota va a la hoja; `null`, la nota final del curso. */
  evaluationId: number | null;
  /** Decimales al redondear (0 o 1). */
  decimals: number;
  /** Motivos marcados con X (índices de `TemplateInfo.reasons`). */
  reasons: number[];
  otherReason: string;
  /** «Observaciones al trabajo» por id de equipo. */
  teamNotes: Record<string, string>;
};

export type TemplateInfo = { name: string; groups: number; rowsPerGroup: number; reasons: string[] };

export type SheetMember = {
  name: string;
  identification: string;
  /** Nota sobre 100 sin redondear. */
  grade: number | null;
  /** La que va a la hoja, redondeada. */
  value: number | null;
};

export type SheetTeam = { id: number; name: string; sheet: string | null; members: SheetMember[] };

export type SheetIssue = { level: "error" | "warning"; message: string };

export type FinalSheetPreview = {
  settings: FinalSheetSettings;
  template: TemplateInfo | null;
  evaluations: { id: number; name: string; gradingMode: string; maxScore: number }[];
  teams: SheetTeam[];
  unassigned: string[];
  issues: SheetIssue[];
  canExport: boolean;
  suggestedFileName: string;
};

export type ExportSummary = { teams: number; students: number };
