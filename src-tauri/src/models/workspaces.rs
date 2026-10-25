use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResource {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub label: String,
    /// La ruta puede haber desaparecido desde que se añadió.
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    /// Vista de tareas que se abre al activar el espacio.
    pub task_view: String,
    pub is_archived: bool,
    pub project_ids: Vec<String>,
    pub note_ids: Vec<String>,
    pub resources: Vec<WorkspaceResource>,
    pub open_task_count: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceInput {
    pub name: String,
    pub color: String,
    pub icon: String,
    pub task_view: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub active_id: Option<String>,
    pub workspaces: Vec<Workspace>,
}
