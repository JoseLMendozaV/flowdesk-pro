use crate::{
    background::app_tracking::{self, AppTrackingService, load_settings, validate_settings},
    database::Database,
    models::{AppTrackingSettings, AppUsageReport},
};
use chrono::Utc;
use tauri::{AppHandle, Emitter, State};

fn notify(app: &AppHandle) {
    let _ = app.emit("flowdesk://data-changed", "app-usage");
}

pub fn store_settings(database: &Database, settings: &AppTrackingSettings) -> Result<(), String> {
    validate_settings(settings)?;
    let value = serde_json::to_string(settings).map_err(|error| error.to_string())?;
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES ('app_tracking', ?1, unixepoch())
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            [value],
        )?;
        Ok(())
    })
}

fn apply(
    database: &Database,
    service: &AppTrackingService,
    settings: AppTrackingSettings,
) -> Result<AppTrackingSettings, String> {
    store_settings(database, &settings)?;
    // Al pausar, desactivar o excluir la app actual, el tramo en curso se cierra ya.
    service.finish(database);
    service.wakeup.wake();
    Ok(settings)
}

#[tauri::command]
pub fn get_app_tracking_settings(
    database: State<'_, Database>,
) -> Result<AppTrackingSettings, String> {
    database.with_connection(load_settings)
}

#[tauri::command]
pub fn update_app_tracking_settings(
    settings: AppTrackingSettings,
    database: State<'_, Database>,
    service: State<'_, AppTrackingService>,
    app: AppHandle,
) -> Result<AppTrackingSettings, String> {
    let settings = apply(&database, &service, settings)?;
    notify(&app);
    Ok(settings)
}

#[tauri::command]
pub fn get_app_usage(
    database: State<'_, Database>,
    service: State<'_, AppTrackingService>,
) -> Result<AppUsageReport, String> {
    let tracker = service
        .tracker
        .lock()
        .map_err(|_| "El seguimiento no está disponible".to_string())?;
    app_tracking::report(&database, &tracker, Utc::now().timestamp())
}

#[tauri::command]
pub fn exclude_tracking_app(
    path: String,
    database: State<'_, Database>,
    service: State<'_, AppTrackingService>,
    app: AppHandle,
) -> Result<AppTrackingSettings, String> {
    #[cfg(target_os = "macos")]
    let info = crate::background::macos::bundle_info(&path)
        .ok_or_else(|| "No es una aplicación válida".to_string())?;
    #[cfg(not(target_os = "macos"))]
    let info: crate::models::ExcludedApp = {
        let _ = &path;
        return Err("Solo disponible en macOS".to_string());
    };
    let mut settings = database.with_connection(load_settings)?;
    if !settings
        .excluded_apps
        .iter()
        .any(|excluded| excluded.bundle_id == info.bundle_id)
    {
        settings.excluded_apps.push(info);
    }
    let settings = apply(&database, &service, settings)?;
    notify(&app);
    Ok(settings)
}

#[tauri::command]
pub fn clear_app_tracking(
    database: State<'_, Database>,
    service: State<'_, AppTrackingService>,
    app: AppHandle,
) -> Result<(), String> {
    service.finish(&database);
    app_tracking::clear(&database)?;
    notify(&app);
    Ok(())
}
