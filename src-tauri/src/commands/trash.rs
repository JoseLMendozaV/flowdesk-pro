//! Papelera de tareas, proyectos y eventos.
//!
//! Borrar guarda una instantánea de las filas afectadas y de las referencias que
//! las claves foráneas dejaron en NULL, y después elimina de verdad. Restaurar vuelve
//! a insertarlo todo con los mismos identificadores; lo que dejó de existir mientras
//! tanto (un proyecto, una nota) se omite. Lo borrado se purga a los 30 días.

use crate::{
    commands::tasks::{prune_unused_tags, sync_tags},
    database::Database,
    recurrence::{RecurrenceRule, parse_exceptions},
};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub const RETENTION_SECONDS: i64 = 30 * 86_400;

/// Tablas que pueden guardarse en una instantánea, en orden de inserción.
const SNAPSHOT_TABLES: &[&str] = &[
    "projects",
    "workspace_projects",
    "tasks",
    "subtasks",
    "task_notes",
    "calendar_events",
    "note_context_links",
];

/// Referencias que se vacían si su destino ya no existe al restaurar.
const OPTIONAL_REFERENCES: &[(&str, &str, &str)] = &[
    ("tasks", "project_id", "projects"),
    ("tasks", "workspace_id", "workspaces"),
    ("tasks", "recurrence_next_id", "tasks"),
    ("calendar_events", "project_id", "projects"),
];

/// Filas que se omiten si su destino ya no existe al restaurar.
const REQUIRED_REFERENCES: &[(&str, &str, &str)] = &[
    ("workspace_projects", "workspace_id", "workspaces"),
    ("workspace_projects", "project_id", "projects"),
    ("subtasks", "task_id", "tasks"),
    ("task_notes", "task_id", "tasks"),
    ("task_notes", "note_id", "notes"),
    ("note_context_links", "note_id", "notes"),
];

