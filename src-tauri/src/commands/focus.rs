use crate::{
    background::{
        self, TimerService,
        timer::{day_start, load_context, load_settings, refresh_task_time, validate_settings},
    },
    database::Database,
    models::{
        DayStat, EntryInput, FocusSession, PomodoroSettings, ProjectTime, StartPomodoro, TimeEntry,
        TimeStats, TimerSnapshot,
    },
};
use chrono::{Datelike, Duration, Local, TimeZone};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

type TimerResult = Result<TimerSnapshot, String>;

fn published(app: &AppHandle, result: TimerResult) -> TimerResult {
    if let Ok(snapshot) = &result {
        background::publish(app, snapshot);
    }
    result
}

#[tauri::command]
pub fn get_timer_state(
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
) -> TimerResult {
    timers.snapshot(&database)
}

#[tauri::command]
pub fn start_pomodoro(
    input: StartPomodoro,
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.start_pomodoro(&database, input))
}

#[tauri::command]
pub fn pause_pomodoro(
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.pause_pomodoro(&database))
}

#[tauri::command]
pub fn resume_pomodoro(
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.resume_pomodoro(&database))
}

#[tauri::command]
pub fn stop_pomodoro(
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.stop_pomodoro(&database))
}

#[tauri::command]
pub fn toggle_pomodoro(
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.toggle_pomodoro(&database))
}

#[tauri::command]
pub fn start_time_entry(
    input: EntryInput,
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.start_entry(&database, input))
}

#[tauri::command]
pub fn pause_time_entry(
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.pause_entry(&database))
}

#[tauri::command]
pub fn resume_time_entry(
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.resume_entry(&database))
}

#[tauri::command]
pub fn stop_time_entry(
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    published(&app, timers.stop_entry(&database))
}

#[tauri::command]
pub fn get_pomodoro_settings(database: State<'_, Database>) -> Result<PomodoroSettings, String> {
    database.with_connection(load_settings)
}

