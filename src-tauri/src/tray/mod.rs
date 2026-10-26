use crate::{
    background,
    commands::{calendar::next_meeting, notes, workspaces::active_workspace},
    database::Database,
    menu as app_menu,
    models::{CalendarEvent, TimerSnapshot},
    windows,
};
use chrono::{Local, TimeZone};
use std::{sync::Mutex, time::Duration};
use tauri::{
    App, AppHandle, Emitter,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const TRAY_ID: &str = "flowdesk-tray";
/// Caracteres del título de un evento junto al icono; el resto se abrevia.
const MEETING_TITLE_CHARS: usize = 18;

/// Lo que se muestra junto al icono. El temporizador tiene prioridad sobre el próximo evento,
/// que entonces solo aparece en la descripción emergente.
#[derive(Default)]
struct TrayText {
    timer: Option<(Option<String>, String)>,
    meeting: Option<(String, String)>,
    /// Último título y descripción aplicados, para no tocar la barra de menú si no cambian.
    applied: Option<String>,
}

static TRAY_TEXT: Mutex<TrayText> = Mutex::new(TrayText {
    timer: None,
    meeting: None,
    applied: None,
});

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
    if let Ok(mut text) = TRAY_TEXT.lock() {
        text.timer = Some(timer_title(snapshot));
        apply(app, &mut text);
    }
}

fn apply(app: &AppHandle, text: &mut TrayText) {
    let (timer_title, timer_tooltip) = text
        .timer
        .clone()
        .unwrap_or((None, "FlowDesk Pro".to_string()));
    let (title, tooltip) = match (&timer_title, &text.meeting) {
        (None, Some((meeting, detail))) => {
            (Some(meeting.clone()), format!("FlowDesk Pro — {detail}"))
        }
        (Some(_), Some((_, detail))) => (timer_title.clone(), format!("{timer_tooltip}\n{detail}")),
        _ => (timer_title.clone(), timer_tooltip),
    };
    let key = format!("{title:?}{tooltip}");
    if text.applied.as_deref() == Some(key.as_str()) {
        return;
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(title.as_deref());
        let _ = tray.set_tooltip(Some(tooltip));
        text.applied = Some(key);
    }
}

fn clock_time(timestamp: i64) -> String {
    Local
        .timestamp_opt(timestamp, 0)
        .single()
        .map(|moment| moment.format("%H:%M").to_string())
        .unwrap_or_default()
}

fn short_title(title: &str) -> String {
    let title = title.trim();
    if title.chars().count() <= MEETING_TITLE_CHARS {
        return title.to_string();
    }
    let cut: String = title.chars().take(MEETING_TITLE_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

/// «Tutoría en 12 min», «Tutoría en 1 h 5 min» o «Tutoría · ahora», y el detalle para
/// la descripción emergente.
pub fn meeting_text(event: &CalendarEvent, now: i64) -> (String, String) {
    let title = short_title(&event.title);
    let label = if event.starts_at <= now {
        format!("{title} · ahora")
    } else {
        let minutes = (event.starts_at - now + 59) / 60;
        match (minutes / 60, minutes % 60) {
            (0, minutes) => format!("{title} en {minutes} min"),
            (hours, 0) => format!("{title} en {hours} h"),
            (hours, minutes) => format!("{title} en {hours} h {minutes} min"),
        }
    };
    let mut detail = format!(
        "{}: {} a las {}",
        if event.starts_at <= now {
            "Ahora"
        } else {
            "Próximo"
        },
        event.title.trim(),
        clock_time(event.starts_at)
    );
    if let Some(location) = &event.location {
        detail.push_str(&format!(" · {location}"));
    }
    (label, detail)
}

/// Actualiza el próximo evento junto al icono. Devuelve cuánto esperar para que el texto
/// cambie de minuto, si hay alguno a la vista.
pub fn refresh_meeting(app: &AppHandle, database: &Database, now: i64) -> Option<Duration> {
    let meeting = database
        .with_connection(|connection| {
            let lead: i64 = connection.query_row(
                "SELECT next_event_minutes FROM tray_preferences WHERE id = 1",
                [],
                |row| row.get(0),
            )?;
            next_meeting(connection, &active_workspace(connection)?, now, lead)
        })
        .ok()
        .flatten();
    let wait = meeting.as_ref().map(|event| {
        let seconds = (event.starts_at - now).rem_euclid(60);
        Duration::from_secs(if seconds == 0 { 60 } else { seconds as u64 + 1 })
    });
    if let Ok(mut text) = TRAY_TEXT.lock() {
        text.meeting = meeting.map(|event| meeting_text(&event, now));
        apply(app, &mut text);
    }
    wait
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

#[cfg(test)]
mod tests {
    use super::meeting_text;
    use crate::models::CalendarEvent;

    fn event(title: &str, starts_at: i64) -> CalendarEvent {
        CalendarEvent {
            id: "e".to_string(),
            title: title.to_string(),
            description: String::new(),
            project_id: None,
            project_name: None,
            project_color: None,
            starts_at,
            ends_at: starts_at + 3_600,
            is_all_day: false,
            location: Some("Aula 3".to_string()),
            reminder_minutes: None,
            recurrence: None,
            series_starts_at: starts_at,
        }
    }

    #[test]
    fn describes_the_next_meeting_briefly() {
        let now = 1_800_000_000;
        assert_eq!(
            meeting_text(&event("Tutoría", now + 690), now).0,
            "Tutoría en 12 min"
        );
        assert_eq!(
            meeting_text(&event("Tutoría", now + 30), now).0,
            "Tutoría en 1 min"
        );
        assert_eq!(
            meeting_text(&event("Tutoría", now + 3_600), now).0,
            "Tutoría en 1 h"
        );
        assert_eq!(
            meeting_text(&event("Tutoría", now + 3_900), now).0,
            "Tutoría en 1 h 5 min"
        );
        assert_eq!(
            meeting_text(&event("Tutoría", now - 60), now).0,
            "Tutoría · ahora"
        );
        let (label, detail) =
            meeting_text(&event("Reunión de seguimiento trimestral", now + 600), now);
        assert_eq!(label, "Reunión de seguim… en 10 min");
        assert!(detail.starts_with("Próximo: Reunión de seguimiento trimestral a las "));
        assert!(detail.ends_with(" · Aula 3"));
    }
}
