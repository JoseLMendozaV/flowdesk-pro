use crate::{
    commands::workspaces::{active_workspace, note_scope},
    database::Database,
    models::{Note, NoteHistoryEntry, NoteLinks, NoteVersion, NoteVersionSummary, NoteWindow},
    note_document::{self, RICH_FORMAT},
    windows::notes as note_windows,
};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const NOTE_COLORS: &[&str] = &[
    "#FFF2A8", "#FFD6DE", "#D9F7D6", "#D9E8FF", "#E8DDFF", "#FFFFFF",
];
const DISPLAY_MODES: &[&str] = &["normal", "always_on_top", "desktop"];
/// Error que la interfaz reconoce: otra ventana guardó la nota antes.
pub const CONFLICT: &str = "NOTE_CONFLICT";
const EMPTY_DOCUMENT: &str = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
/// Instantánea completa como mucho cada 10 minutos de edición, hasta 20 por nota.
const SNAPSHOT_INTERVAL: i64 = 600;
const SNAPSHOT_LIMIT: i64 = 20;
const HISTORY_LIMIT: i64 = 100;
const SOURCES: &[&str] = &["note", "main", "restore"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpdate {
    note_id: String,
    title: String,
    content: String,
    color: String,
    opacity: f64,
    font_size: f64,
    reminder_at: Option<i64>,
    #[serde(default)]
    project_id: Option<String>,
    /// Documento del editor enriquecido. Sin él se guarda `content` como Markdown.
    #[serde(default)]
    content_json: Option<String>,
    /// Revisión sobre la que se editó. Si otra ventana guardó después, hay conflicto.
    #[serde(default)]
    base_revision: Option<i64>,
    #[serde(default)]
    source: Option<String>,
}

fn split_ids(value: Option<String>) -> Vec<String> {
    value
        .map(|ids| {
            ids.split(',')
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn map_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        color: row.get(3)?,
        project_id: row.get(4)?,
        reminder_at: row.get(5)?,
        is_archived: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        window: NoteWindow {
            x: row.get(9)?,
            y: row.get(10)?,
            width: row.get(11)?,
            height: row.get(12)?,
            expanded_height: row.get(13)?,
            opacity: row.get(14)?,
            font_size: row.get(15)?,
            display_mode: row.get(16)?,
            is_collapsed: row.get(17)?,
            is_visible: row.get(18)?,
        },
        content_format: row.get(19)?,
        content_json: row.get(20)?,
        revision: row.get(21)?,
        pinned_global: row.get(22)?,
        links: NoteLinks {
            task_ids: split_ids(row.get(23)?),
            workspace_ids: split_ids(row.get(24)?),
            event_ids: split_ids(row.get(25)?),
            attachment_count: row.get(26)?,
            checklist_total: row.get(27)?,
            checklist_done: row.get(28)?,
        },
    })
}

/// Columnas de una nota. El documento completo solo se lee al abrir una nota.
fn note_select(with_document: bool) -> String {
    let document = if with_document {
        "n.content_json"
    } else {
        "NULL"
    };
    format!(
        "SELECT n.id, n.title, n.content, n.color, n.project_id, n.reminder_at,
            n.is_archived, n.created_at, n.updated_at,
            w.x, w.y, w.width, w.height, w.expanded_height, w.opacity,
            w.font_size, w.display_mode, w.is_collapsed, w.is_visible,
            n.content_format, {document}, n.revision, n.pinned_global,
            (SELECT group_concat(task_id) FROM task_notes WHERE note_id = n.id),
            (SELECT group_concat(workspace_id) FROM workspace_notes WHERE note_id = n.id),
            (SELECT group_concat(entity_id) FROM note_context_links
             WHERE note_id = n.id AND entity_type = 'event'),
            (SELECT COUNT(*) FROM note_attachments WHERE note_id = n.id AND deleted_at IS NULL),
            (SELECT COUNT(*) FROM note_checklist_items WHERE note_id = n.id),
            (SELECT COUNT(*) FROM note_checklist_items WHERE note_id = n.id AND is_checked = 1)
         FROM notes n JOIN note_windows w ON w.note_id = n.id"
    )
}

fn query_note(connection: &Connection, note_id: &str) -> rusqlite::Result<Option<Note>> {
    connection
        .query_row(
            &format!("{} WHERE n.id = ?1", note_select(true)),
            [note_id],
            map_note,
        )
        .optional()
}

pub(crate) fn require_note(database: &Database, note_id: &str) -> Result<Note, String> {
    Uuid::parse_str(note_id).map_err(|_| "Identificador de nota no válido".to_string())?;
    database
        .with_connection(|connection| query_note(connection, note_id))?
        .ok_or_else(|| "La nota no existe".to_string())
}

fn insert_note(database: &Database) -> Result<Note, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO notes(id, content_format, content_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, RICH_FORMAT, EMPTY_DOCUMENT, now],
        )?;
        transaction.execute(
            "INSERT INTO note_windows(note_id, display_mode, is_visible, updated_at)
             VALUES (?1, 'always_on_top', 1, ?2)",
            params![id, now],
        )?;
        // Una nota creada con un espacio activo pertenece a él.
        transaction.execute(
            "INSERT INTO workspace_notes(workspace_id, note_id)
             SELECT ?1, ?2 WHERE ?1 IS NOT NULL",
            params![active_workspace(&transaction)?, id],
        )?;
        let note = query_note(&transaction, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        transaction.commit()?;
        Ok(note)
    })
}

