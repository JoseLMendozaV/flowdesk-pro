use rusqlite::{Connection, TransactionBehavior, params};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_initial.sql")),
    (2, include_str!("../../migrations/0002_note_windows.sql")),
    (3, include_str!("../../migrations/0003_tasks_projects.sql")),
    (4, include_str!("../../migrations/0004_focus_time.sql")),
    (
        5,
        include_str!("../../migrations/0005_calendar_reminders.sql"),
    ),
    (6, include_str!("../../migrations/0006_workspaces.sql")),
    (7, include_str!("../../migrations/0007_clipboard.sql")),
    (8, include_str!("../../migrations/0008_app_tracking.sql")),
    (9, include_str!("../../migrations/0009_onboarding.sql")),
];

#[cfg(test)]
pub fn migrations() -> &'static [(i64, &'static str)] {
    MIGRATIONS
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn initialize(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&app_data_dir)?;
        let database_path = app_data_dir.join("flowdesk.sqlite3");
        let mut connection = Connection::open(database_path)?;

        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS schema_migrations (
                 version INTEGER PRIMARY KEY NOT NULL,
                 applied_at INTEGER NOT NULL DEFAULT (unixepoch())
             );",
        )?;

        for (version, sql) in MIGRATIONS {
            let already_applied = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                [version],
                |row| row.get::<_, bool>(0),
            )?;

            if !already_applied {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                transaction.execute_batch(sql)?;
                transaction.execute(
                    "INSERT INTO schema_migrations(version) VALUES (?1)",
                    params![version],
                )?;
                transaction.commit()?;
            }
        }

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "La base de datos no está disponible".to_string())?;
        operation(&connection).map_err(|error| error.to_string())
    }

    pub fn with_connection_mut<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "La base de datos no está disponible".to_string())?;
        operation(&mut connection).map_err(|error| error.to_string())
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        let mut connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY NOT NULL,
                    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
                 );",
            )
            .expect("migration table");
        for (version, sql) in MIGRATIONS {
            let transaction = connection.transaction().expect("migration transaction");
            transaction.execute_batch(sql).expect("migration SQL");
            transaction
                .execute(
                    "INSERT INTO schema_migrations(version) VALUES (?1)",
                    params![version],
                )
                .expect("migration record");
            transaction.commit().expect("migration commit");
        }
        Self {
            connection: Mutex::new(connection),
        }
    }

    #[allow(dead_code)]
    pub fn path(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
        Ok(app.path().app_data_dir()?.join("flowdesk.sqlite3"))
    }
}

#[cfg(test)]
mod tests {
    use super::Database;

    #[test]
    fn migration_creates_all_required_tables() {
        let database = Database::in_memory();
        let table_count = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table'
                     AND name IN (
                        'settings', 'projects', 'tasks', 'subtasks', 'tags', 'task_tags',
                        'notes', 'note_windows', 'workspaces', 'workspace_projects',
                        'workspace_notes', 'pomodoro_sessions', 'time_entries',
                        'clipboard_items', 'calendar_events', 'reminders', 'app_tracking',
                        'notification_history', 'ai_settings', 'tray_preferences',
                        'widget_preferences', 'widget_sync_state'
                     )",
                    [],
                    |row| row.get::<_, i64>(0),
                )
            })
            .expect("table count");
        assert_eq!(table_count, 22);
    }

    #[test]
    fn migration_three_removes_orphaned_note_windows() {
        let mut connection = rusqlite::Connection::open_in_memory().expect("database");
        for (_, sql) in &super::MIGRATIONS[..2] {
            connection.execute_batch(sql).expect("previous migrations");
        }
        connection
            .execute_batch(
                "PRAGMA foreign_keys = OFF;
                 INSERT INTO note_windows(note_id) VALUES ('missing-note');
                 PRAGMA foreign_keys = ON;",
            )
            .expect("orphan row");
        let transaction = connection.transaction().expect("transaction");
        transaction
            .execute_batch(super::MIGRATIONS[2].1)
            .expect("migration 3");
        transaction.commit().expect("commit");
        let violations = connection
            .prepare("PRAGMA foreign_key_check")
            .expect("check")
            .query_map([], |_| Ok(()))
            .expect("rows")
            .count();
        assert_eq!(violations, 0);
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let database = Database::in_memory();
        let result = database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO tasks(id, title, project_id) VALUES ('task', 'Prueba', 'missing')",
                [],
            )
        });
        assert!(result.is_err());
    }
}
