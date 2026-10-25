use crate::{
    commands::dashboard::today_bounds,
    database::Database,
    models::{
        LinkedNote, Subtask, Tag, TaskDetail, TaskFilter, TaskInput, TaskSort, TaskSummary,
        TaskView,
    },
};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub const TASK_STATUSES: &[&str] = &["pending", "in_progress", "completed", "cancelled"];
pub const TASK_PRIORITIES: &[&str] = &["none", "low", "medium", "high", "urgent"];
const TAG_COLORS: &[&str] = &[
    "#6C8CFF", "#8B6CF0", "#2FB67C", "#E8A33D", "#E5636F", "#3BA7C4", "#8B8FA3",
];
const MAX_TAGS: usize = 12;
const MAX_SUBTASKS: i64 = 100;
const LIST_LIMIT: i64 = 2000;

const TASK_SELECT: &str =
    "SELECT t.id, t.title, t.status, t.priority, t.project_id, p.name, p.color,
            t.due_at, t.due_has_time, t.completed_at, t.created_at, t.updated_at,
            t.estimated_minutes, t.tracked_seconds,
            (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id),
            (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.is_completed = 1),
            (SELECT COUNT(*) FROM task_notes tn WHERE tn.task_id = t.id),
            (SELECT json_group_array(json_object('id', g.id, 'name', g.name, 'color', g.color))
             FROM task_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.task_id = t.id)
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id";

const PRIORITY_RANK: &str = "CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3
     WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END";

/// Tarea validada y normalizada, lista para escribirse.
struct ValidTask {
    title: String,
    description: String,
    status: String,
    priority: String,
    due_at: Option<i64>,
    due_has_time: bool,
    project_id: Option<String>,
    estimated_minutes: Option<i64>,
    tags: Vec<String>,
}

fn map_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskSummary> {
    let tags_json: String = row.get(17)?;
    let mut tags: Vec<Tag> = serde_json::from_str(&tags_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(17, rusqlite::types::Type::Text, Box::new(error))
    })?;
    tags.sort_by_key(|tag| tag.name.to_lowercase());
    Ok(TaskSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        priority: row.get(3)?,
        project_id: row.get(4)?,
        project_name: row.get(5)?,
        project_color: row.get(6)?,
        due_at: row.get(7)?,
        due_has_time: row.get(8)?,
        completed_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        estimated_minutes: row.get(12)?,
        tracked_seconds: row.get(13)?,
        subtask_count: row.get(14)?,
        subtasks_completed: row.get(15)?,
        note_count: row.get(16)?,
        tags,
    })
}

