use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub due_at: Option<i64>,
    pub due_has_time: bool,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub estimated_minutes: Option<i64>,
    pub tracked_seconds: i64,
    pub subtask_count: i64,
    pub subtasks_completed: i64,
    pub note_count: i64,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: String,
    pub title: String,
    pub is_completed: bool,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedNote {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub color: String,
    pub is_archived: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    #[serde(flatten)]
    pub summary: TaskSummary,
    pub description: String,
    pub subtasks: Vec<Subtask>,
    pub notes: Vec<LinkedNote>,
}

/// Campos editables de una tarea. Se usa tanto al crear como al actualizar.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskInput {
    pub title: String,
    pub description: String,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub due_at: Option<i64>,
    pub due_has_time: Option<bool>,
    pub project_id: Option<String>,
    pub estimated_minutes: Option<i64>,
    pub tags: Vec<String>,
    /// Solo al crear: nota de origen que quedará vinculada.
    pub note_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskView {
    #[default]
    All,
    Today,
    Upcoming,
    Completed,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskSort {
    #[default]
    Due,
    Priority,
    Created,
    Title,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskFilter {
    pub view: TaskView,
    pub sort: TaskSort,
    pub search: Option<String>,
    /// Identificador de proyecto, o `"none"` para tareas sin proyecto.
    pub project_id: Option<String>,
    pub priority: Option<String>,
    pub status: Option<String>,
    pub tag_id: Option<String>,
    pub include_completed: bool,
}