pub fn create_note_and_window(app: &AppHandle) -> Result<Note, String> {
    let database = app.state::<Database>();
    let note = insert_note(&database)?;
    if let Err(error) = note_windows::open(app, &note) {
        mark_hidden(&database, &note.id);
        return Err(error);
    }
    // En modo accesorio la app no está activa: el foco explícito la activa para escribir ya.
    if let Some(window) = app.get_webview_window(&note_windows::label(&note.id)) {
        let _ = window.set_focus();
    }
    let _ = app.emit("flowdesk://data-changed", "notes");
    Ok(note)
}

/// Notas que el usuario dejó abiertas y que corresponden al espacio activo: las suyas,
/// las fijadas en todos los espacios y, si el espacio lo permite, las globales.
fn displayable_notes(connection: &Connection) -> rusqlite::Result<Vec<Note>> {
    let workspace_id = active_workspace(connection)?;
    let include_global = match &workspace_id {
        Some(id) => crate::commands::workspaces::includes_global_notes(connection, id)?,
        None => true,
    };
    let scope = if include_global {
        note_scope("n", "?1")
    } else {
        crate::commands::workspaces::note_scope_strict("n", "?1")
    };
    connection
        .prepare(&format!(
            "{} WHERE n.is_archived = 0 AND w.is_visible = 1 AND (n.pinned_global = 1 OR {scope})
             ORDER BY n.updated_at DESC",
            note_select(false)
        ))?
        .query_map([workspace_id], map_note)?
        .collect()
}

fn mark_hidden(database: &Database, note_id: &str) {
    let _ = database.with_connection(|connection| {
        connection.execute(
            "UPDATE note_windows SET is_visible = 0 WHERE note_id = ?1",
            [note_id],
        )?;
        Ok(())
    });
}

pub fn restore_visible(app: &AppHandle, database: &Database) {
    let notes = database
        .with_connection(displayable_notes)
        .unwrap_or_default();
    for note in notes {
        if note_windows::open(app, &note).is_err() {
            mark_hidden(database, &note.id);
        }
    }
}

/// Al cambiar de espacio: muestra sus notas abiertas y oculta las de otros espacios
/// sin cambiar `is_visible`, para recuperarlas al volver.
pub fn apply_workspace_windows(app: &AppHandle, database: &Database) {
    let notes = database
        .with_connection(displayable_notes)
        .unwrap_or_default();
    let shown: Vec<String> = notes
        .iter()
        .map(|note| note_windows::label(&note.id))
        .collect();
    // Mostrar una nota la convierte en ventana clave; el foco vuelve después a la
    // ventana desde la que se cambió de espacio (dashboard o panel).
    let focused = app
        .webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false));
    for (window_label, window) in app.webview_windows() {
        if let Some(note_id) = window_label.strip_prefix("note-")
            && !shown.contains(&window_label)
            && window.is_visible().unwrap_or(false)
        {
            let _ = note_windows::persist_geometry(app, note_id, &window);
            let _ = window.hide();
        }
    }
    for note in notes {
        match app.get_webview_window(&note_windows::label(&note.id)) {
            Some(window) => {
                let _ = window.show();
            }
            None => {
                if note_windows::open(app, &note).is_err() {
                    mark_hidden(database, &note.id);
                }
            }
        }
    }
    if let Some(window) = focused {
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn create_note(app: AppHandle) -> Result<Note, String> {
    create_note_and_window(&app)
}

#[tauri::command]
pub fn get_note(note_id: String, database: State<'_, Database>) -> Result<Note, String> {
    require_note(&database, &note_id)
}

#[tauri::command]
pub fn list_notes(
    include_archived: bool,
    all_workspaces: Option<bool>,
    database: State<'_, Database>,
) -> Result<Vec<Note>, String> {
    database.with_connection(|connection| {
        let archived = if include_archived {
            "1"
        } else {
            "n.is_archived = 0"
        };
        let mut statement = connection.prepare(&format!(
            "{} WHERE {archived} AND (n.pinned_global = 1 OR {}) ORDER BY n.updated_at DESC",
            note_select(false),
            note_scope("n", "?1")
        ))?;
        statement
            .query_map(
                [if all_workspaces.unwrap_or(false) {
                    None
                } else {
                    active_workspace(connection)?
                }],
                map_note,
            )?
            .collect::<Result<Vec<_>, _>>()
    })
}

/// Contenido validado listo para guardar.
struct PreparedContent {
    format: &'static str,
    text: String,
    json: Option<String>,
    checklist: Vec<(String, bool)>,
    characters: i64,
    words: i64,
}

fn prepare_content(
    content: String,
    content_json: Option<String>,
) -> Result<PreparedContent, String> {
    match content_json {
        Some(json) => {
            let digest = note_document::digest(&json)?;
            if digest.characters > 200_000 {
                return Err("La nota no puede superar 200 000 caracteres".to_string());
            }
            Ok(PreparedContent {
                format: RICH_FORMAT,
                text: digest.text,
                json: Some(json),
                checklist: digest.checklist,
                characters: digest.characters,
                words: digest.words,
            })
        }
        None => {
            if content.chars().count() > 200_000 {
                return Err("La nota no puede superar 200 000 caracteres".to_string());
            }
            let (characters, words) = note_document::count_plain(&content);
            Ok(PreparedContent {
                format: "markdown",
                text: content,
                json: None,
                checklist: Vec::new(),
                characters,
                words,
            })
        }
    }
}

fn insert_version(
    connection: &Connection,
    note_id: &str,
    reason: &str,
    now: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO note_content_versions(id, note_id, revision, format, title, content, content_json, reason, created_at)
         SELECT ?1, id, revision, content_format, title, content, content_json, ?2, ?3 FROM notes WHERE id = ?4",
        params![Uuid::new_v4().to_string(), reason, now, note_id],
    )?;
    // El original de las notas antiguas nunca se descarta.
    connection.execute(
        "DELETE FROM note_content_versions WHERE note_id = ?1 AND reason != 'legacy' AND id NOT IN (
            SELECT id FROM note_content_versions WHERE note_id = ?1 AND reason != 'legacy'
            ORDER BY created_at DESC, rowid DESC LIMIT ?2)",
        params![note_id, SNAPSHOT_LIMIT],
    )?;
    Ok(())
}

