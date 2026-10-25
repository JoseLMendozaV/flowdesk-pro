use crate::{
    database::Database,
    models::{ActiveTimer, DashboardNote, DashboardSummary, DashboardTask, UpcomingEvent},
};
use chrono::{Local, TimeZone};
use rusqlite::OptionalExtension;
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

    database.with_connection(|connection| {
        let today_tasks = connection.query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE status NOT IN ('completed', 'cancelled')
             AND due_at >= ?1 AND due_at < ?2",
            [today_start, tomorrow_start],
            |row| row.get(0),
        )?;
        let overdue_tasks = connection.query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE status NOT IN ('completed', 'cancelled') AND due_at < ?1",
            [today_start],
            |row| row.get(0),
        )?;
        let completed_today = connection.query_row(
            "SELECT COUNT(*) FROM tasks WHERE completed_at >= ?1 AND completed_at < ?2",
            [today_start, tomorrow_start],
            |row| row.get(0),
        )?;
        let active_projects = connection.query_row(
            "SELECT COUNT(*) FROM projects WHERE status = 'active' AND archived_at IS NULL",
            [],
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

        let mut task_statement = connection.prepare(
            "SELECT t.id, t.title, t.priority, t.due_at, t.due_has_time, p.color
             FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
             WHERE t.status NOT IN ('completed', 'cancelled') AND t.due_at IS NOT NULL
             ORDER BY t.due_at ASC LIMIT 5",
        )?;
        let upcoming_tasks = task_statement
            .query_map([], |row| {
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

        let mut note_statement = connection.prepare(
            "SELECT id, title, substr(content, 1, 120), color, updated_at FROM notes
             WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT 4",
        )?;
        let recent_notes = note_statement
            .query_map([], |row| {
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
                "SELECT id, title, starts_at FROM calendar_events
                 WHERE ends_at >= ?1 ORDER BY starts_at ASC LIMIT 1",
                [now],
                |row| {
                    Ok(UpcomingEvent {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        starts_at: row.get(2)?,
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