fn query_detail(connection: &Connection, task_id: &str) -> rusqlite::Result<Option<TaskDetail>> {
    let Some(summary) = connection
        .query_row(
            &format!("{TASK_SELECT} WHERE t.id = ?1"),
            [task_id],
            map_summary,
        )
        .optional()?
    else {
        return Ok(None);
    };
    let description = connection.query_row(
        "SELECT description FROM tasks WHERE id = ?1",
        [task_id],
        |row| row.get(0),
    )?;
    let subtasks = connection
        .prepare(
            "SELECT id, title, is_completed, position FROM subtasks
             WHERE task_id = ?1 ORDER BY position, created_at",
        )?
        .query_map([task_id], |row| {
            Ok(Subtask {
                id: row.get(0)?,
                title: row.get(1)?,
                is_completed: row.get(2)?,
                position: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let notes = connection
        .prepare(
            "SELECT n.id, n.title, substr(n.content, 1, 120), n.color, n.is_archived
             FROM task_notes tn JOIN notes n ON n.id = tn.note_id
             WHERE tn.task_id = ?1 ORDER BY tn.created_at",
        )?
        .query_map([task_id], |row| {
            Ok(LinkedNote {
                id: row.get(0)?,
                title: row.get(1)?,
                preview: row.get(2)?,
                color: row.get(3)?,
                is_archived: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(TaskDetail {
        summary,
        description,
        subtasks,
        notes,
    }))
}

fn require_id(id: &str, message: &str) -> Result<(), String> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| message.to_string())
}

fn ensure_exists(database: &Database, sql: &str, id: &str, message: &str) -> Result<(), String> {
    let exists =
        database.with_connection(|connection| connection.query_row(sql, [id], |row| row.get(0)))?;
    if exists {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn require_task(database: &Database, task_id: &str) -> Result<(), String> {
    require_id(task_id, "Identificador de tarea no válido")?;
    ensure_exists(
        database,
        "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?1)",
        task_id,
        "La tarea no existe",
    )
}

fn validate_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("El título de la tarea no puede estar vacío".to_string());
    }
    if title.chars().count() > 240 {
        return Err("El título no puede superar 240 caracteres".to_string());
    }
    Ok(title.to_string())
}

fn validate_status(status: &str) -> Result<(), String> {
    if TASK_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err("Estado de tarea no válido".to_string())
    }
}

fn validate_priority(priority: &str) -> Result<(), String> {
    if TASK_PRIORITIES.contains(&priority) {
        Ok(())
    } else {
        Err("Prioridad no válida".to_string())
    }
}

fn normalize_tags(tags: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized: Vec<String> = Vec::new();
    for raw in tags {
        let name = raw.trim().trim_start_matches('#').trim();
        if name.is_empty() {
            continue;
        }
        if name.chars().count() > 40 {
            return Err("Cada etiqueta puede tener como máximo 40 caracteres".to_string());
        }
        let lowered = name.to_lowercase();
        if !normalized
            .iter()
            .any(|existing| existing.to_lowercase() == lowered)
        {
            normalized.push(name.to_string());
        }
    }
    if normalized.len() > MAX_TAGS {
        return Err(format!("Una tarea admite como máximo {MAX_TAGS} etiquetas"));
    }
    Ok(normalized)
}

fn validate_task(database: &Database, input: TaskInput) -> Result<ValidTask, String> {
    let title = validate_title(&input.title)?;
    if input.description.chars().count() > 20_000 {
        return Err("La descripción no puede superar 20 000 caracteres".to_string());
    }
    let status = input.status.unwrap_or_else(|| "pending".to_string());
    validate_status(&status)?;
    let priority = input.priority.unwrap_or_else(|| "none".to_string());
    validate_priority(&priority)?;
    if let Some(minutes) = input.estimated_minutes
        && !(0..=10_000).contains(&minutes)
    {
        return Err("El tiempo estimado debe estar entre 0 y 10 000 minutos".to_string());
    }
    let project_id = input.project_id.filter(|id| !id.is_empty());
    if let Some(project_id) = &project_id {
        require_id(project_id, "Identificador de proyecto no válido")?;
        ensure_exists(
            database,
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            project_id,
            "El proyecto seleccionado no existe",
        )?;
    }
    Ok(ValidTask {
        title,
        description: input.description,
        status,
        priority,
        due_at: input.due_at,
        due_has_time: input.due_at.is_some() && input.due_has_time.unwrap_or(true),
        project_id,
        estimated_minutes: input.estimated_minutes,
        tags: normalize_tags(input.tags)?,
    })
}

fn tag_color(name: &str) -> &'static str {
    let hash = name.to_lowercase().bytes().fold(0usize, |hash, byte| {
        hash.wrapping_mul(31).wrapping_add(byte as usize)
    });
    TAG_COLORS[hash % TAG_COLORS.len()]
}

pub(crate) fn prune_unused_tags(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM task_tags)",
        [],
    )?;
    Ok(())
}

fn sync_tags(connection: &Connection, task_id: &str, names: &[String]) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM task_tags WHERE task_id = ?1", [task_id])?;
    for name in names {
        connection.execute(
            "INSERT OR IGNORE INTO tags(id, name, color) VALUES (?1, ?2, ?3)",
            params![Uuid::new_v4().to_string(), name, tag_color(name)],
        )?;
        let tag_id: String =
            connection.query_row("SELECT id FROM tags WHERE name = ?1", [name], |row| {
                row.get(0)
            })?;
        connection.execute(
            "INSERT OR IGNORE INTO task_tags(task_id, tag_id) VALUES (?1, ?2)",
            params![task_id, tag_id],
        )?;
    }
    prune_unused_tags(connection)
}

