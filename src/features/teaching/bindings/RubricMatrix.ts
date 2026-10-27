// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { MatrixStudent } from "./MatrixStudent";
import type { RubricCriterionRow } from "./RubricCriterionRow";
import type { RubricScoreCell } from "./RubricScoreCell";

export type RubricMatrix = { students: Array<MatrixStudent>, criteria: Array<RubricCriterionRow>, cells: Array<RubricScoreCell>, };