pub fn store_settings(database: &Database, settings: &PomodoroSettings) -> Result<(), String> {
    validate_settings(settings)?;
    let value = serde_json::to_string(settings).map_err(|error| error.to_string())?;
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES ('pomodoro', ?1, unixepoch())
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            [value],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn update_pomodoro_settings(
    settings: PomodoroSettings,
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    store_settings(&database, &settings)?;
    published(&app, timers.snapshot(&database))
}

/// Semana local de lunes a domingo que contiene `wall`.
fn week_days(wall: i64) -> Vec<(i64, i64)> {
    let today = Local
        .timestamp_opt(wall, 0)
        .single()
        .map(|moment| moment.date_naive())
        .unwrap_or_else(|| Local::now().date_naive());
    let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    (0..7)
        .map(|offset| {
            let day = monday + Duration::days(offset);
            let start = day_start_of(day);
            let end = day_start_of(day + Duration::days(1));
            (start, end)
        })
        .collect()
}

fn day_start_of(day: chrono::NaiveDate) -> i64 {
    day.and_hms_opt(0, 0, 0)
        .and_then(|midnight| Local.from_local_datetime(&midnight).earliest())
        .map(|moment| moment.timestamp())
        .unwrap_or_default()
}

pub fn load_stats(database: &Database, wall: i64) -> Result<TimeStats, String> {
    let days = week_days(wall);
    let today = day_start(wall);
    let today_end = days
        .iter()
        .find(|(start, _)| *start == today)
        .map(|(_, end)| *end)
        .unwrap_or(today + 86_400);
    let (week_start, week_end) = (days[0].0, days[6].1);
    database.with_connection(|connection| {
        let sum = |sql: &str, start: i64, end: i64| -> rusqlite::Result<i64> {
            connection.query_row(sql, [start, end], |row| row.get(0))
        };
        const TRACKED: &str = "SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries
                               WHERE started_at >= ?1 AND started_at < ?2";
        const FOCUS: &str = "SELECT COALESCE(SUM(elapsed_seconds), 0) FROM pomodoro_sessions
                             WHERE session_type = 'focus' AND started_at >= ?1 AND started_at < ?2";
        let day_stats = days
            .iter()
            .map(|&(start, end)| {
                Ok(DayStat {
                    day_start: start,
                    tracked_seconds: sum(TRACKED, start, end)?,
                    focus_seconds: sum(FOCUS, start, end)?,
                })
            })
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let projects = connection
            .prepare(
                "SELECT e.project_id, p.name, p.color, SUM(e.duration_seconds) AS seconds
                 FROM time_entries e LEFT JOIN projects p ON p.id = e.project_id
                 WHERE e.started_at >= ?1 AND e.started_at < ?2
                 GROUP BY e.project_id HAVING seconds > 0 ORDER BY seconds DESC",
            )?
            .query_map([week_start, week_end], |row| {
                Ok(ProjectTime {
                    project_id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    seconds: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(TimeStats {
            week_start,
            today_tracked_seconds: sum(TRACKED, today, today_end)?,
            today_focus_seconds: sum(FOCUS, today, today_end)?,
            week_tracked_seconds: day_stats.iter().map(|day| day.tracked_seconds).sum(),
            week_focus_seconds: day_stats.iter().map(|day| day.focus_seconds).sum(),
            focus_sessions_today: connection.query_row(
                "SELECT COUNT(*) FROM pomodoro_sessions
                 WHERE session_type = 'focus' AND status = 'completed'
                 AND completed_at >= ?1 AND completed_at < ?2",
                [today, today_end],
                |row| row.get(0),
            )?,
            days: day_stats,
            projects,
        })
    })
}

#[tauri::command]
pub fn get_time_stats(database: State<'_, Database>) -> Result<TimeStats, String> {
    load_stats(&database, chrono::Utc::now().timestamp())
}

fn map_entry(connection: &Connection, row: &rusqlite::Row<'_>) -> rusqlite::Result<TimeEntry> {
    let task_id: Option<String> = row.get(7)?;
    let project_id: Option<String> = row.get(8)?;
    Ok(TimeEntry {
        id: row.get(0)?,
        source: row.get(1)?,
        status: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        duration_seconds: row.get(5)?,
        description: row.get(6)?,
        context: load_context(connection, task_id.as_deref(), project_id.as_deref())?,
    })
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryRange {
    Today,
    Week,
}

pub fn query_entries(
    database: &Database,
    range: EntryRange,
    wall: i64,
) -> Result<Vec<TimeEntry>, String> {
    let since = match range {
        EntryRange::Today => day_start(wall),
        EntryRange::Week => week_days(wall)[0].0,
    };
    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "SELECT id, source, status, started_at, ended_at, duration_seconds, description,
                    task_id, project_id
             FROM time_entries WHERE started_at >= ?1 ORDER BY started_at DESC LIMIT 500",
        )?;
        let mut rows = statement.query([since])?;
        let mut entries = Vec::new();
        while let Some(row) = rows.next()? {
            entries.push(map_entry(connection, row)?);
        }
        Ok(entries)
    })
}

#[tauri::command]
pub fn list_time_entries(
    range: EntryRange,
    database: State<'_, Database>,
) -> Result<Vec<TimeEntry>, String> {
    query_entries(&database, range, chrono::Utc::now().timestamp())
}

#[tauri::command]
pub fn list_focus_sessions(database: State<'_, Database>) -> Result<Vec<FocusSession>, String> {
    let since = day_start(chrono::Utc::now().timestamp());
    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "SELECT id, session_type, status, planned_seconds, elapsed_seconds, started_at,
                    completed_at, task_id, project_id
             FROM pomodoro_sessions WHERE started_at >= ?1 ORDER BY started_at DESC",
        )?;
        let mut rows = statement.query([since])?;
        let mut sessions = Vec::new();
        while let Some(row) = rows.next()? {
            let task_id: Option<String> = row.get(7)?;
            let project_id: Option<String> = row.get(8)?;
            sessions.push(FocusSession {
                id: row.get(0)?,
                session_type: row.get(1)?,
                status: row.get(2)?,
                planned_seconds: row.get(3)?,
                elapsed_seconds: row.get(4)?,
                started_at: row.get(5)?,
                completed_at: row.get(6)?,
                context: load_context(connection, task_id.as_deref(), project_id.as_deref())?,
            });
        }
        Ok(sessions)
    })
}

fn entry_task(connection: &Connection, entry_id: &str) -> rusqlite::Result<Option<Option<String>>> {
    connection
        .query_row(
            "SELECT task_id FROM time_entries WHERE id = ?1",
            [entry_id],
            |row| row.get(0),
        )
        .optional()
}

pub fn modify_entry(database: &Database, entry_id: &str, input: EntryInput) -> Result<(), String> {
    Uuid::parse_str(entry_id).map_err(|_| "Identificador de registro no válido".to_string())?;
    let description = input.description.trim().to_string();
    if description.chars().count() > 240 {
        return Err("La descripción no puede superar 240 caracteres".to_string());
    }
    let task_id = input.task_id.filter(|id| !id.is_empty());
    let mut project_id = input.project_id.filter(|id| !id.is_empty());
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        let Some(previous_task) = entry_task(&transaction, entry_id)? else {
            return Ok(Err("El registro no existe".to_string()));
        };
        if let Some(task_id) = &task_id {
            let task_project: Option<Option<String>> = transaction
                .query_row(
                    "SELECT project_id FROM tasks WHERE id = ?1",
                    [task_id],
                    |row| row.get(0),
                )
                .optional()?;
            match task_project {
                None => return Ok(Err("La tarea no existe".to_string())),
                Some(task_project) if project_id.is_none() => project_id = task_project,
                Some(_) => {}
            }
        }
        if let Some(project_id) = &project_id {
            let exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                [project_id],
                |row| row.get(0),
            )?;
            if !exists {
                return Ok(Err("El proyecto no existe".to_string()));
            }
        }
        transaction.execute(
            "UPDATE time_entries SET task_id = ?1, project_id = ?2, description = ?3,
                updated_at = unixepoch()
             WHERE id = ?4",
            params![task_id, project_id, description, entry_id],
        )?;
        refresh_task_time(&transaction, previous_task.as_deref())?;
        refresh_task_time(&transaction, task_id.as_deref())?;
        transaction.commit()?;
        Ok(Ok(()))
    })?
}

