// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { EvaluationColumn } from "./EvaluationColumn";
import type { GradeCell } from "./GradeCell";
import type { MatrixStudent } from "./MatrixStudent";

export type Gradebook = { students: Array<MatrixStudent>, evaluations: Array<EvaluationColumn>, cells: Array<GradeCell>, };
