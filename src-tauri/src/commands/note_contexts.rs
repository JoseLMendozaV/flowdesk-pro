//! Contextos de una nota. Proyecto (`notes.project_id`), tareas (`task_notes`) y espacios
//! (`workspace_notes`) reutilizan sus relaciones; los eventos usan `note_context_links`.

use crate::{
    commands::notes::{apply_workspace_windows, require_note},
    database::Database,
    models::{NoteContextItem, NoteContexts},
};
use rusqlite::{Connection, OptionalExtension, params};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub const KINDS: &[&str] = &["project", "task", "workspace", "event"];

fn items(
    connection: &Connection,
    sql: &str,
    note_id: &str,
) -> rusqlite::Result<Vec<NoteContextItem>> {
    connection
        .prepare(sql)?
        .query_map([note_id], |row| {
            Ok(NoteContextItem {
                id: row.get(0)?,
                title: row.get(1)?,
                color: row.get(2)?,
                at: row.get(3)?,
                status: row.get(4)?,
            })
        })?
        .collect()
}

pub fn load(database: &Database, note_id: &str) -> Result<NoteContexts, String> {
    require_note(database, note_id)?;
    database.with_connection(|connection| {
        let project = connection
            .query_row(
                "SELECT p.id, p.name, p.color FROM notes n JOIN projects p ON p.id = n.project_id
                 WHERE n.id = ?1",
                [note_id],
                |row| {
                    Ok(NoteContextItem {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        color: row.get(2)?,
                        at: None,
                        status: None,
                    })
                },
            )
            .optional()?;
        Ok(NoteContexts {
            project,
            tasks: items(
                connection,
                "SELECT t.id, t.title, p.color, t.due_at, t.status FROM task_notes tn
                 JOIN tasks t ON t.id = tn.task_id LEFT JOIN projects p ON p.id = t.project_id
                 WHERE tn.note_id = ?1 ORDER BY t.status = 'completed', t.due_at IS NULL, t.due_at",
                note_id,
            )?,
            workspaces: items(
                connection,
                "SELECT w.id, w.name, w.color, NULL, NULL FROM workspace_notes wn
                 JOIN workspaces w ON w.id = wn.workspace_id WHERE wn.note_id = ?1 ORDER BY w.name",
                note_id,
            )?,
            events: items(
                connection,
                "SELECT e.id, e.title, p.color, e.starts_at, NULL FROM note_context_links l
                 JOIN calendar_events e ON e.id = l.entity_id LEFT JOIN projects p ON p.id = e.project_id
                 WHERE l.note_id = ?1 AND l.entity_type = 'event' ORDER BY e.starts_at",
                note_id,
            )?,
        })
    })
}

fn exists(connection: &Connection, table: &str, id: &str) -> rusqlite::Result<bool> {
    connection.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1)"),
        [id],
        |row| row.get(0),
    )
}