/// Columnas que las claves foráneas vacían al borrar y que restaurar vuelve a enlazar.
const RELINKS: &[(&str, &str)] = &[
    ("tasks", "project_id"),
    ("tasks", "recurrence_next_id"),
    ("notes", "project_id"),
    ("calendar_events", "project_id"),
    ("time_entries", "project_id"),
    ("time_entries", "task_id"),
    ("pomodoro_sessions", "project_id"),
    ("pomodoro_sessions", "task_id"),
];

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    tables: Vec<TableRows>,
    tags: Vec<TaskTags>,
    relinks: Vec<Relink>,
    /// Solo `event_occurrences`.
    occurrence: Option<RemovedOccurrences>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TableRows {
    table: String,
    rows: Vec<Map<String, Json>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskTags {
    task_id: String,
    names: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Relink {
    table: String,
    column: String,
    value: String,
    ids: Vec<String>,
}

/// Repeticiones quitadas de una serie que sigue existiendo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedOccurrences {
    pub occurrence_start: i64,
    /// `this` (solo esa) o `following` (esa y las siguientes).
    pub scope: String,
    /// Fin de la serie antes de recortarla (`following`).
    pub previous_until: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub title: String,
    pub deleted_at: i64,
    pub expires_at: i64,
    /// Tareas borradas junto con un proyecto, o subtareas de una tarea.
    pub child_count: i64,
    pub occurrence_start: Option<i64>,
    pub occurrence_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredItem {
    pub entity_type: String,
    pub entity_id: String,
}

fn to_json(value: Value) -> Json {
    match value {
        Value::Null | Value::Blob(_) => Json::Null,
        Value::Integer(number) => Json::from(number),
        Value::Real(number) => Json::from(number),
        Value::Text(text) => Json::String(text),
    }
}

fn from_json(value: &Json) -> Value {
    match value {
        Json::Bool(flag) => Value::Integer(i64::from(*flag)),
        Json::Number(number) => number
            .as_i64()
            .map(Value::Integer)
            .or_else(|| number.as_f64().map(Value::Real))
            .unwrap_or(Value::Null),
        Json::String(text) => Value::Text(text.clone()),
        _ => Value::Null,
    }
}

fn placeholders(count: usize) -> String {
    vec!["?"; count].join(", ")
}

fn read_rows(
    connection: &Connection,
    table: &str,
    column: &str,
    ids: &[String],
) -> rusqlite::Result<Vec<Map<String, Json>>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(&format!(
        "SELECT * FROM {table} WHERE {column} IN ({})",
        placeholders(ids.len())
    ))?;
    let columns: Vec<String> = statement.column_names().map(str::to_string).collect();
    statement
        .query_map(params_from_iter(ids), |row| {
            let mut map = Map::new();
            for (index, name) in columns.iter().enumerate() {
                map.insert(name.clone(), to_json(row.get::<_, Value>(index)?));
            }
            Ok(map)
        })?
        .collect()
}

fn ids_where(
    connection: &Connection,
    table: &str,
    column: &str,
    value: &str,
) -> rusqlite::Result<Vec<String>> {
    connection
        .prepare(&format!("SELECT id FROM {table} WHERE {column} = ?1"))?
        .query_map([value], |row| row.get(0))?
        .collect()
}

impl Snapshot {
    fn add(&mut self, table: &str, rows: Vec<Map<String, Json>>) {
        if !rows.is_empty() {
            self.tables.push(TableRows {
                table: table.to_string(),
                rows,
            });
        }
    }

    fn add_relink(
        &mut self,
        connection: &Connection,
        table: &str,
        column: &str,
        value: &str,
    ) -> rusqlite::Result<()> {
        let ids = ids_where(connection, table, column, value)?;
        if !ids.is_empty() {
            self.relinks.push(Relink {
                table: table.to_string(),
                column: column.to_string(),
                value: value.to_string(),
                ids,
            });
        }
        Ok(())
    }

    /// Tareas con sus subtareas, etiquetas, notas vinculadas y tiempo registrado.
    fn add_tasks(&mut self, connection: &Connection, task_ids: &[String]) -> rusqlite::Result<()> {
        self.add("tasks", read_rows(connection, "tasks", "id", task_ids)?);
        self.add(
            "subtasks",
            read_rows(connection, "subtasks", "task_id", task_ids)?,
        );
        self.add(
            "task_notes",
            read_rows(connection, "task_notes", "task_id", task_ids)?,
        );
        for task_id in task_ids {
            let names: Vec<String> = connection
                .prepare(
                    "SELECT g.name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
                     WHERE tt.task_id = ?1 ORDER BY g.name",
                )?
                .query_map([task_id], |row| row.get(0))?
                .collect::<Result<_, _>>()?;
            if !names.is_empty() {
                self.tags.push(TaskTags {
                    task_id: task_id.clone(),
                    names,
                });
            }
            for (table, column) in [
                ("time_entries", "task_id"),
                ("pomodoro_sessions", "task_id"),
                ("tasks", "recurrence_next_id"),
            ] {
                self.add_relink(connection, table, column, task_id)?;
            }
        }
        Ok(())
    }

    fn task_count(&self) -> i64 {
        self.tables
            .iter()
            .filter(|table| table.table == "tasks")
            .map(|table| table.rows.len() as i64)
            .sum()
    }
}

fn store(
    connection: &Connection,
    entity_type: &str,
    entity_id: &str,
    title: &str,
    snapshot: &Snapshot,
    now: i64,
) -> rusqlite::Result<String> {
    let id = Uuid::new_v4().to_string();
    let payload = serde_json::to_string(snapshot)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    connection.execute(
        "INSERT INTO trash_items(id, entity_type, entity_id, title, payload, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, entity_type, entity_id, title, payload, now],
    )?;
    Ok(id)
}

/// Lleva una tarea a la papelera dentro de la transacción del llamador.
pub fn trash_task(connection: &Connection, task_id: &str, now: i64) -> rusqlite::Result<String> {
    let title: String =
        connection.query_row("SELECT title FROM tasks WHERE id = ?1", [task_id], |row| {
            row.get(0)
        })?;
    let mut snapshot = Snapshot::default();
    snapshot.add_tasks(connection, &[task_id.to_string()])?;
    let id = store(connection, "task", task_id, &title, &snapshot, now)?;
    connection.execute("DELETE FROM tasks WHERE id = ?1", [task_id])?;
    prune_unused_tags(connection)?;
    Ok(id)
}

/// Lleva un proyecto a la papelera; con `with_tasks`, también sus tareas.
pub fn trash_project(
    connection: &Connection,
    project_id: &str,
    with_tasks: bool,
    now: i64,
) -> rusqlite::Result<String> {
    let name: String = connection.query_row(
        "SELECT name FROM projects WHERE id = ?1",
        [project_id],
        |row| row.get(0),
    )?;
    let ids = [project_id.to_string()];
    let mut snapshot = Snapshot::default();
    snapshot.add("projects", read_rows(connection, "projects", "id", &ids)?);
    snapshot.add(
        "workspace_projects",
        read_rows(connection, "workspace_projects", "project_id", &ids)?,
    );
    if with_tasks {
        let task_ids = ids_where(connection, "tasks", "project_id", project_id)?;
        snapshot.add_tasks(connection, &task_ids)?;
        connection.execute("DELETE FROM tasks WHERE project_id = ?1", [project_id])?;
        prune_unused_tags(connection)?;
    } else {
        snapshot.add_relink(connection, "tasks", "project_id", project_id)?;
    }
    for (table, column) in [
        ("notes", "project_id"),
        ("calendar_events", "project_id"),
        ("time_entries", "project_id"),
        ("pomodoro_sessions", "project_id"),
    ] {
        snapshot.add_relink(connection, table, column, project_id)?;
    }
    let id = store(connection, "project", project_id, &name, &snapshot, now)?;
    connection.execute("DELETE FROM projects WHERE id = ?1", [project_id])?;
    Ok(id)
}

/// Lleva un evento (con todas sus repeticiones) a la papelera.
pub fn trash_event(connection: &Connection, event_id: &str, now: i64) -> rusqlite::Result<String> {
    let title: String = connection.query_row(
        "SELECT title FROM calendar_events WHERE id = ?1",
        [event_id],
        |row| row.get(0),
    )?;
    let ids = [event_id.to_string()];
    let mut snapshot = Snapshot::default();
    snapshot.add(
        "calendar_events",
        read_rows(connection, "calendar_events", "id", &ids)?,
    );
    let links: Vec<Map<String, Json>> =
        read_rows(connection, "note_context_links", "entity_id", &ids)?
            .into_iter()
            .filter(|row| row.get("entity_type").and_then(Json::as_str) == Some("event"))
            .collect();
    snapshot.add("note_context_links", links);
    let id = store(connection, "event", event_id, &title, &snapshot, now)?;
    connection.execute("DELETE FROM calendar_events WHERE id = ?1", [event_id])?;
    Ok(id)
}

/// Registra repeticiones quitadas de una serie para poder recuperarlas.
pub fn trash_occurrences(
    connection: &Connection,
    event_id: &str,
    removed: RemovedOccurrences,
    now: i64,
) -> rusqlite::Result<String> {
    let title: String = connection.query_row(
        "SELECT title FROM calendar_events WHERE id = ?1",
        [event_id],
        |row| row.get(0),
    )?;
    let snapshot = Snapshot {
        occurrence: Some(removed),
        ..Snapshot::default()
    };
    store(
        connection,
        "event_occurrences",
        event_id,
        &title,
        &snapshot,
        now,
    )
}

fn table_columns(connection: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    connection
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get(1))?
        .collect()
}

