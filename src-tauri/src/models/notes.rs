use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAttachment {
    pub id: String,
    pub note_id: String,
    /// `image`, `file` o `audio`.
    pub kind: String,
    pub file_name: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub created_at: i64,
    /// Lo referencia el documento actual. Los que no, se conservan hasta borrarlos.
    pub in_use: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersionSummary {
    pub id: String,
    pub revision: i64,
    pub format: String,
    pub title: String,
    pub preview: String,
    /// `legacy`, `snapshot`, `before-restore` o `conflict`.
    pub reason: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersion {
    pub id: String,
    pub note_id: String,
    pub revision: i64,
    pub format: String,
    pub title: String,
    pub content: String,
    pub content_json: Option<String>,
    pub reason: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryEntry {
    pub revision: i64,
    pub source: String,
    pub characters: i64,
    pub words: i64,
    pub saved_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContextItem {
    pub id: String,
    pub title: String,
    pub color: Option<String>,
    /// Fecha del evento o vencimiento de la tarea.
    pub at: Option<i64>,
    /// Estado de la tarea; `None` en el resto.
    pub status: Option<String>,
}

/// Todo aquello con lo que está relacionada una nota.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContexts {
    pub project: Option<NoteContextItem>,
    pub tasks: Vec<NoteContextItem>,
    pub workspaces: Vec<NoteContextItem>,
    pub events: Vec<NoteContextItem>,
}
