use crate::{
    database::Database,
    models::{Note, NoteWindow},
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
    })
}

const NOTE_SELECT: &str = "SELECT n.id, n.title, n.content, n.color, n.project_id, n.reminder_at,
            n.is_archived, n.created_at, n.updated_at,
            w.x, w.y, w.width, w.height, w.expanded_height, w.opacity,
            w.font_size, w.display_mode, w.is_collapsed, w.is_visible
     FROM notes n JOIN note_windows w ON w.note_id = n.id";

fn query_note(connection: &Connection, note_id: &str) -> rusqlite::Result<Option<Note>> {
    connection
        .query_row(
            &format!("{NOTE_SELECT} WHERE n.id = ?1"),
            [note_id],
            map_note,
        )
        .optional()
}

fn require_note(database: &Database, note_id: &str) -> Result<Note, String> {
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
            "INSERT INTO notes(id, created_at, updated_at) VALUES (?1, ?2, ?2)",
            params![id, now],
        )?;
        transaction.execute(
            "INSERT INTO note_windows(note_id, display_mode, is_visible, updated_at)
             VALUES (?1, 'always_on_top', 1, ?2)",
            params![id, now],
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
        let _ = database.with_connection(|connection| {
            connection.execute(
                "UPDATE note_windows SET is_visible = 0 WHERE note_id = ?1",
                [&note.id],
            )?;
            Ok(())
        });
        return Err(error);
    }
    // En modo accesorio la app no está activa: el foco explícito la activa para escribir ya.
    if let Some(window) = app.get_webview_window(&note_windows::label(&note.id)) {
        let _ = window.set_focus();
    }
    let _ = app.emit("flowdesk://data-changed", "notes");
    Ok(note)
}

pub fn restore_visible(app: &AppHandle, database: &Database) {
    let notes = database
        .with_connection(|connection| {
            let mut statement = connection.prepare(&format!(
                "{NOTE_SELECT} WHERE n.is_archived = 0 AND w.is_visible = 1
                 ORDER BY n.updated_at DESC"
            ))?;
            statement
                .query_map([], map_note)?
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();
    for note in notes {
        if note_windows::open(app, &note).is_err() {
            let _ = database.with_connection(|connection| {
                connection.execute(
                    "UPDATE note_windows SET is_visible = 0 WHERE note_id = ?1",
                    [&note.id],
                )?;
                Ok(())
            });
        }
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
    database: State<'_, Database>,
) -> Result<Vec<Note>, String> {
    database.with_connection(|connection| {
        let sql = if include_archived {
            format!("{NOTE_SELECT} ORDER BY n.updated_at DESC")
        } else {
            format!("{NOTE_SELECT} WHERE n.is_archived = 0 ORDER BY n.updated_at DESC")
        };
        let mut statement = connection.prepare(&sql)?;
        statement
            .query_map([], map_note)?
            .collect::<Result<Vec<_>, _>>()
    })
}

#[tauri::command]
pub fn update_note(
    input: NoteUpdate,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Note, String> {
    let NoteUpdate {
        note_id,
        title,
        content,
        color,
        opacity,
        font_size,
        reminder_at,
        project_id,
    } = input;
    Uuid::parse_str(&note_id).map_err(|_| "Identificador de nota no válido".to_string())?;
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
    let title = title.trim();
    if title.chars().count() > 120 {
        return Err("El título no puede superar 120 caracteres".to_string());
    }
    if content.chars().count() > 200_000 {
        return Err("La nota no puede superar 200 000 caracteres".to_string());
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
    let now = Utc::now().timestamp();
    let note = database
        .with_connection_mut(|connection| {
            let transaction = connection.transaction()?;
            let changed = transaction.execute(
                "UPDATE notes SET title = ?1, content = ?2, color = ?3,
                reminder_at = ?4, project_id = ?5, updated_at = ?6
             WHERE id = ?7 AND is_archived = 0",
                params![title, content, color, reminder_at, project_id, now, note_id],
            )?;
            if changed == 0 {
                return Ok(None);
            }
            transaction.execute(
                "UPDATE note_windows SET opacity = ?1, font_size = ?2, updated_at = ?3
             WHERE note_id = ?4",
                params![opacity, font_size, now, note_id],
            )?;
            let note =
                query_note(&transaction, &note_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
            transaction.commit()?;
            Ok(Some(note))
        })?
        .ok_or_else(|| "La nota no existe o está archivada".to_string())?;
    if let Some(window) = app.get_webview_window(&note_windows::label(&note_id)) {
        let _ = window.set_title(if note.title.is_empty() {
            "Nota — FlowDesk Pro"
        } else {
            &note.title
        });
    }
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
    if let Some(window) = app.get_webview_window(&note_windows::label(&note_id)) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    let _ = app.emit("flowdesk://data-changed", "notes");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{insert_note, query_note};
    use crate::database::Database;

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
