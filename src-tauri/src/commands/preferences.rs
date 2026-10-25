use crate::{database::Database, models::TrayPreferences};
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

fn store_preferences(
    database: &Database,
    launch_at_login: bool,
    launch_hidden: bool,
) -> Result<(), String> {
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE tray_preferences
             SET launch_at_login = ?1, launch_hidden = ?2, updated_at = unixepoch()
             WHERE id = 1",
            params![launch_at_login, launch_hidden],
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
    })
}

#[tauri::command]
pub fn update_tray_preferences(
    app: AppHandle,
    database: State<'_, Database>,
    launch_at_login: bool,
    launch_hidden: bool,
) -> Result<TrayPreferences, String> {
    let manager = app.autolaunch();
    if launch_at_login {
        manager.enable().map_err(|error| error.to_string())?;
    } else {
        manager.disable().map_err(|error| error.to_string())?;
    }

    if let Err(error) = store_preferences(&database, launch_at_login, launch_hidden) {
        if launch_at_login {
            let _ = manager.disable();
        }
        return Err(error);
    }

    Ok(TrayPreferences {
        launch_at_login,
        launch_hidden,
    })
}

#[cfg(test)]
mod tests {
    use super::{store_preferences, stored_launch_hidden};
    use crate::database::Database;

    #[test]
    fn stores_launch_hidden_preference() {
        let database = Database::in_memory();
        store_preferences(&database, true, true).expect("stored preferences");
        assert!(stored_launch_hidden(&database).expect("launch hidden"));
    }
}
