use crate::{
    commands::workspaces::{active_workspace, event_scope, task_scope},
    database::Database,
    models::{CalendarEvent, CalendarRange, CalendarTask, EventInput},
};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

/// Un año y un día: cubre la vista de mes con semanas parciales sin permitir rangos abusivos.
const MAX_RANGE_SECONDS: i64 = 367 * 86_400;
const MAX_EVENT_SECONDS: i64 = 366 * 86_400;
const MAX_REMINDER_MINUTES: i64 = 7 * 24 * 60;

const EVENT_SELECT: &str = "SELECT e.id, e.title, e.description, e.project_id, p.name, p.color,
            e.starts_at, e.ends_at, e.is_all_day, e.location, e.reminder_minutes
     FROM calendar_events e LEFT JOIN projects p ON p.id = e.project_id";

struct ValidEvent {
    title: String,
    description: String,
    project_id: Option<String>,
    starts_at: i64,
    ends_at: i64,
    is_all_day: bool,
    location: Option<String>,
    reminder_minutes: Option<i64>,
}

fn map_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        project_id: row.get(3)?,
        project_name: row.get(4)?,
        project_color: row.get(5)?,
        starts_at: row.get(6)?,
        ends_at: row.get(7)?,
        is_all_day: row.get(8)?,
        location: row.get(9)?,
        reminder_minutes: row.get(10)?,
    })
}

fn query_event(connection: &Connection, event_id: &str) -> rusqlite::Result<Option<CalendarEvent>> {
    connection
        .query_row(
            &format!("{EVENT_SELECT} WHERE e.id = ?1"),
            [event_id],
            map_event,
        )
        .optional()
}

fn load_event(database: &Database, event_id: &str) -> Result<CalendarEvent, String> {
    Uuid::parse_str(event_id).map_err(|_| "Identificador de evento no válido".to_string())?;
    database
        .with_connection(|connection| query_event(connection, event_id))?
        .ok_or_else(|| "El evento no existe".to_string())
}

fn validate_event(database: &Database, input: EventInput) -> Result<ValidEvent, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("El título del evento no puede estar vacío".to_string());
    }
    if title.chars().count() > 200 {
        return Err("El título no puede superar 200 caracteres".to_string());
    }
    if input.description.chars().count() > 4_000 {
        return Err("La descripción no puede superar 4 000 caracteres".to_string());
    }
    let location = input
        .location
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if location
        .as_ref()
        .is_some_and(|value| value.chars().count() > 200)
    {
        return Err("La ubicación no puede superar 200 caracteres".to_string());
    }
    if input.ends_at <= input.starts_at {
        return Err("El evento debe terminar después de empezar".to_string());
    }
    if input.ends_at - input.starts_at > MAX_EVENT_SECONDS {
        return Err("Un evento no puede durar más de un año".to_string());
    }
    if input
        .reminder_minutes
        .is_some_and(|minutes| !(0..=MAX_REMINDER_MINUTES).contains(&minutes))
    {
        return Err("El aviso debe estar entre la hora del evento y una semana antes".to_string());
    }
    let project_id = input.project_id.filter(|value| !value.is_empty());
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
            return Err("El proyecto no existe".to_string());
        }
    }
    Ok(ValidEvent {
        title: title.to_string(),
        description: input.description.trim().to_string(),
        project_id,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        is_all_day: input.is_all_day,
        location,
        reminder_minutes: input.reminder_minutes,
    })
}

/// Eventos que se solapan con `[start, end)` y tareas abiertas o completadas con
/// fecha límite dentro del intervalo.
pub fn query_range(database: &Database, start: i64, end: i64) -> Result<CalendarRange, String> {
    if end <= start || end - start > MAX_RANGE_SECONDS {
        return Err("Intervalo de calendario no válido".to_string());
    }
    database.with_connection(|connection| {
        // `?3`: espacio activo (ver commands/workspaces.rs).
        let workspace_id = active_workspace(connection)?;
        let events = connection
            .prepare(&format!(
                "{EVENT_SELECT} WHERE e.starts_at < ?2 AND e.ends_at > ?1 AND {}
                 ORDER BY e.is_all_day DESC, e.starts_at, e.title COLLATE NOCASE",
                event_scope("e", "?3")
            ))?
            .query_map(params![start, end, workspace_id], map_event)?
            .collect::<Result<Vec<_>, _>>()?;
        let tasks = connection
            .prepare(&format!(
                "SELECT t.id, t.title, t.status, t.priority, t.due_at, t.due_has_time, p.color
                 FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
                 WHERE t.status != 'cancelled' AND t.due_at >= ?1 AND t.due_at < ?2
                 AND (?3 IS NULL OR {})
                 ORDER BY t.due_at, t.title COLLATE NOCASE",
                task_scope("t", "?3")
            ))?
            .query_map(params![start, end, workspace_id], |row| {
                Ok(CalendarTask {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    status: row.get(2)?,
                    priority: row.get(3)?,
                    due_at: row.get(4)?,
                    due_has_time: row.get(5)?,
                    project_color: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(CalendarRange { events, tasks })
    })
}

pub fn insert_event(database: &Database, input: EventInput) -> Result<CalendarEvent, String> {
    let event = validate_event(database, input)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO calendar_events(id, title, description, project_id, starts_at, ends_at,
                is_all_day, location, reminder_minutes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                id,
                event.title,
                event.description,
                event.project_id,
                event.starts_at,
                event.ends_at,
                event.is_all_day,
                event.location,
                event.reminder_minutes,
                now
            ],
        )?;
        Ok(())
    })?;
    load_event(database, &id)
}

pub fn modify_event(
    database: &Database,
    event_id: &str,
    input: EventInput,
) -> Result<CalendarEvent, String> {
    load_event(database, event_id)?;
    let event = validate_event(database, input)?;
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE calendar_events SET title = ?1, description = ?2, project_id = ?3,
                starts_at = ?4, ends_at = ?5, is_all_day = ?6, location = ?7,
                reminder_minutes = ?8, updated_at = ?9
             WHERE id = ?10",
            params![
                event.title,
                event.description,
                event.project_id,
                event.starts_at,
                event.ends_at,
                event.is_all_day,
                event.location,
                event.reminder_minutes,
                Utc::now().timestamp(),
                event_id
            ],
        )?;
        Ok(())
    })?;
    load_event(database, event_id)
}

