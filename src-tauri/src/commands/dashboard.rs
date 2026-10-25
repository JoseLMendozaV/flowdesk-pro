use crate::{
    commands::workspaces::{active_workspace, event_scope, note_scope, project_scope, task_scope},
    database::Database,
    models::{ActiveTimer, DashboardNote, DashboardSummary, DashboardTask, UpcomingEvent},
};
use chrono::{Local, TimeZone};
use rusqlite::{OptionalExtension, params};
use tauri::State;

pub(crate) fn today_bounds() -> Result<(i64, i64), String> {
    let today = Local::now().date_naive();
    let start = today
        .and_hms_opt(0, 0, 0)
        .and_then(|value| Local.from_local_datetime(&value).earliest())
        .ok_or_else(|| "No se pudo calcular el inicio del día".to_string())?;
    let end = start + chrono::Duration::days(1);
    Ok((start.timestamp(), end.timestamp()))
}

pub fn load_dashboard(database: &Database) -> Result<DashboardSummary, String> {
    let (today_start, tomorrow_start) = today_bounds()?;
    let now = Local::now().timestamp();

    // Tareas, proyectos, notas y eventos siguen al espacio activo (`?3`); el tiempo no.
    let tasks_in = format!("(?3 IS NULL OR {})", task_scope("t", "?3"));
    let projects_in = format!("(?3 IS NULL OR {})", project_scope("p", "?3"));
    database.with_connection(|connection| {
        let workspace_id = active_workspace(connection)?;
        let scoped = params![today_start, tomorrow_start, workspace_id];
        let today_tasks = connection.query_row(
            &format!(
                "SELECT COUNT(*) FROM tasks t
                 WHERE t.status NOT IN ('completed', 'cancelled')
                 AND t.due_at >= ?1 AND t.due_at < ?2 AND {tasks_in}"
            ),
            scoped,
            |row| row.get(0),
        )?;
        let overdue_tasks = connection.query_row(
            &format!(
                "SELECT COUNT(*) FROM tasks t
                 WHERE t.status NOT IN ('completed', 'cancelled') AND t.due_at < ?1
                 AND {tasks_in}"
            ),
            scoped,
            |row| row.get(0),
        )?;
        let completed_today = connection.query_row(
            &format!(
                "SELECT COUNT(*) FROM tasks t
                 WHERE t.completed_at >= ?1 AND t.completed_at < ?2 AND {tasks_in}"
            ),
            scoped,
            |row| row.get(0),
        )?;
        let active_projects = connection.query_row(
            &format!(
                "SELECT COUNT(*) FROM projects p
                 WHERE p.status = 'active' AND p.archived_at IS NULL AND {projects_in}"
            ),
            scoped,
            |row| row.get(0),
        )?;
        let focus_seconds_today = connection.query_row(
            "SELECT COALESCE(SUM(elapsed_seconds), 0) FROM pomodoro_sessions
             WHERE session_type = 'focus' AND started_at >= ?1 AND started_at < ?2",
            [today_start, tomorrow_start],
            |row| row.get(0),
        )?;
        let tracked_seconds_today = connection.query_row(
            "SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries
             WHERE started_at >= ?1 AND started_at < ?2",
            [today_start, tomorrow_start],
            |row| row.get(0),
        )?;

        let mut task_statement = connection.prepare(&format!(
            "SELECT t.id, t.title, t.priority, t.due_at, t.due_has_time, p.color
             FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
             WHERE t.status NOT IN ('completed', 'cancelled') AND t.due_at IS NOT NULL
             AND {}
             ORDER BY t.due_at ASC LIMIT 5",
            format_args!("(?1 IS NULL OR {})", task_scope("t", "?1"))
        ))?;
        let upcoming_tasks = task_statement
            .query_map([&workspace_id], |row| {
                Ok(DashboardTask {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    priority: row.get(2)?,
                    due_at: row.get(3)?,
                    due_has_time: row.get(4)?,
                    project_color: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut note_statement = connection.prepare(&format!(
            "SELECT n.id, n.title, substr(n.content, 1, 120), n.color, n.updated_at FROM notes n
             WHERE n.is_archived = 0 AND {} ORDER BY n.updated_at DESC LIMIT 4",
            note_scope("n", "?1")
        ))?;
        let recent_notes = note_statement
            .query_map([&workspace_id], |row| {
                Ok(DashboardNote {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    preview: row.get(2)?,
                    color: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let next_event = connection
            .query_row(
                &format!(
                    "SELECT e.id, e.title, e.starts_at, e.is_all_day FROM calendar_events e
                     WHERE e.ends_at > ?1 AND {} ORDER BY e.starts_at ASC LIMIT 1",
                    event_scope("e", "?2")
                ),
                params![now, workspace_id],
                |row| {
                    Ok(UpcomingEvent {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        starts_at: row.get(2)?,
                        is_all_day: row.get(3)?,
                    })
                },
            )
            .optional()?;

        let active_timer = connection
            .query_row(
                "SELECT id, status, session_type, planned_seconds, elapsed_seconds,
                        started_at, expected_end_at
                 FROM pomodoro_sessions WHERE status IN ('running', 'paused')
                 ORDER BY updated_at DESC LIMIT 1",
                [],
                |row| {
                    Ok(ActiveTimer {
                        id: row.get(0)?,
                        status: row.get(1)?,
                        session_type: row.get(2)?,
                        planned_seconds: row.get(3)?,
                        elapsed_seconds: row.get(4)?,
                        started_at: row.get(5)?,
                        expected_end_at: row.get(6)?,
                    })
                },
            )
            .optional()?;

        let scheduled_total = today_tasks + completed_today;
        let completion_percent = if scheduled_total == 0 {
            0.0
        } else {
            (completed_today as f64 / scheduled_total as f64) * 100.0
        };

        Ok(DashboardSummary {
            today_tasks,
            overdue_tasks,
            completed_today,
            active_projects,
            focus_seconds_today,
            tracked_seconds_today,
            completion_percent,
            upcoming_tasks,
            recent_notes,
            next_event,
            active_timer,
        })
    })
}

#[tauri::command]
pub fn get_dashboard_summary(database: State<'_, Database>) -> Result<DashboardSummary, String> {
    load_dashboard(&database)
}

#[cfg(test)]
mod tests {
    use super::load_dashboard;
    use crate::database::Database;

    #[test]
    fn empty_database_returns_real_zero_values() {
        let database = Database::in_memory();
        let summary = load_dashboard(&database).expect("dashboard summary");
        assert_eq!(summary.today_tasks, 0);
        assert_eq!(summary.active_projects, 0);
        assert_eq!(summary.completion_percent, 0.0);
        assert!(summary.upcoming_tasks.is_empty());
        assert!(summary.next_event.is_none());
    }
}