fn touch_task(connection: &Connection, task_id: &str) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
        params![Utc::now().timestamp(), task_id],
    )?;
    Ok(())
}

fn load_detail(database: &Database, task_id: &str) -> Result<TaskDetail, String> {
    database
        .with_connection(|connection| query_detail(connection, task_id))?
        .ok_or_else(|| "La tarea no existe".to_string())
}

pub fn insert_task(database: &Database, input: TaskInput) -> Result<TaskDetail, String> {
    let note_id = input.note_id.clone().filter(|id| !id.is_empty());
    if let Some(note_id) = &note_id {
        require_id(note_id, "Identificador de nota no válido")?;
        ensure_exists(
            database,
            "SELECT EXISTS(SELECT 1 FROM notes WHERE id = ?1)",
            note_id,
            "La nota de origen no existe",
        )?;
    }
    let task = validate_task(database, input)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let completed_at = (task.status == "completed").then_some(now);
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO tasks(id, title, description, status, priority, project_id,
                estimated_minutes, due_at, due_has_time, completed_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                id,
                task.title,
                task.description,
                task.status,
                task.priority,
                task.project_id,
                task.estimated_minutes,
                task.due_at,
                task.due_has_time,
                completed_at,
                now
            ],
        )?;
        sync_tags(&transaction, &id, &task.tags)?;
        if let Some(note_id) = &note_id {
            transaction.execute(
                "INSERT OR IGNORE INTO task_notes(task_id, note_id) VALUES (?1, ?2)",
                params![id, note_id],
            )?;
        }
        let detail =
            query_detail(&transaction, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        transaction.commit()?;
        Ok(detail)
    })
}

pub fn modify_task(
    database: &Database,
    task_id: &str,
    input: TaskInput,
) -> Result<TaskDetail, String> {
    require_task(database, task_id)?;
    let task = validate_task(database, input)?;
    let now = Utc::now().timestamp();
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE tasks SET title = ?1, description = ?2, status = ?3, priority = ?4,
                project_id = ?5, estimated_minutes = ?6, due_at = ?7, due_has_time = ?8,
                completed_at = CASE WHEN ?3 = 'completed' THEN COALESCE(completed_at, ?9)
                                    ELSE NULL END,
                updated_at = ?9
             WHERE id = ?10",
            params![
                task.title,
                task.description,
                task.status,
                task.priority,
                task.project_id,
                task.estimated_minutes,
                task.due_at,
                task.due_has_time,
                now,
                task_id
            ],
        )?;
        sync_tags(&transaction, task_id, &task.tags)?;
        let detail =
            query_detail(&transaction, task_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        transaction.commit()?;
        Ok(detail)
    })
}

pub fn change_status(
    database: &Database,
    task_id: &str,
    status: &str,
) -> Result<TaskDetail, String> {
    require_task(database, task_id)?;
    validate_status(status)?;
    let now = Utc::now().timestamp();
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE tasks SET status = ?1,
                completed_at = CASE WHEN ?1 = 'completed' THEN COALESCE(completed_at, ?2)
                                    ELSE NULL END,
                updated_at = ?2
             WHERE id = ?3",
            params![status, now, task_id],
        )?;
        Ok(())
    })?;
    load_detail(database, task_id)
}