fn exists(connection: &Connection, table: &str, id: &Json) -> rusqlite::Result<bool> {
    let Some(id) = id.as_str() else {
        return Ok(false);
    };
    connection.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1)"),
        [id],
        |row| row.get(0),
    )
}

fn insert_rows(connection: &Connection, rows: &TableRows) -> rusqlite::Result<()> {
    let table = rows.table.as_str();
    if !SNAPSHOT_TABLES.contains(&table) {
        return Err(rusqlite::Error::InvalidParameterName(table.to_string()));
    }
    let columns = table_columns(connection, table)?;
    'rows: for row in &rows.rows {
        let mut row = row.clone();
        for (_, column, target) in OPTIONAL_REFERENCES
            .iter()
            .filter(|(owner, _, _)| *owner == table)
        {
            if let Some(value) = row.get(*column)
                && !value.is_null()
                && !exists(connection, target, value)?
            {
                row.insert(column.to_string(), Json::Null);
            }
        }
        for (_, column, target) in REQUIRED_REFERENCES
            .iter()
            .filter(|(owner, _, _)| *owner == table)
        {
            if !exists(connection, target, row.get(*column).unwrap_or(&Json::Null))? {
                continue 'rows;
            }
        }
        // Solo las columnas que siguen existiendo; las nuevas toman su valor por defecto.
        let present: Vec<&String> = columns
            .iter()
            .filter(|name| row.contains_key(*name))
            .collect();
        let values: Vec<Value> = present.iter().map(|name| from_json(&row[*name])).collect();
        let names: Vec<&str> = present.iter().map(|name| name.as_str()).collect();
        connection.execute(
            &format!(
                "INSERT OR IGNORE INTO {table}({}) VALUES ({})",
                names.join(", "),
                placeholders(names.len())
            ),
            params_from_iter(values),
        )?;
    }
    Ok(())
}

