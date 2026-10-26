use crate::{background, commands::notes, menu as app_menu, models::TimerSnapshot, windows};
use std::sync::Mutex;
use tauri::{
    App, AppHandle, Emitter,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const TRAY_ID: &str = "flowdesk-tray";
/// Último título aplicado, para no tocar la barra de menú si no cambia.
static LAST_TITLE: Mutex<Option<String>> = Mutex::new(None);

fn session_label(session_type: &str) -> &'static str {
    match session_type {
        "short_break" => "Descanso corto",
        "long_break" => "Descanso largo",
        _ => "Enfoque",
    }
}

/// Texto discreto junto al icono: minutos restantes del Pomodoro o tiempo del cronómetro.
fn timer_title(snapshot: &TimerSnapshot) -> (Option<String>, String) {
    if let Some(pomodoro) = &snapshot.pomodoro {
        let minutes = (pomodoro.remaining_seconds + 59) / 60;
        let label = session_label(&pomodoro.session_type);
        return if pomodoro.status == "running" {
            (
                Some(format!("{minutes}m")),
                format!("FlowDesk Pro — {label}: {minutes} min restantes"),
            )
        } else {
            (
                Some(format!("‖ {minutes}m")),
                format!("FlowDesk Pro — {label} en pausa"),
            )
        };
    }
    if let Some(entry) = &snapshot.entry {
        let minutes = entry.elapsed_seconds / 60;
        let text = format!("{}:{:02}", minutes / 60, minutes % 60);
        return if entry.status == "running" {
            (
                Some(text),
                "FlowDesk Pro — Cronómetro en marcha".to_string(),
            )
        } else {
            (
                Some(format!("‖ {text}")),
                "FlowDesk Pro — Cronómetro en pausa".to_string(),
            )
        };
    }
    (None, "FlowDesk Pro".to_string())
}

pub fn show_timer(app: &AppHandle, snapshot: &TimerSnapshot) {
    let (title, tooltip) = timer_title(snapshot);
    let Ok(mut last) = LAST_TITLE.lock() else {
        return;
    };
    let key = format!("{title:?}{tooltip}");
    if last.as_deref() == Some(key.as_str()) {
        return;
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(title.as_deref());
        let _ = tray.set_tooltip(Some(tooltip));
        *last = Some(key);
    }
}

pub fn create(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir FlowDesk", true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, "new-task", "Nueva tarea", true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, "new-note", "Nueva nota flotante", true, None::<&str>)?;
    let pomodoro = MenuItem::with_id(
        app,
        "pomodoro",
        "Iniciar o pausar Pomodoro",
        true,
        None::<&str>,
    )?;
    // Las acciones de Ayuda las atiende `menu::handle_event`, común con la barra de menús.
    let help = Submenu::with_items(
        app,
        "Ayuda",
        true,
        &[
            &MenuItem::with_id(
                app,
                app_menu::TOUR_ID,
                "Recorrido por FlowDesk",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                app_menu::WHATS_NEW_ID,
                "¿Qué hay de nuevo?",
                true,
                None::<&str>,
            )?,
        ],
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let help_separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Salir de FlowDesk", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &new_task,
            &new_note,
            &pomodoro,
            &separator,
            &help,
            &help_separator,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("FlowDesk Pro")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                windows::hide_tray_panel(app);
                windows::show_main_window(app);
            }
            "new-task" => {
                windows::hide_tray_panel(app);
                windows::show_main_window(app);
                let _ = app.emit_to("main", "flowdesk://quick-action", "new-task");
            }
            "new-note" => {
                windows::hide_tray_panel(app);
                let _ = notes::create_note_and_window(app);
            }
            "pomodoro" => background::toggle_pomodoro(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::toggle_tray_panel(tray.app_handle());
            }
        });

    // Silueta de la «F» como plantilla: macOS la tiñe según el aspecto de la barra de menús.
    builder = builder
        .icon(Image::from_bytes(include_bytes!(
            "../../icons/tray-template.png"
        ))?)
        .icon_as_template(true);
    builder.build(app)?;
    Ok(())
}