pub fn remove_task(database: &Database, task_id: &str) -> Result<(), String> {
    require_task(database, task_id)?;
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM tasks WHERE id = ?1", [task_id])?;
        prune_unused_tags(&transaction)?;
        transaction.commit()
    })
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub fn query_tasks(database: &Database, filter: TaskFilter) -> Result<Vec<TaskSummary>, String> {
    let (today_start, tomorrow_start) = today_bounds()?;
    let mut conditions: Vec<&str> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    let status = filter.status.filter(|status| !status.is_empty());
    if let Some(status) = &status {
        validate_status(status)?;
    }
    match filter.view {
        TaskView::Today => {
            if filter.include_completed {
                conditions.push(
                    "((t.status IN ('pending', 'in_progress') AND t.due_at < ?)
                      OR (t.completed_at >= ? AND t.completed_at < ?))",
                );
                values.extend([
                    Value::Integer(tomorrow_start),
                    Value::Integer(today_start),
                    Value::Integer(tomorrow_start),
                ]);
            } else {
                conditions.push("t.status IN ('pending', 'in_progress') AND t.due_at < ?");
                values.push(Value::Integer(tomorrow_start));
            }
        }
        TaskView::Upcoming => {
            conditions.push("t.status IN ('pending', 'in_progress') AND t.due_at >= ?");
            values.push(Value::Integer(tomorrow_start));
        }
        TaskView::Completed => conditions.push("t.status = 'completed'"),
        TaskView::All => {
            if !filter.include_completed && status.is_none() {
                conditions.push("t.status IN ('pending', 'in_progress')");
            }
        }
    }
    if let Some(status) = status {
        conditions.push("t.status = ?");
        values.push(Value::Text(status));
    }
    match filter.project_id.as_deref() {
        None | Some("") => {}
        Some("none") => conditions.push("t.project_id IS NULL"),
        Some(project_id) => {
            conditions.push("t.project_id = ?");
            values.push(Value::Text(project_id.to_string()));
        }
    }
    if let Some(priority) = filter.priority.filter(|priority| !priority.is_empty()) {
        validate_priority(&priority)?;
        conditions.push("t.priority = ?");
        values.push(Value::Text(priority));
    }
    if let Some(tag_id) = filter.tag_id.filter(|tag_id| !tag_id.is_empty()) {
        conditions
            .push("EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND tt.tag_id = ?)");
        values.push(Value::Text(tag_id));
    }
    if let Some(search) = filter.search.as_deref().map(str::trim)
        && !search.is_empty()
    {
        if search.chars().count() > 200 {
            return Err("La búsqueda no puede superar 200 caracteres".to_string());
        }
        conditions.push(
            "(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\'
              OR EXISTS (SELECT 1 FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
                         WHERE tt.task_id = t.id AND g.name LIKE ? ESCAPE '\\'))",
        );
        let pattern = format!("%{}%", escape_like(search));
        values.extend(std::iter::repeat_n(Value::Text(pattern), 3));
    }

    let order = if filter.view == TaskView::Completed {
        "t.completed_at DESC".to_string()
    } else {
        let key = match filter.sort {
            TaskSort::Due => {
                format!("t.due_at IS NULL, t.due_at ASC, {PRIORITY_RANK} DESC, t.created_at DESC")
            }
            TaskSort::Priority => {
                format!("{PRIORITY_RANK} DESC, t.due_at IS NULL, t.due_at ASC, t.created_at DESC")
            }
            TaskSort::Created => "t.created_at DESC".to_string(),
            TaskSort::Title => "t.title COLLATE NOCASE ASC".to_string(),
        };
        format!("t.status IN ('completed', 'cancelled'), {key}")
    };
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    let sql = format!("{TASK_SELECT} {where_clause} ORDER BY {order} LIMIT {LIST_LIMIT}");

    database.with_connection(|connection| {
        connection
            .prepare(&sql)?
            .query_map(params_from_iter(values.iter()), map_summary)?
            .collect()
    })
}