fn restore_occurrences(
    connection: &Connection,
    event_id: &str,
    removed: &RemovedOccurrences,
) -> Result<(), String> {
    let stored: Option<(Option<String>, String)> = connection
        .query_row(
            "SELECT recurrence_rule, recurrence_exceptions FROM calendar_events WHERE id = ?1",
            [event_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((rule, exceptions)) = stored else {
        return Err("El evento ya no existe".to_string());
    };
    if removed.scope == "following" {
        let Some(mut rule) = RecurrenceRule::parse(rule.as_deref()) else {
            return Err("El evento ya no se repite".to_string());
        };
        rule.until = removed.previous_until;
        connection
            .execute(
                "UPDATE calendar_events SET recurrence_rule = ?1, updated_at = unixepoch()
                 WHERE id = ?2",
                params![rule.to_json(), event_id],
            )
            .map_err(|error| error.to_string())?;
    } else {
        let mut exceptions = parse_exceptions(&exceptions);
        exceptions.retain(|start| *start != removed.occurrence_start);
        connection
            .execute(
                "UPDATE calendar_events SET recurrence_exceptions = ?1, updated_at = unixepoch()
                 WHERE id = ?2",
                params![
                    serde_json::to_string(&exceptions).unwrap_or_default(),
                    event_id
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn restore_item(database: &Database, item_id: &str) -> Result<RestoredItem, String> {
    Uuid::parse_str(item_id).map_err(|_| "Identificador no válido".to_string())?;
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        let Some((entity_type, entity_id, payload)) = transaction
            .query_row(
                "SELECT entity_type, entity_id, payload FROM trash_items WHERE id = ?1",
                [item_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
        else {
            return Ok(Err("Ya no está en la papelera".to_string()));
        };
        let snapshot: Snapshot = serde_json::from_str(&payload)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        if let Some(removed) = &snapshot.occurrence
            && let Err(message) = restore_occurrences(&transaction, &entity_id, removed)
        {
            return Ok(Err(message));
        }
        for rows in &snapshot.tables {
            insert_rows(&transaction, rows)?;
        }
        for tags in &snapshot.tags {
            let task_exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?1)",
                [&tags.task_id],
                |row| row.get(0),
            )?;
            if task_exists {
                sync_tags(&transaction, &tags.task_id, &tags.names)?;
            }
        }
        for relink in &snapshot.relinks {
            if !RELINKS.contains(&(relink.table.as_str(), relink.column.as_str())) {
                continue;
            }
            for id in &relink.ids {
                // Solo si sigue sin enlazar: no se pisa lo que el usuario cambió después.
                transaction.execute(
                    &format!(
                        "UPDATE {} SET {column} = ?1 WHERE id = ?2 AND {column} IS NULL",
                        relink.table,
                        column = relink.column
                    ),
                    params![relink.value, id],
                )?;
            }
        }
        transaction.execute("DELETE FROM trash_items WHERE id = ?1", [item_id])?;
        transaction.commit()?;
        Ok(Ok(RestoredItem {
            entity_type,
            entity_id,
        }))
    })?
}

pub fn query_items(database: &Database) -> Result<Vec<TrashItem>, String> {
    database.with_connection(|connection| {
        connection
            .prepare(
                "SELECT id, entity_type, entity_id, title, deleted_at, payload FROM trash_items
                 ORDER BY deleted_at DESC, rowid DESC LIMIT 500",
            )?
            .query_map([], |row| {
                let entity_type: String = row.get(1)?;
                let payload: String = row.get(5)?;
                let snapshot: Snapshot = serde_json::from_str(&payload).unwrap_or_default();
                let deleted_at: i64 = row.get(4)?;
                let child_count = match entity_type.as_str() {
                    "project" => snapshot.task_count(),
                    "task" => snapshot
                        .tables
                        .iter()
                        .find(|table| table.table == "subtasks")
                        .map_or(0, |table| table.rows.len() as i64),
                    _ => 0,
                };
                Ok(TrashItem {
                    id: row.get(0)?,
                    entity_id: row.get(2)?,
                    title: row.get(3)?,
                    deleted_at,
                    expires_at: deleted_at + RETENTION_SECONDS,
                    child_count,
                    occurrence_start: snapshot
                        .occurrence
                        .as_ref()
                        .map(|item| item.occurrence_start),
                    occurrence_scope: snapshot.occurrence.map(|item| item.scope),
                    entity_type,
                })
            })?
            .collect()
    })
}

pub fn purge(database: &Database, now: i64) -> Result<usize, String> {
    database.with_connection(|connection| {
        connection.execute(
            "DELETE FROM trash_items WHERE deleted_at < ?1",
            [now - RETENTION_SECONDS],
        )
    })
}

fn notify(app: &AppHandle, kinds: &[&str]) {
    for kind in kinds {
        let _ = app.emit("flowdesk://data-changed", *kind);
    }
}

#[tauri::command]
pub fn list_trash(database: State<'_, Database>) -> Result<Vec<TrashItem>, String> {
    purge(&database, Utc::now().timestamp())?;
    query_items(&database)
}

#[tauri::command]
pub fn restore_trash_item(
    item_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<RestoredItem, String> {
    let restored = restore_item(&database, &item_id)?;
    let changed = match restored.entity_type.as_str() {
        "task" => &["tasks", "trash"][..],
        "project" => &["projects", "tasks", "notes", "calendar", "time", "trash"][..],
        _ => &["calendar", "notes", "trash"][..],
    };
    notify(&app, changed);
    Ok(restored)
}

#[tauri::command]
pub fn delete_trash_item(
    item_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    Uuid::parse_str(&item_id).map_err(|_| "Identificador no válido".to_string())?;
    database.with_connection(|connection| {
        connection.execute("DELETE FROM trash_items WHERE id = ?1", [&item_id])
    })?;
    notify(&app, &["trash"]);
    Ok(())
}

#[tauri::command]
pub fn empty_trash(database: State<'_, Database>, app: AppHandle) -> Result<(), String> {
    database.with_connection(|connection| connection.execute("DELETE FROM trash_items", []))?;
    notify(&app, &["trash"]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        commands::{
            projects::{PROJECT_COLORS, insert_project, remove_project},
            tasks::{insert_subtask, insert_task, remove_task},
        },
        models::{ProjectDeleteMode, ProjectInput, TaskInput},
    };

    fn count(database: &Database, sql: &str) -> i64 {
        database
            .with_connection(|connection| connection.query_row(sql, [], |row| row.get(0)))
            .expect("count")
    }

    fn execute(database: &Database, sql: &str) {
        database
            .with_connection(|connection| connection.execute_batch(sql))
            .expect("sql");
    }

    fn project(database: &Database, name: &str) -> String {
        insert_project(
            database,
            ProjectInput {
                name: name.to_string(),
                color: PROJECT_COLORS[0].to_string(),
                status: "active".to_string(),
                ..ProjectInput::default()
            },
        )
        .expect("project")
        .id
    }

    fn task(database: &Database, title: &str, project_id: Option<&str>) -> String {
        insert_task(
            database,
            TaskInput {
                title: title.to_string(),
                project_id: project_id.map(str::to_string),
                tags: vec!["Única".to_string()],
                ..TaskInput::default()
            },
        )
        .expect("task")
        .summary
        .id
    }

    #[test]
    fn a_task_comes_back_with_everything_it_had() {
        let database = Database::in_memory();
        let task_id = task(&database, "Escribir informe", None);
        insert_subtask(&database, &task_id, "Introducción").expect("subtask");
        execute(
            &database,
            &format!(
                "INSERT INTO notes(id, title) VALUES ('nota', 'Ideas');
                 INSERT INTO task_notes(task_id, note_id) VALUES ('{task_id}', 'nota');
                 INSERT INTO time_entries(id, task_id, status, started_at, duration_seconds)
                    VALUES ('registro', '{task_id}', 'completed', 100, 1500);"
            ),
        );

        let item_id = remove_task(&database, &task_id).expect("delete");
        assert_eq!(count(&database, "SELECT COUNT(*) FROM tasks"), 0);
        // La etiqueta sin uso desaparece, pero la tarea la recupera.
        assert_eq!(count(&database, "SELECT COUNT(*) FROM tags"), 0);
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM time_entries WHERE task_id IS NULL"
            ),
            1
        );
        let items = query_items(&database).expect("trash");
        assert_eq!(items[0].title, "Escribir informe");
        assert_eq!(items[0].child_count, 1);
        assert_eq!(items[0].expires_at - items[0].deleted_at, RETENTION_SECONDS);

        let restored = restore_item(&database, &item_id).expect("restore");
        assert_eq!(restored.entity_id, task_id);
        assert_eq!(count(&database, "SELECT COUNT(*) FROM subtasks"), 1);
        assert_eq!(count(&database, "SELECT COUNT(*) FROM task_tags"), 1);
        assert_eq!(count(&database, "SELECT COUNT(*) FROM task_notes"), 1);
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM time_entries WHERE task_id IS NOT NULL"
            ),
            1
        );
        assert!(query_items(&database).expect("trash").is_empty());
        assert!(restore_item(&database, &item_id).is_err());
    }

    #[test]
    fn a_project_comes_back_with_its_tasks_and_links() {
        let database = Database::in_memory();
        let project_id = project(&database, "Tesis");
        task(&database, "Capítulo 1", Some(&project_id));
        execute(
            &database,
            &format!(
                "INSERT INTO workspaces(id, name) VALUES ('espacio', 'Investigación');
                 INSERT INTO workspace_projects(workspace_id, project_id)
                    VALUES ('espacio', '{project_id}');
                 INSERT INTO notes(id, title, project_id) VALUES ('nota', 'Bibliografía', '{project_id}');"
            ),
        );

        let item_id =
            remove_project(&database, &project_id, ProjectDeleteMode::DeleteTasks).expect("delete");
        assert_eq!(count(&database, "SELECT COUNT(*) FROM tasks"), 0);
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM notes WHERE project_id IS NULL"
            ),
            1
        );
        assert_eq!(query_items(&database).expect("trash")[0].child_count, 1);

        restore_item(&database, &item_id).expect("restore");
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM tasks WHERE project_id IS NOT NULL"
            ),
            1
        );
        assert_eq!(
            count(&database, "SELECT COUNT(*) FROM workspace_projects"),
            1
        );
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM notes WHERE project_id IS NOT NULL"
            ),
            1
        );
    }

    #[test]
    fn restoring_skips_what_no_longer_exists() {
        let database = Database::in_memory();
        let project_id = project(&database, "Docencia");
        let task_id = task(&database, "Corregir", Some(&project_id));
        let task_item = remove_task(&database, &task_id).expect("delete task");
        remove_project(&database, &project_id, ProjectDeleteMode::KeepTasks).expect("delete");

        // El proyecto sigue en la papelera: la tarea vuelve sin proyecto.
        restore_item(&database, &task_item).expect("restore");
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM tasks WHERE project_id IS NULL"
            ),
            1
        );
    }

    #[test]
    fn old_items_are_purged_after_thirty_days() {
        let database = Database::in_memory();
        let task_id = task(&database, "Antigua", None);
        remove_task(&database, &task_id).expect("delete");
        let now = Utc::now().timestamp();
        assert_eq!(
            purge(&database, now + RETENTION_SECONDS - 60).expect("purge"),
            0
        );
        assert_eq!(
            purge(&database, now + RETENTION_SECONDS + 60).expect("purge"),
            1
        );
        assert!(query_items(&database).expect("trash").is_empty());
    }
}
