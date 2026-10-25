use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub status: String,
    pub starts_at: Option<i64>,
    pub target_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
    pub task_count: i64,
    pub completed_task_count: i64,
    pub open_task_count: i64,
    pub overdue_task_count: i64,
    pub note_count: i64,
    pub tracked_seconds: i64,
    pub progress_percent: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectInput {
    pub name: String,
    pub description: String,
    pub color: String,
    pub status: String,
    pub starts_at: Option<i64>,
    pub target_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectDeleteMode {
    /// Conserva tareas y notas sin proyecto asignado.
    KeepTasks,
    /// Elimina también las tareas; las notas solo se desvinculan.
    DeleteTasks,
}
