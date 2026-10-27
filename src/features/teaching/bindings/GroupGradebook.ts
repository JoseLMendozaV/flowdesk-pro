// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { EvaluationColumn } from "./EvaluationColumn";
import type { GroupGradeCell } from "./GroupGradeCell";
import type { GroupGradeRow } from "./GroupGradeRow";

export type GroupGradebook = { groups: Array<GroupGradeRow>, evaluations: Array<EvaluationColumn>, cells: Array<GroupGradeCell>, };
