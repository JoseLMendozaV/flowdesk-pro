mod background;
mod commands;
mod database;
mod models;
mod shortcuts;
mod tray;
mod windows;

use background::{TimerService, clock::SystemClock};
use database::Database;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const MAIN_WINDOW_STATE: StateFlags = StateFlags::from_bits_truncate(
    StateFlags::SIZE.bits() | StateFlags::POSITION.bits() | StateFlags::MAXIMIZED.bits(),
);

/// Salida completa: guarda el tiempo exacto de los temporizadores y la geometría de las notas.
/// Se llama tanto en `ExitRequested` como en `Exit`, porque ⌘Q no pasa por el primero.
pub(crate) fn prepare_exit(app: &AppHandle) {
    if let (Some(timers), Some(database)) =
        (app.try_state::<TimerService>(), app.try_state::<Database>())
    {
        let _ = timers.suspend_all(&database);
    }
    windows::notes::persist_all(app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_main_window(app);
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(MAIN_WINDOW_STATE)
                // Las notas guardan su geometría en SQLite y el panel se ancla al tray.
                .with_filter(|label| label == "main")
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--autostart")
                .build(),
        )
        .setup(|app| {
            let database = Database::initialize(app.handle())?;
            let start_hidden = std::env::args().any(|argument| argument == "--autostart")
                && commands::preferences::stored_launch_hidden(&database).unwrap_or(false);
            let timers = TimerService::new(Box::new(SystemClock));
            let _ = timers.recover(&database);
            app.manage(database);
            app.manage(timers);
            let shortcut_status = shortcuts::register(app.handle());
            app.manage(shortcut_status);
            windows::create_tray_panel(app.handle())?;
            tray::create(app)?;
            background::spawn_ticker(app.handle().clone());
            let database = app.state::<Database>();
            commands::notes::restore_visible(app.handle(), &database);
            if start_hidden {
                windows::enter_background_mode(app.handle());
            } else {
                windows::show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.app_handle().save_window_state(MAIN_WINDOW_STATE);
                windows::hide_main_window(window.app_handle());
            }
            ("tray-panel", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                windows::hide_tray_panel(window.app_handle());
            }
            ("tray-panel", WindowEvent::Focused(false)) => {
                windows::hide_tray_panel_on_blur(window.app_handle());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::dashboard::get_dashboard_summary,
            commands::tasks::list_tasks,
            commands::tasks::get_task,
            commands::tasks::list_tags,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::set_task_status,
            commands::tasks::delete_task,
            commands::tasks::add_subtask,
            commands::tasks::update_subtask,
            commands::tasks::delete_subtask,
            commands::tasks::link_task_note,
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::create_project,
            commands::projects::update_project,
            commands::projects::archive_project,
            commands::projects::delete_project,
            commands::lifecycle::open_main_window,
            commands::lifecycle::hide_tray_panel,
            commands::lifecycle::quit_flowdesk,
            commands::lifecycle::prepare_restart,
            commands::preferences::get_tray_preferences,
            commands::preferences::update_tray_preferences,
            commands::notes::create_note,
            commands::notes::get_note,
            commands::notes::list_notes,
            commands::notes::update_note,
            commands::notes::set_note_display_mode,
            commands::notes::set_note_collapsed,
            commands::notes::show_note_window,
            commands::notes::hide_note_window,
            commands::notes::archive_note,
            commands::notes::delete_note,
            commands::focus::get_timer_state,
            commands::focus::start_pomodoro,
            commands::focus::pause_pomodoro,
            commands::focus::resume_pomodoro,
            commands::focus::stop_pomodoro,
            commands::focus::toggle_pomodoro,
            commands::focus::start_time_entry,
            commands::focus::pause_time_entry,
            commands::focus::resume_time_entry,
            commands::focus::stop_time_entry,
            commands::focus::get_pomodoro_settings,
            commands::focus::update_pomodoro_settings,
            commands::focus::get_time_stats,
            commands::focus::list_time_entries,
            commands::focus::list_focus_sessions,
            commands::focus::update_time_entry,
            commands::focus::delete_time_entry,
            shortcuts::get_shortcut_status,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar FlowDesk Pro");

    app.run(|app, event| match event {
        RunEvent::Reopen { .. } => {
            windows::show_main_window(app);
            let _ = app.emit("flowdesk://activated", ());
        }
        RunEvent::ExitRequested { .. } | RunEvent::Exit => prepare_exit(app),
        _ => {}
    });
}