fn subtask_parent(database: &Database, subtask_id: &str) -> Result<String, String> {
    require_id(subtask_id, "Identificador de subtarea no válido")?;
    database
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT task_id FROM subtasks WHERE id = ?1",
                    [subtask_id],
                    |row| row.get(0),
                )
                .optional()
        })?
        .ok_or_else(|| "La subtarea no existe".to_string())
}

pub fn insert_subtask(
    database: &Database,
    task_id: &str,
    title: &str,
) -> Result<TaskDetail, String> {
    require_task(database, task_id)?;
    let title = validate_title(title)?;
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        let (count, next_position): (i64, i64) = transaction.query_row(
            "SELECT COUNT(*), COALESCE(MAX(position) + 1, 0) FROM subtasks WHERE task_id = ?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if count >= MAX_SUBTASKS {
            return Ok(Err(format!(
                "Una tarea admite como máximo {MAX_SUBTASKS} subtareas"
            )));
        }
        transaction.execute(
            "INSERT INTO subtasks(id, task_id, title, position) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::new_v4().to_string(), task_id, title, next_position],
        )?;
        touch_task(&transaction, task_id)?;
        transaction.commit()?;
        Ok(Ok(()))
    })??;
    load_detail(database, task_id)
}

pub fn modify_subtask(
    database: &Database,
    subtask_id: &str,
    title: Option<String>,
    is_completed: Option<bool>,
) -> Result<TaskDetail, String> {
    let task_id = subtask_parent(database, subtask_id)?;
    let title = title.as_deref().map(validate_title).transpose()?;
    let now = Utc::now().timestamp();
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        if let Some(title) = &title {
            transaction.execute(
                "UPDATE subtasks SET title = ?1 WHERE id = ?2",
                params![title, subtask_id],
            )?;
        }
        if let Some(is_completed) = is_completed {
            transaction.execute(
                "UPDATE subtasks SET is_completed = ?1,
                    completed_at = CASE WHEN ?1 THEN COALESCE(completed_at, ?2) ELSE NULL END
                 WHERE id = ?3",
                params![is_completed, now, subtask_id],
            )?;
        }
        touch_task(&transaction, &task_id)?;
        transaction.commit()
    })?;
    load_detail(database, &task_id)
}

pub fn remove_subtask(database: &Database, subtask_id: &str) -> Result<TaskDetail, String> {
    let task_id = subtask_parent(database, subtask_id)?;
    database.with_connection(|connection| {
        connection.execute("DELETE FROM subtasks WHERE id = ?1", [subtask_id])?;
        touch_task(connection, &task_id)
    })?;
    load_detail(database, &task_id)
}

pub fn set_note_link(
    database: &Database,
    task_id: &str,
    note_id: &str,
    linked: bool,
) -> Result<TaskDetail, String> {
    require_task(database, task_id)?;
    require_id(note_id, "Identificador de nota no válido")?;
    ensure_exists(
        database,
        "SELECT EXISTS(SELECT 1 FROM notes WHERE id = ?1)",
        note_id,
        "La nota no existe",
    )?;
    database.with_connection(|connection| {
        if linked {
            connection.execute(
                "INSERT OR IGNORE INTO task_notes(task_id, note_id) VALUES (?1, ?2)",
                params![task_id, note_id],
            )?;
        } else {
            connection.execute(
                "DELETE FROM task_notes WHERE task_id = ?1 AND note_id = ?2",
                params![task_id, note_id],
            )?;
        }
        touch_task(connection, task_id)
    })?;
    load_detail(database, task_id)
}

fn notify(app: &AppHandle) {
    let _ = app.emit("flowdesk://data-changed", "tasks");
}

#[tauri::command]
pub fn list_tasks(
    filter: TaskFilter,
    database: State<'_, Database>,
) -> Result<Vec<TaskSummary>, String> {
    query_tasks(&database, filter)
}

#[tauri::command]
pub fn get_task(task_id: String, database: State<'_, Database>) -> Result<TaskDetail, String> {
    require_task(&database, &task_id)?;
    load_detail(&database, &task_id)
}