/// Instantánea del contenido recién guardado si la última tiene más de 10 minutos.
fn snapshot_if_due(connection: &Connection, note_id: &str, now: i64) -> rusqlite::Result<()> {
    let latest: Option<i64> = connection.query_row(
        "SELECT MAX(created_at) FROM note_content_versions WHERE note_id = ?1 AND reason = 'snapshot'",
        [note_id],
        |row| row.get(0),
    )?;
    if latest.is_none_or(|latest| now - latest >= SNAPSHOT_INTERVAL) {
        insert_version(connection, note_id, "snapshot", now)?;
    }
    Ok(())
}

fn store_checklist(
    connection: &Connection,
    note_id: &str,
    checklist: &[(String, bool)],
) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM note_checklist_items WHERE note_id = ?1",
        [note_id],
    )?;
    let mut statement = connection.prepare(
        "INSERT INTO note_checklist_items(note_id, position, text, is_checked) VALUES (?1, ?2, ?3, ?4)",
    )?;
    for (position, (text, checked)) in checklist.iter().enumerate() {
        statement.execute(params![note_id, position as i64, text, checked])?;
    }
    Ok(())
}

fn record_history(
    connection: &Connection,
    note_id: &str,
    source: &str,
    characters: i64,
    words: i64,
    now: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO note_revision_history(note_id, revision, source, characters, words, saved_at)
         SELECT id, revision, ?2, ?3, ?4, ?5 FROM notes WHERE id = ?1",
        params![note_id, source, characters, words, now],
    )?;
    connection.execute(
        "DELETE FROM note_revision_history WHERE note_id = ?1 AND id NOT IN (
            SELECT id FROM note_revision_history WHERE note_id = ?1 ORDER BY id DESC LIMIT ?2)",
        params![note_id, HISTORY_LIMIT],
    )?;
    Ok(())
}

enum SaveOutcome {
    Saved(Box<Note>),
    Missing,
    Conflict,
}