#[tauri::command]
pub fn update_time_entry(
    entry_id: String,
    input: EntryInput,
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    modify_entry(&database, &entry_id, input)?;
    published(&app, timers.snapshot(&database))
}

pub fn remove_entry(database: &Database, entry_id: &str) -> Result<(), String> {
    Uuid::parse_str(entry_id).map_err(|_| "Identificador de registro no válido".to_string())?;
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        let Some(task_id) = entry_task(&transaction, entry_id)? else {
            return Ok(Err("El registro no existe".to_string()));
        };
        transaction.execute("DELETE FROM time_entries WHERE id = ?1", [entry_id])?;
        refresh_task_time(&transaction, task_id.as_deref())?;
        transaction.commit()?;
        Ok(Ok(()))
    })?
}

#[tauri::command]
pub fn delete_time_entry(
    entry_id: String,
    timers: State<'_, TimerService>,
    database: State<'_, Database>,
    app: AppHandle,
) -> TimerResult {
    remove_entry(&database, &entry_id)?;
    timers.forget(&entry_id);
    published(&app, timers.snapshot(&database))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_entry(database: &Database, started_at: i64, seconds: i64, project: Option<&str>) {
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO time_entries(id, project_id, source, status, started_at, ended_at,
                        duration_seconds)
                     VALUES (?1, ?2, 'manual', 'completed', ?3, ?4, ?5)",
                    params![
                        Uuid::new_v4().to_string(),
                        project,
                        started_at,
                        started_at + seconds,
                        seconds
                    ],
                )
            })
            .expect("entry");
    }

    #[test]
    fn stats_group_time_by_day_and_project() {
        let database = Database::in_memory();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO projects(id, name, color) VALUES ('p1', 'Tesis', '#6C8CFF')",
                    [],
                )
            })
            .expect("project");
        let now = chrono::Utc::now().timestamp();
        let today = day_start(now);
        insert_entry(&database, today + 3_600, 1_800, Some("p1"));
        insert_entry(&database, today + 7_200, 600, None);
        insert_entry(&database, today - 40 * 86_400, 9_999, Some("p1"));

        let stats = load_stats(&database, now).expect("stats");
        assert_eq!(stats.days.len(), 7);
        assert_eq!(stats.today_tracked_seconds, 2_400);
        assert_eq!(stats.week_tracked_seconds, 2_400);
        assert_eq!(stats.projects[0].name.as_deref(), Some("Tesis"));
        assert_eq!(stats.projects[0].seconds, 1_800);
        assert_eq!(stats.projects[1].project_id, None);
        let today_stat = stats
            .days
            .iter()
            .find(|day| day.day_start == today)
            .expect("today");
        assert_eq!(today_stat.tracked_seconds, 2_400);
    }

    #[test]
    fn editing_and_deleting_entries_keeps_task_time_consistent() {
        let database = Database::in_memory();
        database
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO tasks(id, title) VALUES ('t1', 'A'), ('t2', 'B');
                     INSERT INTO time_entries(id, task_id, source, status, started_at,
                        duration_seconds)
                     VALUES ('8d8f1e2a-0000-4000-8000-000000000001', 't1', 'manual', 'completed',
                        1, 300);
                     UPDATE tasks SET tracked_seconds = 300 WHERE id = 't1';",
                )
            })
            .expect("seed");
        let id = "8d8f1e2a-0000-4000-8000-000000000001";
        modify_entry(
            &database,
            id,
            EntryInput {
                task_id: Some("t2".to_string()),
                ..EntryInput::default()
            },
        )
        .expect("reassign");
        let tracked = |task: &str| -> i64 {
            database
                .with_connection(|connection| {
                    connection.query_row(
                        "SELECT tracked_seconds FROM tasks WHERE id = ?1",
                        [task],
                        |row| row.get(0),
                    )
                })
                .expect("tracked")
        };
        assert_eq!((tracked("t1"), tracked("t2")), (0, 300));
        remove_entry(&database, id).expect("delete");
        assert_eq!(tracked("t2"), 0);
    }

    #[test]
    fn rejects_invalid_settings() {
        let database = Database::in_memory();
        let mut settings = PomodoroSettings {
            focus_minutes: 0,
            ..PomodoroSettings::default()
        };
        assert!(store_settings(&database, &settings).is_err());
        settings.focus_minutes = 45;
        store_settings(&database, &settings).expect("valid");
        let stored = database.with_connection(load_settings).expect("load");
        assert_eq!(stored.focus_minutes, 45);
    }
}
