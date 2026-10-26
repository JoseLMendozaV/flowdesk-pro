use crate::{background::reminders::ReminderService, database::Database, models::TrayPreferences};
use rusqlite::params;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

pub fn stored_launch_hidden(database: &Database) -> Result<bool, String> {
    database.with_connection(|connection| {
        connection.query_row(
            "SELECT launch_hidden FROM tray_preferences WHERE id = 1",
            [],
            |row| row.get(0),
        )
    })
}

const NEXT_EVENT_MINUTES: &[i64] = &[0, 10, 15, 30, 60, 120];

fn stored_next_event_minutes(database: &Database) -> Result<i64, String> {
    database.with_connection(|connection| {
        connection.query_row(
            "SELECT next_event_minutes FROM tray_preferences WHERE id = 1",
            [],
            |row| row.get(0),
        )
    })
}

fn store_preferences(
    database: &Database,
    launch_at_login: bool,
    launch_hidden: bool,
    next_event_minutes: i64,
) -> Result<(), String> {
    if !NEXT_EVENT_MINUTES.contains(&next_event_minutes) {
        return Err("Antelación del próximo evento no válida".to_string());
    }
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE tray_preferences
             SET launch_at_login = ?1, launch_hidden = ?2, next_event_minutes = ?3,
                 updated_at = unixepoch()
             WHERE id = 1",
            params![launch_at_login, launch_hidden, next_event_minutes],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_tray_preferences(
    app: AppHandle,
    database: State<'_, Database>,
) -> Result<TrayPreferences, String> {
    let launch_at_login = app
        .autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())?;
    let launch_hidden = stored_launch_hidden(&database)?;
    Ok(TrayPreferences {
        launch_at_login,
        launch_hidden,
        next_event_minutes: stored_next_event_minutes(&database)?,
    })
}

#[tauri::command]
pub fn update_tray_preferences(
    app: AppHandle,
    database: State<'_, Database>,
    reminders: State<'_, ReminderService>,
    launch_at_login: bool,
    launch_hidden: bool,
    next_event_minutes: i64,
) -> Result<TrayPreferences, String> {
    let manager = app.autolaunch();
    if launch_at_login {
        manager.enable().map_err(|error| error.to_string())?;
    } else {
        manager.disable().map_err(|error| error.to_string())?;
    }

    if let Err(error) = store_preferences(
        &database,
        launch_at_login,
        launch_hidden,
        next_event_minutes,
    ) {
        if launch_at_login {
            let _ = manager.disable();
        }
        return Err(error);
    }
    // El servicio de recordatorios es quien actualiza el próximo evento junto al icono.
    reminders.wakeup.wake();

    Ok(TrayPreferences {
        launch_at_login,
        launch_hidden,
        next_event_minutes,
    })
}

#[cfg(test)]
mod tests {
    use super::{store_preferences, stored_launch_hidden, stored_next_event_minutes};
    use crate::database::Database;

    #[test]
    fn stores_launch_and_next_event_preferences() {
        let database = Database::in_memory();
        assert_eq!(stored_next_event_minutes(&database).expect("default"), 30);
        store_preferences(&database, true, true, 15).expect("stored preferences");
        assert!(stored_launch_hidden(&database).expect("launch hidden"));
        assert_eq!(stored_next_event_minutes(&database).expect("minutes"), 15);
        assert!(store_preferences(&database, true, true, 7).is_err());
    }
}