pub fn remove_event(database: &Database, event_id: &str) -> Result<(), String> {
    load_event(database, event_id)?;
    database.with_connection(|connection| {
        connection.execute("DELETE FROM calendar_events WHERE id = ?1", [event_id])?;
        Ok(())
    })
}

fn notify(app: &AppHandle) {
    let _ = app.emit("flowdesk://data-changed", "calendar");
}

#[tauri::command]
pub fn list_calendar(
    start: i64,
    end: i64,
    database: State<'_, Database>,
) -> Result<CalendarRange, String> {
    query_range(&database, start, end)
}

#[tauri::command]
pub fn create_event(
    input: EventInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<CalendarEvent, String> {
    let event = insert_event(&database, input)?;
    notify(&app);
    Ok(event)
}

#[tauri::command]
pub fn update_event(
    event_id: String,
    input: EventInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<CalendarEvent, String> {
    let event = modify_event(&database, &event_id, input)?;
    notify(&app);
    Ok(event)
}

#[tauri::command]
pub fn delete_event(
    event_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    remove_event(&database, &event_id)?;
    notify(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        commands::{
            dashboard::load_dashboard,
            projects::{PROJECT_COLORS, insert_project, remove_project},
            tasks::insert_task,
        },
        models::{ProjectDeleteMode, ProjectInput, TaskInput},
    };

    fn event(title: &str, starts_at: i64, ends_at: i64) -> EventInput {
        EventInput {
            title: title.to_string(),
            starts_at,
            ends_at,
            ..EventInput::default()
        }
    }

    #[test]
    fn validates_event_input() {
        let database = Database::in_memory();
        assert!(insert_event(&database, event("  ", 100, 200)).is_err());
        assert!(insert_event(&database, event("Clase", 200, 200)).is_err());
        assert!(insert_event(&database, event("Clase", 0, MAX_EVENT_SECONDS + 1)).is_err());
        let early = EventInput {
            reminder_minutes: Some(-5),
            ..event("Clase", 100, 200)
        };
        assert!(insert_event(&database, early).is_err());
        let orphan = EventInput {
            project_id: Some(Uuid::new_v4().to_string()),
            ..event("Clase", 100, 200)
        };
        assert!(insert_event(&database, orphan).is_err());
    }

    #[test]
    fn range_returns_overlapping_events_and_due_tasks() {
        let database = Database::in_memory();
        let inside = insert_event(&database, event("Seminario", 1_000, 2_000)).expect("event");
        insert_event(&database, event("Viaje", 500, 1_500)).expect("overlap start");
        insert_event(&database, event("Antes", 100, 1_000)).expect("ends at start");
        insert_event(&database, event("Después", 3_000, 4_000)).expect("starts at end");
        insert_task(
            &database,
            TaskInput {
                title: "Entregar acta".to_string(),
                due_at: Some(1_500),
                due_has_time: Some(true),
                ..TaskInput::default()
            },
        )
        .expect("task");

        let range = query_range(&database, 1_000, 3_000).expect("range");
        let titles: Vec<_> = range
            .events
            .iter()
            .map(|event| event.title.as_str())
            .collect();
        assert_eq!(titles, ["Viaje", "Seminario"]);
        assert_eq!(range.tasks.len(), 1);
        assert!(query_range(&database, 10, 10).is_err());

        let updated = modify_event(
            &database,
            &inside.id,
            EventInput {
                location: Some("  Aula 3 ".to_string()),
                reminder_minutes: Some(15),
                ..event("Seminario de tesis", 1_200, 2_400)
            },
        )
        .expect("update");
        assert_eq!(updated.location.as_deref(), Some("Aula 3"));
        assert_eq!(updated.reminder_minutes, Some(15));
        remove_event(&database, &inside.id).expect("delete");
        assert!(load_event(&database, &inside.id).is_err());
    }

    #[test]
    fn deleting_project_keeps_events() {
        let database = Database::in_memory();
        let project = insert_project(
            &database,
            ProjectInput {
                name: "Docencia".to_string(),
                color: PROJECT_COLORS[0].to_string(),
                status: "active".to_string(),
                ..ProjectInput::default()
            },
        )
        .expect("project");
        let created = insert_event(
            &database,
            EventInput {
                project_id: Some(project.id.clone()),
                ..event("Evaluación", 1_000, 2_000)
            },
        )
        .expect("event");
        assert_eq!(created.project_name.as_deref(), Some("Docencia"));
        remove_project(&database, &project.id, ProjectDeleteMode::DeleteTasks).expect("delete");
        let kept = load_event(&database, &created.id).expect("event kept");
        assert!(kept.project_id.is_none());
    }

    #[test]
    fn dashboard_shows_next_event() {
        let database = Database::in_memory();
        let now = Utc::now().timestamp();
        insert_event(&database, event("Pasado", now - 7_200, now - 3_600)).expect("past");
        insert_event(&database, event("Reunión", now + 600, now + 4_200)).expect("next");
        let next = load_dashboard(&database)
            .expect("dashboard")
            .next_event
            .expect("next event");
        assert_eq!(next.title, "Reunión");
    }
}
