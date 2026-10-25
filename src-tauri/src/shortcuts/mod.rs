use crate::{background, commands::notes, models::ShortcutStatus, windows};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

type Action = fn(&AppHandle);

/// Atajos iniciales de la sección 17. Si otra app ya usa uno, se informa en Configuración.
const SHORTCUTS: &[(&str, &str, &str, &str, Action)] = &[
    ("new-note", "Nueva nota", "Alt+N", "⌥N", new_note),
    ("new-task", "Nueva tarea", "Alt+Shift+T", "⌥⇧T", new_task),
    ("open", "Abrir FlowDesk", "Alt+Shift+F", "⌥⇧F", open),
    (
        "pomodoro",
        "Iniciar o pausar Pomodoro",
        "Alt+Shift+P",
        "⌥⇧P",
        background::toggle_pomodoro,
    ),
];

fn new_note(app: &AppHandle) {
    let _ = notes::create_note_and_window(app);
}

fn new_task(app: &AppHandle) {
    windows::hide_tray_panel(app);
    windows::show_main_window(app);
    let _ = app.emit_to("main", "flowdesk://quick-action", "new-task");
}

fn open(app: &AppHandle) {
    windows::hide_tray_panel(app);
    windows::show_main_window(app);
    let _ = app.emit_to("main", "flowdesk://activated", ());
}

pub fn register(app: &AppHandle) -> Vec<ShortcutStatus> {
    SHORTCUTS
        .iter()
        .map(|&(id, label, accelerator, keys, action)| {
            let result =
                app.global_shortcut()
                    .on_shortcut(accelerator, move |app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            action(app);
                        }
                    });
            ShortcutStatus {
                id: id.to_string(),
                label: label.to_string(),
                keys: keys.to_string(),
                registered: result.is_ok(),
                error: result.err().map(|error| error.to_string()),
            }
        })
        .collect()
}

#[tauri::command]
pub fn get_shortcut_status(status: tauri::State<'_, Vec<ShortcutStatus>>) -> Vec<ShortcutStatus> {
    status.inner().clone()
}