/// Guarda título, contenido y apariencia en una transacción. Solo sube la revisión,
/// el historial y las instantáneas si cambió el título o el contenido.
fn save_note(database: &Database, input: NoteUpdate) -> Result<Note, String> {
    let NoteUpdate {
        note_id,
        title,
        content,
        color,
        opacity,
        font_size,
        reminder_at,
        project_id,
        content_json,
        base_revision,
        source,
    } = input;
    Uuid::parse_str(&note_id).map_err(|_| "Identificador de nota no válido".to_string())?;
    let source = source.unwrap_or_else(|| "note".to_string());
    if !SOURCES.contains(&source.as_str()) {
        return Err("Origen del guardado no válido".to_string());
    }
    let project_id = project_id.filter(|id| !id.is_empty());
    if let Some(project_id) = &project_id {
        Uuid::parse_str(project_id)
            .map_err(|_| "Identificador de proyecto no válido".to_string())?;
        let exists = database.with_connection(|connection| {
            connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                [project_id],
                |row| row.get::<_, bool>(0),
            )
        })?;
        if !exists {
            return Err("El proyecto seleccionado no existe".to_string());
        }
    }
    let title = title.trim().to_string();
    if title.chars().count() > 120 {
        return Err("El título no puede superar 120 caracteres".to_string());
    }
    if !NOTE_COLORS.contains(&color.as_str()) {
        return Err("Color de nota no válido".to_string());
    }
    if !(0.35..=1.0).contains(&opacity) {
        return Err("La transparencia debe estar entre 35% y 100%".to_string());
    }
    if !(10.0..=32.0).contains(&font_size) {
        return Err("El tamaño de texto debe estar entre 10 y 32".to_string());
    }
    let prepared = prepare_content(content, content_json)?;
    let now = Utc::now().timestamp();
    let outcome = database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        let current: Option<(i64, String, String, Option<String>, String)> = transaction
            .query_row(
                "SELECT revision, title, content, content_json, content_format
                 FROM notes WHERE id = ?1 AND is_archived = 0",
                [&note_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((revision, old_title, old_text, old_json, old_format)) = current else {
            return Ok(SaveOutcome::Missing);
        };
        let content_changed = old_title != title
            || old_format != prepared.format
            || match &prepared.json {
                Some(json) => old_json.as_deref() != Some(json.as_str()),
                None => old_text != prepared.text,
            };
        if content_changed && base_revision.is_some_and(|base| base != revision) {
            return Ok(SaveOutcome::Conflict);
        }
        transaction.execute(
            "UPDATE notes SET title = ?1, content = ?2, content_json = ?3, content_format = ?4,
                color = ?5, reminder_at = ?6, project_id = ?7, updated_at = ?8,
                revision = revision + ?9
             WHERE id = ?10",
            params![
                title,
                prepared.text,
                prepared.json,
                prepared.format,
                color,
                reminder_at,
                project_id,
                now,
                i64::from(content_changed),
                note_id
            ],
        )?;
        transaction.execute(
            "UPDATE note_windows SET opacity = ?1, font_size = ?2, updated_at = ?3
             WHERE note_id = ?4",
            params![opacity, font_size, now, note_id],
        )?;
        if content_changed {
            store_checklist(&transaction, &note_id, &prepared.checklist)?;
            record_history(
                &transaction,
                &note_id,
                &source,
                prepared.characters,
                prepared.words,
                now,
            )?;
            snapshot_if_due(&transaction, &note_id, now)?;
        }
        let note =
            query_note(&transaction, &note_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        transaction.commit()?;
        Ok(SaveOutcome::Saved(Box::new(note)))
    })?;
    match outcome {
        SaveOutcome::Saved(note) => Ok(*note),
        SaveOutcome::Missing => Err("La nota no existe o está archivada".to_string()),
        SaveOutcome::Conflict => Err(CONFLICT.to_string()),
    }
}

fn after_change(app: &AppHandle, note: &Note) {
    if let Some(window) = app.get_webview_window(&note_windows::label(&note.id)) {
        let _ = window.set_title(if note.title.is_empty() {
            "Nota — FlowDesk Pro"
        } else {
            &note.title
        });
    }
    let _ = app.emit("flowdesk://data-changed", "notes");
}