/// Vincula o desvincula. Desvincular nunca borra la tarea, el evento, el proyecto ni el espacio.
pub fn set(
    database: &Database,
    note_id: &str,
    kind: &str,
    entity_id: &str,
    linked: bool,
) -> Result<(), String> {
    require_note(database, note_id)?;
    if !KINDS.contains(&kind) {
        return Err("Tipo de contexto no válido".to_string());
    }
    Uuid::parse_str(entity_id).map_err(|_| "Identificador no válido".to_string())?;
    let table = match kind {
        "project" => "projects",
        "task" => "tasks",
        "workspace" => "workspaces",
        _ => "calendar_events",
    };
    database
        .with_connection(|connection| {
            if linked && !exists(connection, table, entity_id)? {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            match (kind, linked) {
                ("project", true) => connection.execute(
                    "UPDATE notes SET project_id = ?1, updated_at = unixepoch() WHERE id = ?2",
                    params![entity_id, note_id],
                ),
                ("project", false) => connection.execute(
                    "UPDATE notes SET project_id = NULL, updated_at = unixepoch()
                 WHERE id = ?1 AND project_id = ?2",
                    params![note_id, entity_id],
                ),
                ("task", true) => connection.execute(
                    "INSERT OR IGNORE INTO task_notes(task_id, note_id) VALUES (?1, ?2)",
                    params![entity_id, note_id],
                ),
                ("task", false) => connection.execute(
                    "DELETE FROM task_notes WHERE task_id = ?1 AND note_id = ?2",
                    params![entity_id, note_id],
                ),
                ("workspace", true) => connection.execute(
                    "INSERT OR IGNORE INTO workspace_notes(workspace_id, note_id) VALUES (?1, ?2)",
                    params![entity_id, note_id],
                ),
                ("workspace", false) => connection.execute(
                    "DELETE FROM workspace_notes WHERE workspace_id = ?1 AND note_id = ?2",
                    params![entity_id, note_id],
                ),
                (_, true) => connection.execute(
                    "INSERT OR IGNORE INTO note_context_links(note_id, entity_type, entity_id)
                 VALUES (?1, 'event', ?2)",
                    params![note_id, entity_id],
                ),
                (_, false) => connection.execute(
                    "DELETE FROM note_context_links WHERE note_id = ?1 AND entity_type = 'event'
                 AND entity_id = ?2",
                    params![note_id, entity_id],
                ),
            }?;
            Ok(())
        })
        .map_err(|error| {
            if error.contains("no rows") {
                "El elemento ya no existe".to_string()
            } else {
                error
            }
        })
}

#[tauri::command]
pub fn get_note_contexts(
    note_id: String,
    database: State<'_, Database>,
) -> Result<NoteContexts, String> {
    load(&database, &note_id)
}

#[tauri::command]
pub fn set_note_context(
    note_id: String,
    kind: String,
    entity_id: String,
    linked: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<NoteContexts, String> {
    set(&database, &note_id, &kind, &entity_id, linked)?;
    // Cambiar los espacios de una nota puede mostrarla u ocultarla ahora mismo.
    if kind == "workspace" || kind == "project" {
        apply_workspace_windows(&app, &database);
    }
    let _ = app.emit("flowdesk://data-changed", "notes");
    if kind == "task" {
        let _ = app.emit("flowdesk://data-changed", "tasks");
    }
    load(&database, &note_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::notes::tests_support::new_note;

    fn seed(database: &Database) -> (String, String, String, String) {
        let ids = (
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
        );
        database
            .with_connection(|connection| {
                connection.execute("INSERT INTO projects(id, name) VALUES (?1, 'Tesis')", [&ids.0])?;
                connection.execute("INSERT INTO tasks(id, title) VALUES (?1, 'Revisar')", [&ids.1])?;
                connection.execute("INSERT INTO workspaces(id, name) VALUES (?1, 'Docencia')", [&ids.2])?;
                connection.execute(
                    "INSERT INTO calendar_events(id, title, starts_at, ends_at) VALUES (?1, 'Tutoría', 100, 200)",
                    [&ids.3],
                )?;
                Ok(())
            })
            .expect("seed");
        ids
    }

    #[test]
    fn links_every_context_and_unlinks_without_deleting() {
        let database = Database::in_memory();
        let note = new_note(&database);
        let (project, task, workspace, event) = seed(&database);
        for (kind, id) in [
            ("project", &project),
            ("task", &task),
            ("workspace", &workspace),
            ("event", &event),
        ] {
            set(&database, &note, kind, id, true).expect(kind);
        }
        let contexts = load(&database, &note).expect("contexts");
        assert_eq!(contexts.project.expect("project").title, "Tesis");
        assert_eq!(contexts.tasks[0].title, "Revisar");
        assert_eq!(contexts.workspaces[0].title, "Docencia");
        assert_eq!(contexts.events[0].title, "Tutoría");

        for (kind, id) in [
            ("project", &project),
            ("task", &task),
            ("workspace", &workspace),
            ("event", &event),
        ] {
            set(&database, &note, kind, id, false).expect(kind);
        }
        let contexts = load(&database, &note).expect("contexts");
        assert!(contexts.project.is_none() && contexts.tasks.is_empty());
        assert!(contexts.workspaces.is_empty() && contexts.events.is_empty());
        let remaining: i64 = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM calendar_events)",
                    [],
                    |row| row.get(0),
                )
            })
            .expect("count");
        assert_eq!(remaining, 2);
    }

    #[test]
    fn rejects_unknown_kinds_and_missing_entities() {
        let database = Database::in_memory();
        let note = new_note(&database);
        assert!(
            set(
                &database,
                &note,
                "document",
                &Uuid::new_v4().to_string(),
                true
            )
            .is_err()
        );
        assert!(set(&database, &note, "task", "no-es-uuid", true).is_err());
        assert!(set(&database, &note, "event", &Uuid::new_v4().to_string(), true).is_err());
    }

    #[test]
    fn deleting_an_event_removes_its_note_links() {
        let database = Database::in_memory();
        let note = new_note(&database);
        let (_, _, _, event) = seed(&database);
        set(&database, &note, "event", &event, true).expect("link");
        database
            .with_connection(|connection| {
                connection.execute("DELETE FROM calendar_events WHERE id = ?1", [&event])
            })
            .expect("delete");
        assert!(load(&database, &note).expect("contexts").events.is_empty());
    }
}
