use crate::{database::Database, models::Note};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

const COLLAPSED_HEIGHT: f64 = 72.0;
const MIN_WIDTH: f64 = 240.0;
const MIN_EXPANDED_HEIGHT: f64 = 120.0;
/// Pausa tras el último movimiento antes de guardar la geometría.
const GEOMETRY_QUIET: Duration = Duration::from_millis(300);

pub fn label(note_id: &str) -> String {
    format!("note-{note_id}")
}

pub fn apply_display_mode<R: Runtime>(window: &WebviewWindow<R>, mode: &str) {
    // Ambas llamadas fijan el mismo nivel de ventana: la que activa el modo va al final.
    let floating = mode == "always_on_top";
    if floating {
        let _ = window.set_always_on_bottom(false);
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_bottom(mode == "desktop");
    }
    super::join_all_spaces(window, floating);
}

fn min_height(collapsed: bool) -> f64 {
    if collapsed {
        COLLAPSED_HEIGHT
    } else {
        MIN_EXPANDED_HEIGHT
    }
}

pub fn persist_geometry<R: Runtime>(
    app: &AppHandle<R>,
    note_id: &str,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    app.state::<Database>().with_connection(|connection| {
        connection.execute(
            "UPDATE note_windows SET
                x = ?1,
                y = ?2,
                width = CASE WHEN is_collapsed = 0 THEN MAX(?3, 180) ELSE width END,
                height = CASE WHEN is_collapsed = 0 THEN MAX(?4, 120) ELSE height END,
                expanded_height = CASE WHEN is_collapsed = 0 THEN MAX(?4, 120) ELSE expanded_height END,
                updated_at = unixepoch()
             WHERE note_id = ?5",
            rusqlite::params![position.x, position.y, size.width, size.height, note_id],
        )?;
        Ok(())
    })
}

pub fn open<R: Runtime>(app: &AppHandle<R>, note: &Note) -> Result<(), String> {
    let window_label = label(&note.id);
    if let Some(window) = app.get_webview_window(&window_label) {
        apply_display_mode(&window, &note.window.display_mode);
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let url = WebviewUrl::App(
        format!("index.html?view=note&id={}", note.id)
            .parse()
            .map_err(|error| format!("URL de nota no válida: {error}"))?,
    );
    let height = if note.window.is_collapsed {
        COLLAPSED_HEIGHT
    } else {
        note.window.height
    };
    let mut builder = WebviewWindowBuilder::new(app, &window_label, url)
        .title(if note.title.is_empty() {
            "Nota — FlowDesk Pro"
        } else {
            &note.title
        })
        .inner_size(note.window.width, height)
        .min_inner_size(MIN_WIDTH, min_height(note.window.is_collapsed))
        .resizable(true)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(note.window.display_mode == "always_on_top")
        .always_on_bottom(note.window.display_mode == "desktop")
        .visible_on_all_workspaces(note.window.display_mode == "always_on_top")
        .accept_first_mouse(true)
        .skip_taskbar(true);
    if let (Some(x), Some(y)) = (note.window.x, note.window.y) {
        builder = builder.position(x, y);
    } else {
        builder = builder.center();
    }
    let window =
        super::build_floating(app, || builder.build()).map_err(|error| error.to_string())?;

    let tracked_window = window.clone();
    let tracked_app = app.clone();
    let tracked_id = note.id.clone();
    let last_change = Arc::new(Mutex::new(Instant::now()));
    let save_scheduled = Arc::new(AtomicBool::new(false));
    window.on_window_event(move |event| match event {
        // Guardado diferido: una sola escritura cuando el movimiento termina. No depende
        // de la salida de la app, que con ⌘Q no pasa por `ExitRequested` en macOS.
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if let Ok(mut changed_at) = last_change.lock() {
                *changed_at = Instant::now();
            }
            if save_scheduled.swap(true, Ordering::AcqRel) {
                return;
            }
            let (app, note_id, window) = (
                tracked_app.clone(),
                tracked_id.clone(),
                tracked_window.clone(),
            );
            let (last_change, save_scheduled) = (last_change.clone(), save_scheduled.clone());
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(GEOMETRY_QUIET);
                    let quiet = last_change
                        .lock()
                        .map(|changed_at| changed_at.elapsed() >= GEOMETRY_QUIET)
                        .unwrap_or(true);
                    if quiet {
                        break;
                    }
                }
                save_scheduled.store(false, Ordering::Release);
                let _ = persist_geometry(&app, &note_id, &window);
            });
        }
        WindowEvent::Focused(false) => {
            let _ = persist_geometry(&tracked_app, &tracked_id, &tracked_window);
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = persist_geometry(&tracked_app, &tracked_id, &tracked_window);
            let _ = tracked_app
                .state::<Database>()
                .with_connection(|connection| {
                    connection.execute(
                        "UPDATE note_windows SET is_visible = 0, updated_at = unixepoch()
                             WHERE note_id = ?1",
                        [&tracked_id],
                    )?;
                    Ok(())
                });
            let _ = tracked_window.hide();
        }
        _ => {}
    });
    apply_display_mode(&window, &note.window.display_mode);
    Ok(())
}

pub fn set_collapsed<R: Runtime>(
    app: &AppHandle<R>,
    note_id: &str,
    collapsed: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&label(note_id))
        .ok_or_else(|| "La ventana de nota no está abierta".to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let current = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let database = app.state::<Database>();
    let expanded_height = database.with_connection(|connection| {
        if collapsed {
            // Si ya estaba colapsada se conserva la altura expandida previa.
            connection.execute(
                "UPDATE note_windows SET is_collapsed = 1, width = MAX(?1, 180),
                    height = CASE WHEN is_collapsed = 0 THEN MAX(?2, 120) ELSE height END,
                    expanded_height = CASE WHEN is_collapsed = 0 THEN MAX(?2, 120)
                        ELSE expanded_height END,
                    updated_at = unixepoch()
                 WHERE note_id = ?3",
                rusqlite::params![current.width, current.height, note_id],
            )?;
            Ok(0.0)
        } else {
            let height = connection.query_row(
                "SELECT expanded_height FROM note_windows WHERE note_id = ?1",
                [note_id],
                |row| row.get::<_, f64>(0),
            )?;
            connection.execute(
                "UPDATE note_windows SET is_collapsed = 0, updated_at = unixepoch()
                 WHERE note_id = ?1",
                [note_id],
            )?;
            Ok(height)
        }
    })?;
    let target_height = if collapsed {
        COLLAPSED_HEIGHT
    } else {
        expanded_height
    };
    let _ = window.set_min_size(Some(LogicalSize::new(MIN_WIDTH, min_height(collapsed))));
    window
        .set_size(LogicalSize::new(current.width, target_height))
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn persist_all<R: Runtime>(app: &AppHandle<R>) {
    for (window_label, window) in app.webview_windows() {
        if let Some(note_id) = window_label.strip_prefix("note-") {
            let _ = persist_geometry(app, note_id, &window);
        }
    }
}