#[tauri::command]
pub fn update_note(
    input: NoteUpdate,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Note, String> {
    let note = save_note(&database, input)?;
    after_change(&app, &note);
    Ok(note)
}

fn validate_version_id(value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
    if valid {
        Ok(())
    } else {
        Err("Versión no válida".to_string())
    }
}

pub fn list_versions(
    database: &Database,
    note_id: &str,
) -> Result<Vec<NoteVersionSummary>, String> {
    Uuid::parse_str(note_id).map_err(|_| "Identificador de nota no válido".to_string())?;
    database.with_connection(|connection| {
        connection
            .prepare(
                "SELECT id, revision, format, title, substr(content, 1, 160), reason, created_at
                 FROM note_content_versions WHERE note_id = ?1
                 ORDER BY created_at DESC, rowid DESC",
            )?
            .query_map([note_id], |row| {
                Ok(NoteVersionSummary {
                    id: row.get(0)?,
                    revision: row.get(1)?,
                    format: row.get(2)?,
                    title: row.get(3)?,
                    preview: row.get(4)?,
                    reason: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?
            .collect()
    })
}

fn load_version(
    connection: &Connection,
    version_id: &str,
) -> rusqlite::Result<Option<NoteVersion>> {
    connection
        .query_row(
            "SELECT id, note_id, revision, format, title, content, content_json, reason, created_at
             FROM note_content_versions WHERE id = ?1",
            [version_id],
            |row| {
                Ok(NoteVersion {
                    id: row.get(0)?,
                    note_id: row.get(1)?,
                    revision: row.get(2)?,
                    format: row.get(3)?,
                    title: row.get(4)?,
                    content: row.get(5)?,
                    content_json: row.get(6)?,
                    reason: row.get(7)?,
                    created_at: row.get(8)?,
                })
            },
        )
        .optional()
}

/// Guarda el estado actual como versión y recupera la elegida. Nada se pierde.
pub fn restore_version(
    database: &Database,
    note_id: &str,
    version_id: &str,
    reason: &str,
) -> Result<Note, String> {
    Uuid::parse_str(note_id).map_err(|_| "Identificador de nota no válido".to_string())?;
    validate_version_id(version_id)?;
    let now = Utc::now().timestamp();
    database
        .with_connection_mut(|connection| {
            let transaction = connection.transaction()?;
            let version = load_version(&transaction, version_id)?
                .filter(|version| version.note_id == note_id)
                .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            insert_version(&transaction, note_id, reason, now)?;
            let checklist = match &version.content_json {
                Some(json) => note_document::digest(json)
                    .map(|digest| digest.checklist)
                    .unwrap_or_default(),
                None => Vec::new(),
            };
            transaction.execute(
                "UPDATE notes SET title = ?1, content = ?2, content_json = ?3, content_format = ?4,
                revision = revision + 1, updated_at = ?5
             WHERE id = ?6",
                params![
                    version.title,
                    version.content,
                    version.content_json,
                    version.format,
                    now,
                    note_id
                ],
            )?;
            store_checklist(&transaction, note_id, &checklist)?;
            let (characters, words) = note_document::count_plain(&version.content);
            record_history(&transaction, note_id, "restore", characters, words, now)?;
            let note =
                query_note(&transaction, note_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            transaction.commit()?;
            Ok(note)
        })
        .map_err(|error| {
            if error.contains("no rows") {
                "La versión no existe".to_string()
            } else {
                error
            }
        })
}

#[tauri::command]
pub fn list_note_versions(
    note_id: String,
    database: State<'_, Database>,
) -> Result<Vec<NoteVersionSummary>, String> {
    list_versions(&database, &note_id)
}

#[tauri::command]
pub fn get_note_version(
    version_id: String,
    database: State<'_, Database>,
) -> Result<NoteVersion, String> {
    validate_version_id(&version_id)?;
    database
        .with_connection(|connection| load_version(connection, &version_id))?
        .ok_or_else(|| "La versión no existe".to_string())
}

/// `reason`: `before-restore` al restaurar desde el historial, `conflict` al aceptar la
/// versión de otra ventana descartando la propia (que queda guardada como versión).
#[tauri::command]
pub fn restore_note_version(
    note_id: String,
    version_id: String,
    reason: Option<String>,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Note, String> {
    let reason = reason.unwrap_or_else(|| "before-restore".to_string());
    if !["before-restore", "conflict"].contains(&reason.as_str()) {
        return Err("Motivo no válido".to_string());
    }
    let note = restore_version(&database, &note_id, &version_id, &reason)?;
    let root = crate::commands::note_attachments::root(&app)?;
    crate::commands::note_attachments::restore_referenced(&database, &root, &note_id)?;
    after_change(&app, &note);
    Ok(note)
}

#[tauri::command]
pub fn list_note_history(
    note_id: String,
    database: State<'_, Database>,
) -> Result<Vec<NoteHistoryEntry>, String> {
    Uuid::parse_str(&note_id).map_err(|_| "Identificador de nota no válido".to_string())?;
    database.with_connection(|connection| {
        connection
            .prepare(
                "SELECT revision, source, characters, words, saved_at FROM note_revision_history
                 WHERE note_id = ?1 ORDER BY id DESC LIMIT 30",
            )?
            .query_map([&note_id], |row| {
                Ok(NoteHistoryEntry {
                    revision: row.get(0)?,
                    source: row.get(1)?,
                    characters: row.get(2)?,
                    words: row.get(3)?,
                    saved_at: row.get(4)?,
                })
            })?
            .collect()
    })
}

/// Guarda como versión el contenido que una ventana iba a sobrescribir en un conflicto,
/// para que el usuario pueda recuperarlo desde el historial.
#[tauri::command]
pub fn save_note_conflict_copy(
    note_id: String,
    title: String,
    content_json: String,
    database: State<'_, Database>,
) -> Result<(), String> {
    Uuid::parse_str(&note_id).map_err(|_| "Identificador de nota no válido".to_string())?;
    let digest = note_document::digest(&content_json)?;
    let title: String = title.trim().chars().take(120).collect();
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO note_content_versions(id, note_id, revision, format, title, content, content_json, reason)
             SELECT ?1, id, revision, ?2, ?3, ?4, ?5, 'conflict' FROM notes WHERE id = ?6",
            params![Uuid::new_v4().to_string(), RICH_FORMAT, title, digest.text, content_json, note_id],
        )?;
        Ok(())
    })
}

/// Guarda como versión el contenido actual en SQLite: lo que otra ventana escribió y
/// el usuario va a sobrescribir al conservar su propia versión en un conflicto.
#[tauri::command]
pub fn preserve_note_version(note_id: String, database: State<'_, Database>) -> Result<(), String> {
    require_note(&database, &note_id)?;
    let now = Utc::now().timestamp();
    database.with_connection(|connection| insert_version(connection, &note_id, "conflict", now))
}

#[tauri::command]
pub fn set_note_pinned_global(
    note_id: String,
    pinned: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Note, String> {
    require_note(&database, &note_id)?;
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE notes SET pinned_global = ?1, updated_at = unixepoch() WHERE id = ?2",
            params![pinned, note_id],
        )?;
        Ok(())
    })?;
    apply_workspace_windows(&app, &database);
    let note = require_note(&database, &note_id)?;
    let _ = app.emit("flowdesk://data-changed", "notes");
    Ok(note)
}

#[tauri::command]
pub fn set_note_display_mode(
    note_id: String,
    display_mode: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Note, String> {
    if !DISPLAY_MODES.contains(&display_mode.as_str()) {
        return Err("Modo de ventana no válido".to_string());
    }
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE note_windows SET display_mode = ?1, updated_at = unixepoch()
             WHERE note_id = ?2",
            params![display_mode, note_id],
        )?;
        Ok(())
    })?;
    if let Some(window) = app.get_webview_window(&note_windows::label(&note_id)) {
        note_windows::apply_display_mode(&window, &display_mode);
    }
    require_note(&database, &note_id)
}