#[tauri::command]
pub fn list_tags(database: State<'_, Database>) -> Result<Vec<Tag>, String> {
    database.with_connection(|connection| {
        connection
            .prepare("SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE")?
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            })?
            .collect()
    })
}

#[tauri::command]
pub fn create_task(
    input: TaskInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<TaskDetail, String> {
    let task = insert_task(&database, input)?;
    notify(&app);
    Ok(task)
}

#[tauri::command]
pub fn update_task(
    task_id: String,
    input: TaskInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<TaskDetail, String> {
    let task = modify_task(&database, &task_id, input)?;
    notify(&app);
    Ok(task)
}

#[tauri::command]
pub fn set_task_status(
    task_id: String,
    status: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<TaskDetail, String> {
    let task = change_status(&database, &task_id, &status)?;
    notify(&app);
    Ok(task)
}

#[tauri::command]
pub fn delete_task(
    task_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    remove_task(&database, &task_id)?;
    notify(&app);
    Ok(())
}

#[tauri::command]
pub fn add_subtask(
    task_id: String,
    title: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<TaskDetail, String> {
    let task = insert_subtask(&database, &task_id, &title)?;
    notify(&app);
    Ok(task)
}

#[tauri::command]
pub fn update_subtask(
    subtask_id: String,
    title: Option<String>,
    is_completed: Option<bool>,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<TaskDetail, String> {
    let task = modify_subtask(&database, &subtask_id, title, is_completed)?;
    notify(&app);
    Ok(task)
}

#[tauri::command]
pub fn delete_subtask(
    subtask_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<TaskDetail, String> {
    let task = remove_subtask(&database, &subtask_id)?;
    notify(&app);
    Ok(task)
}

#[tauri::command]
pub fn link_task_note(
    task_id: String,
    note_id: String,
    linked: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<TaskDetail, String> {
    let task = set_note_link(&database, &task_id, &note_id, linked)?;
    notify(&app);
    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::dashboard::load_dashboard;

    fn titled(title: &str) -> TaskInput {
        TaskInput {
            title: title.to_string(),
            ..TaskInput::default()
        }
    }

    fn due(title: &str, due_at: i64) -> TaskInput {
        TaskInput {
            due_at: Some(due_at),
            ..titled(title)
        }
    }

    fn titles(tasks: &[TaskSummary]) -> Vec<&str> {
        tasks.iter().map(|task| task.title.as_str()).collect()
    }

    fn insert_project(database: &Database) -> String {
        let id = Uuid::new_v4().to_string();
        database
            .with_connection(|connection| {
                connection.execute("INSERT INTO projects(id, name) VALUES (?1, 'Tesis')", [&id])
            })
            .expect("project");
        id
    }

    #[test]
    fn creates_a_persistent_task_and_updates_dashboard() {
        let database = Database::in_memory();
        let (today_start, _) = today_bounds().expect("bounds");
        let task = insert_task(&database, due("  Preparar la semana  ", today_start + 3600))
            .expect("created task");

        assert_eq!(task.summary.title, "Preparar la semana");
        let summary = load_dashboard(&database).expect("dashboard");
        assert_eq!(summary.today_tasks, 1);
        assert_eq!(summary.upcoming_tasks.len(), 1);
        assert_eq!(summary.upcoming_tasks[0].title, "Preparar la semana");
    }

    #[test]
    fn rejects_invalid_input() {
        let database = Database::in_memory();
        assert!(insert_task(&database, titled("   ")).is_err());
        let bad_priority = TaskInput {
            priority: Some("critical".to_string()),
            ..titled("Tarea")
        };
        assert!(insert_task(&database, bad_priority).is_err());
        let unknown_project = TaskInput {
            project_id: Some(Uuid::new_v4().to_string()),
            ..titled("Tarea")
        };
        assert_eq!(
            insert_task(&database, unknown_project).unwrap_err(),
            "El proyecto seleccionado no existe"
        );
    }

    #[test]
    fn normalizes_tags_and_prunes_unused_ones() {
        let database = Database::in_memory();
        let input = TaskInput {
            tags: vec![
                "#Docencia".to_string(),
                "docencia".to_string(),
                " ".to_string(),
                "Rust".to_string(),
            ],
            ..titled("Preparar clase")
        };
        let task = insert_task(&database, input).expect("task");
        let names: Vec<_> = task
            .summary
            .tags
            .iter()
            .map(|tag| tag.name.as_str())
            .collect();
        assert_eq!(names, ["Docencia", "Rust"]);

        let task_id = task.summary.id.clone();
        let without_rust = TaskInput {
            tags: vec!["Docencia".to_string()],
            ..titled("Preparar clase")
        };
        modify_task(&database, &task_id, without_rust).expect("updated");
        let tag_count: i64 = database
            .with_connection(|connection| {
                connection.query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            })
            .expect("tags");
        assert_eq!(tag_count, 1);

        remove_task(&database, &task_id).expect("deleted");
        let tag_count: i64 = database
            .with_connection(|connection| {
                connection.query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            })
            .expect("tags");
        assert_eq!(tag_count, 0);
    }

    #[test]
    fn status_changes_maintain_completion_time() {
        let database = Database::in_memory();
        let task = insert_task(&database, titled("Revisar artículo")).expect("task");
        let completed = change_status(&database, &task.summary.id, "completed").expect("done");
        assert!(completed.summary.completed_at.is_some());
        let reopened = change_status(&database, &task.summary.id, "in_progress").expect("open");
        assert!(reopened.summary.completed_at.is_none());
        assert!(change_status(&database, &task.summary.id, "done").is_err());
    }

    #[test]
    fn filters_views_projects_and_search() {
        let database = Database::in_memory();
        let (today_start, tomorrow_start) = today_bounds().expect("bounds");
        let project_id = insert_project(&database);
        insert_task(&database, due("Vencida", today_start - 86_400)).expect("overdue");
        insert_task(
            &database,
            TaskInput {
                project_id: Some(project_id.clone()),
                priority: Some("urgent".to_string()),
                ..due("Hoy 100%", today_start + 3600)
            },
        )
        .expect("today");
        insert_task(&database, due("Mañana", tomorrow_start + 3600)).expect("tomorrow");
        let done = insert_task(&database, titled("Hecha")).expect("done");
        change_status(&database, &done.summary.id, "completed").expect("complete");

        let today = query_tasks(
            &database,
            TaskFilter {
                view: TaskView::Today,
                ..TaskFilter::default()
            },
        )
        .expect("today view");
        assert_eq!(titles(&today), ["Vencida", "Hoy 100%"]);

        let today_with_done = query_tasks(
            &database,
            TaskFilter {
                view: TaskView::Today,
                include_completed: true,
                ..TaskFilter::default()
            },
        )
        .expect("today view");
        assert_eq!(titles(&today_with_done), ["Vencida", "Hoy 100%", "Hecha"]);

        let upcoming = query_tasks(
            &database,
            TaskFilter {
                view: TaskView::Upcoming,
                ..TaskFilter::default()
            },
        )
        .expect("upcoming");
        assert_eq!(titles(&upcoming), ["Mañana"]);

        let by_project = query_tasks(
            &database,
            TaskFilter {
                project_id: Some(project_id),
                ..TaskFilter::default()
            },
        )
        .expect("project");
        assert_eq!(titles(&by_project), ["Hoy 100%"]);
        assert_eq!(by_project[0].project_name.as_deref(), Some("Tesis"));

        let without_project = query_tasks(
            &database,
            TaskFilter {
                project_id: Some("none".to_string()),
                ..TaskFilter::default()
            },
        )
        .expect("no project");
        assert_eq!(titles(&without_project), ["Vencida", "Mañana"]);

        // `%` se busca literalmente, no como comodín.
        let literal = query_tasks(
            &database,
            TaskFilter {
                search: Some("100%".to_string()),
                ..TaskFilter::default()
            },
        )
        .expect("search");
        assert_eq!(titles(&literal), ["Hoy 100%"]);

        let by_priority = query_tasks(
            &database,
            TaskFilter {
                sort: TaskSort::Priority,
                ..TaskFilter::default()
            },
        )
        .expect("priority");
        assert_eq!(by_priority[0].title, "Hoy 100%");

        let completed = query_tasks(
            &database,
            TaskFilter {
                view: TaskView::Completed,
                ..TaskFilter::default()
            },
        )
        .expect("completed");
        assert_eq!(titles(&completed), ["Hecha"]);
    }

    #[test]
    fn filters_by_tag() {
        let database = Database::in_memory();
        insert_task(
            &database,
            TaskInput {
                tags: vec!["Laboratorio".to_string()],
                ..titled("Calibrar equipo")
            },
        )
        .expect("tagged");
        insert_task(&database, titled("Otra")).expect("plain");
        let tag_id: String = database
            .with_connection(|connection| {
                connection.query_row("SELECT id FROM tags", [], |row| row.get(0))
            })
            .expect("tag");
        let tasks = query_tasks(
            &database,
            TaskFilter {
                tag_id: Some(tag_id),
                ..TaskFilter::default()
            },
        )
        .expect("by tag");
        assert_eq!(titles(&tasks), ["Calibrar equipo"]);
    }

    #[test]
    fn manages_subtasks() {
        let database = Database::in_memory();
        let task = insert_task(&database, titled("Publicar versión")).expect("task");
        let task_id = task.summary.id;
        insert_subtask(&database, &task_id, "Compilar").expect("first");
        let detail = insert_subtask(&database, &task_id, "Probar").expect("second");
        assert_eq!(detail.subtasks.len(), 2);
        assert_eq!(detail.subtasks[1].position, 1);

        let first_id = detail.subtasks[0].id.clone();
        let detail = modify_subtask(&database, &first_id, None, Some(true)).expect("toggle");
        assert_eq!(detail.summary.subtask_count, 2);
        assert_eq!(detail.summary.subtasks_completed, 1);

        let detail = remove_subtask(&database, &first_id).expect("delete");
        assert_eq!(detail.subtasks.len(), 1);
        assert!(insert_subtask(&database, &task_id, " ").is_err());

        remove_task(&database, &task_id).expect("delete task");
        let remaining: i64 = database
            .with_connection(|connection| {
                connection.query_row("SELECT COUNT(*) FROM subtasks", [], |row| row.get(0))
            })
            .expect("subtasks");
        assert_eq!(remaining, 0);
    }

    #[test]
    fn links_tasks_with_notes() {
        let database = Database::in_memory();
        let note_id = Uuid::new_v4().to_string();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO notes(id, title, content) VALUES (?1, 'Ideas', 'Texto')",
                    [&note_id],
                )
            })
            .expect("note");
        let task = insert_task(
            &database,
            TaskInput {
                note_id: Some(note_id.clone()),
                ..titled("Desarrollar idea")
            },
        )
        .expect("task from note");
        assert_eq!(task.notes.len(), 1);
        assert_eq!(task.summary.note_count, 1);

        let detail = set_note_link(&database, &task.summary.id, &note_id, false).expect("unlink");
        assert!(detail.notes.is_empty());
        set_note_link(&database, &task.summary.id, &note_id, true).expect("relink");

        database
            .with_connection(|connection| {
                connection.execute("DELETE FROM notes WHERE id = ?1", [&note_id])
            })
            .expect("delete note");
        let detail = load_detail(&database, &task.summary.id).expect("task survives");
        assert!(detail.notes.is_empty());
    }
}
