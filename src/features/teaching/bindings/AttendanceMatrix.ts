// Igual que el struct del mismo nombre en src-tauri/src/teaching/models.rs.
import type { AttendanceCell } from "./AttendanceCell";
import type { MatrixStudent } from "./MatrixStudent";
import type { SessionColumn } from "./SessionColumn";

export type AttendanceMatrix = { students: Array<MatrixStudent>, sessions: Array<SessionColumn>, cells: Array<AttendanceCell>, };