#[tauri::command]
pub fn set_note_collapsed(
    note_id: String,
    collapsed: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Note, String> {
    note_windows::set_collapsed(&app, &note_id, collapsed)?;
    require_note(&database, &note_id)
}

#[tauri::command]
pub fn show_note_window(
    note_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Note, String> {
    let note = require_note(&database, &note_id)?;
    if note.is_archived {
        return Err("La nota está archivada".to_string());
    }
    note_windows::open(&app, &note)?;
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE note_windows SET is_visible = 1, updated_at = unixepoch()
             WHERE note_id = ?1",
            [&note_id],
        )?;
        Ok(())
    })?;
    require_note(&database, &note_id)
}

#[tauri::command]
pub fn hide_note_window(
    note_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    require_note(&database, &note_id)?;
    if let Some(window) = app.get_webview_window(&note_windows::label(&note_id)) {
        note_windows::persist_geometry(&app, &note_id, &window)?;
        window.hide().map_err(|error| error.to_string())?;
    }
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE note_windows SET is_visible = 0, updated_at = unixepoch()
             WHERE note_id = ?1",
            [&note_id],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn archive_note(
    note_id: String,
    archived: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Note, String> {
    require_note(&database, &note_id)?;
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE notes SET is_archived = ?1,
                archived_at = CASE WHEN ?1 = 1 THEN unixepoch() ELSE NULL END,
                updated_at = unixepoch() WHERE id = ?2",
            params![archived, note_id],
        )?;
        if archived {
            transaction.execute(
                "UPDATE note_windows SET is_visible = 0, updated_at = unixepoch()
                 WHERE note_id = ?1",
                [&note_id],
            )?;
        }
        transaction.commit()
    })?;
    if archived && let Some(window) = app.get_webview_window(&note_windows::label(&note_id)) {
        let _ = window.hide();
    }
    let note = require_note(&database, &note_id)?;
    let _ = app.emit("flowdesk://data-changed", "notes");
    Ok(note)
}

#[tauri::command]
pub fn delete_note(
    note_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    require_note(&database, &note_id)?;
    database.with_connection(|connection| {
        connection.execute("DELETE FROM notes WHERE id = ?1", [&note_id])?;
        Ok(())
    })?;
    // La eliminación ya se confirmó: sus adjuntos se van con ella.
    crate::commands::note_attachments::remove_note_directory(&app, &note_id);
    if let Some(window) = app.get_webview_window(&note_windows::label(&note_id)) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    let _ = app.emit("flowdesk://data-changed", "notes");
    Ok(())
}

#[cfg(test)]
pub mod tests_support {
    use crate::database::Database;

