use crate::windows;
use tauri::{AppHandle, Emitter};

const VALID_SECTIONS: &[&str] = &[
    "dashboard",
    "tasks",
    "projects",
    "notes",
    "focus",
    "time",
    "calendar",
    "settings",
];

#[tauri::command]
pub fn open_main_window(app: AppHandle, section: Option<String>) -> Result<(), String> {
    if let Some(section) = section.as_deref()
        && !VALID_SECTIONS.contains(&section)
    {
        return Err("Sección no válida".to_string());
    }
    windows::hide_tray_panel(&app);
    windows::show_main_window(&app);
    let _ = app.emit_to("main", "flowdesk://activated", ());
    if let Some(section) = section {
        let _ = app.emit_to("main", "flowdesk://navigate", section);
    }
    Ok(())
}

#[tauri::command]
pub fn hide_tray_panel(app: AppHandle) {
    windows::hide_tray_panel(&app);
}

/// Antes de reiniciar tras instalar una actualización: el reinicio no garantiza
/// pasar por los eventos de salida, así que se guarda el estado aquí.
#[tauri::command]
pub fn prepare_restart(app: AppHandle) {
    crate::prepare_exit(&app);
}

#[tauri::command]
pub fn quit_flowdesk(app: AppHandle) {
    app.exit(0);
}