    pub fn new_note(database: &Database) -> String {
        super::insert_note(database).expect("new note").id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use serde_json::json;

    fn rich(text: &str) -> String {
        json!({ "type": "doc", "content": [
            { "type": "paragraph", "content": [{ "type": "text", "text": text }] },
            { "type": "taskList", "content": [
                { "type": "taskItem", "attrs": { "checked": true }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Hecho" }] }] },
                { "type": "taskItem", "attrs": { "checked": false }, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Pendiente" }] }] }
            ]}
        ]})
        .to_string()
    }

    fn update(note_id: &str, json: Option<String>, base: Option<i64>) -> NoteUpdate {
        NoteUpdate {
            note_id: note_id.to_string(),
            title: "Plan".to_string(),
            content: "Markdown antiguo".to_string(),
            color: "#FFF2A8".to_string(),
            opacity: 1.0,
            font_size: 15.0,
            reminder_at: None,
            project_id: None,
            content_json: json,
            base_revision: base,
            source: None,
        }
    }

    fn count(database: &Database, sql: &str, note_id: &str) -> i64 {
        database
            .with_connection(|connection| connection.query_row(sql, [note_id], |row| row.get(0)))
            .expect("count")
    }

    #[test]
    fn migration_keeps_old_notes_and_a_recoverable_original() {
        let mut connection = rusqlite::Connection::open_in_memory().expect("database");
        let migrations = crate::database::migrations();
        for (_, sql) in &migrations[..9] {
            connection.execute_batch(sql).expect("previous migrations");
        }
        connection
            .execute_batch(
                "INSERT INTO notes(id, title, content, color) VALUES ('n1', 'Ideas', '# Título\n- uno', '#D9E8FF');
                 INSERT INTO note_windows(note_id, x, y, opacity) VALUES ('n1', 40, 60, 0.8);
                 INSERT INTO notes(id) VALUES ('vacía');
                 INSERT INTO note_windows(note_id) VALUES ('vacía');",
            )
            .expect("old notes");
        let transaction = connection.transaction().expect("transaction");
        transaction
            .execute_batch(migrations[9].1)
            .expect("migration 10");
        transaction.commit().expect("commit");
        let (content, format, color, opacity, x): (String, String, String, f64, f64) = connection
            .query_row(
                "SELECT n.content, n.content_format, n.color, w.opacity, w.x FROM notes n
                 JOIN note_windows w ON w.note_id = n.id WHERE n.id = 'n1'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("note");
        assert_eq!(
            (content.as_str(), format.as_str(), color.as_str()),
            ("# Título\n- uno", "markdown", "#D9E8FF")
        );
        assert_eq!((opacity, x), (0.8, 40.0));
        let (reason, original): (String, String) = connection
            .query_row(
                "SELECT reason, content FROM note_content_versions WHERE note_id = 'n1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("legacy version");
        assert_eq!(
            (reason.as_str(), original.as_str()),
            ("legacy", "# Título\n- uno")
        );
        let empty_versions: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM note_content_versions WHERE note_id = 'vacía'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(empty_versions, 0);
    }

    #[test]
    fn rich_content_derives_text_checklist_history_and_a_snapshot() {
        let database = Database::in_memory();
        let note = insert_note(&database).expect("note");
        assert_eq!(note.content_format, RICH_FORMAT);
        let saved = save_note(
            &database,
            update(&note.id, Some(rich("Hola mundo")), Some(0)),
        )
        .expect("save");
        assert_eq!(saved.revision, 1);
        assert_eq!(saved.content, "Hola mundo\n[x] Hecho\n[ ] Pendiente");
        assert_eq!(
            (saved.links.checklist_total, saved.links.checklist_done),
            (2, 1)
        );
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM note_revision_history WHERE note_id = ?1",
                &note.id
            ),
            1
        );
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM note_content_versions WHERE note_id = ?1 AND reason = 'snapshot'",
                &note.id
            ),
            1
        );

        // Segundo guardado en menos de 10 minutos: historial sí, instantánea no.
        save_note(
            &database,
            update(&note.id, Some(rich("Hola de nuevo")), Some(1)),
        )
        .expect("save 2");
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM note_revision_history WHERE note_id = ?1",
                &note.id
            ),
            2
        );
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM note_content_versions WHERE note_id = ?1 AND reason = 'snapshot'",
                &note.id
            ),
            1
        );

        // Cambiar solo la apariencia no sube la revisión.
        let mut appearance = update(&note.id, Some(rich("Hola de nuevo")), Some(2));
        appearance.color = "#D9F7D6".to_string();
        let same = save_note(&database, appearance).expect("appearance");
        assert_eq!((same.revision, same.color.as_str()), (2, "#D9F7D6"));
    }

    #[test]
    fn stale_revision_is_a_conflict_but_appearance_is_not() {
        let database = Database::in_memory();
        let note = insert_note(&database).expect("note");
        save_note(
            &database,
            update(&note.id, Some(rich("Ventana A")), Some(0)),
        )
        .expect("first window");
        let conflict = save_note(
            &database,
            update(&note.id, Some(rich("Ventana B")), Some(0)),
        );
        assert_eq!(conflict.unwrap_err(), CONFLICT);
        let mut opacity_only = update(&note.id, Some(rich("Ventana A")), Some(0));
        opacity_only.opacity = 0.6;
        assert!(save_note(&database, opacity_only).is_ok());
        let stored = require_note(&database, &note.id).expect("note");
        assert!(stored.content.starts_with("Ventana A"));
    }

    #[test]
    fn markdown_notes_still_save_without_conversion() {
        let database = Database::in_memory();
        let note = insert_note(&database).expect("note");
        let saved = save_note(&database, update(&note.id, None, None)).expect("markdown");
        assert_eq!(
            (saved.content_format.as_str(), saved.content.as_str()),
            ("markdown", "Markdown antiguo")
        );
        assert!(saved.content_json.is_none());
    }

    #[test]
    fn restoring_a_version_keeps_the_current_one() {
        let database = Database::in_memory();
        let note = insert_note(&database).expect("note");
        save_note(&database, update(&note.id, Some(rich("Primera")), Some(0))).expect("save");
        let first = list_versions(&database, &note.id).expect("versions")[0]
            .id
            .clone();
        save_note(&database, update(&note.id, Some(rich("Segunda")), Some(1))).expect("save 2");
        let restored =
            restore_version(&database, &note.id, &first, "before-restore").expect("restore");
        assert!(restored.content.starts_with("Primera"));
        assert_eq!(restored.revision, 3);
        let versions = list_versions(&database, &note.id).expect("versions");
        assert!(
            versions
                .iter()
                .any(|version| version.reason == "before-restore"
                    && version.preview.starts_with("Segunda"))
        );
        let other = insert_note(&database).expect("other");
        assert!(
            restore_version(&database, &other.id, &first, "before-restore").is_err(),
            "versión de otra nota"
        );
    }

    #[test]
    fn versions_are_limited_but_the_legacy_original_is_kept() {
        let database = Database::in_memory();
        let note = insert_note(&database).expect("note");
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO note_content_versions(id, note_id, revision, format, title, content, reason, created_at)
                     VALUES ('legado', ?1, 0, 'markdown', '', 'original', 'legacy', 1)",
                    [&note.id],
                )?;
                for index in 0..25 {
                    insert_version(connection, &note.id, "snapshot", 100 + index)?;
                }
                Ok(())
            })
            .expect("versions");
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM note_content_versions WHERE note_id = ?1 AND reason != 'legacy'",
                &note.id
            ),
            SNAPSHOT_LIMIT
        );
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM note_content_versions WHERE note_id = ?1 AND reason = 'legacy'",
                &note.id
            ),
            1
        );
    }

    #[test]
    fn pinned_notes_show_in_every_workspace_and_globals_follow_the_preference() {
        let database = Database::in_memory();
        let global = insert_note(&database).expect("global");
        let pinned = insert_note(&database).expect("pinned");
        let workspace = crate::commands::workspaces::insert_workspace(
            &database,
            crate::models::WorkspaceInput {
                name: "Docencia".to_string(),
                color: "#6C8CFF".to_string(),
                icon: "graduation".to_string(),
                task_view: "today".to_string(),
                include_global_notes: Some(false),
            },
        )
        .expect("workspace");
        let other = crate::commands::workspaces::insert_workspace(
            &database,
            crate::models::WorkspaceInput {
                name: "Programación".to_string(),
                color: "#6C8CFF".to_string(),
                icon: "code".to_string(),
                task_view: "today".to_string(),
                include_global_notes: None,
            },
        )
        .expect("other");
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO workspace_notes(workspace_id, note_id) VALUES (?1, ?2)",
                    params![other.id, pinned.id],
                )?;
                connection.execute(
                    "UPDATE notes SET pinned_global = 1 WHERE id = ?1",
                    [&pinned.id],
                )?;
                connection.execute(
                    "UPDATE settings SET value = ?1 WHERE key = 'selected_workspace_id'",
                    [&workspace.id],
                )
            })
            .expect("setup");
        let shown: Vec<String> = database
            .with_connection(displayable_notes)
            .expect("notes")
            .into_iter()
            .map(|note| note.id)
            .collect();
        assert!(shown.contains(&pinned.id), "fijada en todos los espacios");
        assert!(
            !shown.contains(&global.id),
            "este espacio no muestra las globales"
        );
    }

    #[test]
    fn creates_note_and_window_state_atomically() {
        let database = Database::in_memory();
        let note = insert_note(&database).expect("new note");
        assert_eq!(note.color, "#FFF2A8");
        assert!(note.window.is_visible);
        assert_eq!(note.window.display_mode, "always_on_top");

        let stored = database
            .with_connection(|connection| query_note(connection, &note.id))
            .expect("query note")
            .expect("stored note");
        assert_eq!(stored.id, note.id);
    }

    #[test]
    fn deleting_note_cascades_window_state() {
        let database = Database::in_memory();
        let note = insert_note(&database).expect("new note");
        let remaining = database
            .with_connection(|connection| {
                connection.execute("DELETE FROM notes WHERE id = ?1", [&note.id])?;
                connection.query_row(
                    "SELECT COUNT(*) FROM note_windows WHERE note_id = ?1",
                    [&note.id],
                    |row| row.get::<_, i64>(0),
                )
            })
            .expect("remaining state");
        assert_eq!(remaining, 0);
    }
}
