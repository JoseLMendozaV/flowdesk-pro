mod background;
mod backup;
mod commands;
mod database;
mod menu;
mod models;
mod note_document;
mod recurrence;
mod shortcuts;
mod teaching;
mod tray;
mod windows;

use background::{TimerService, clock::SystemClock, reminders::ReminderService};
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
        if let Some(tracking) = app.try_state::<background::app_tracking::AppTrackingService>() {
            tracking.finish(&database);
        }
    }
    windows::notes::persist_all(app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .menu(menu::build)
        .on_menu_event(menu::handle_event)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_main_window(app);
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
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
            #[cfg(target_os = "macos")]
            background::macos::present_notifications_in_foreground();
            let database = Database::initialize(app.handle())?;
            let start_hidden = std::env::args().any(|argument| argument == "--autostart")
                && commands::preferences::stored_launch_hidden(&database).unwrap_or(false);
            let timers = TimerService::new(Box::new(SystemClock));
            let _ = timers.recover(&database);
            // Feriados de Panamá y calendario de la UTP: se cargan solos una vez (Docencia).
            if let Err(error) = teaching::academic::ensure_official_now(&database) {
                eprintln!("No se pudo cargar el calendario académico: {error:?}");
            }
            app.manage(database);
            app.manage(timers);
            app.manage(ReminderService::default());
            app.manage(backup::BackupService::default());
            app.manage(background::app_tracking::AppTrackingService::default());
            app.manage(background::clipboard::ClipboardService::new(
                app.path().app_data_dir()?.join("clipboard"),
            ));
            let shortcut_status = shortcuts::register(app.handle());
            app.manage(shortcut_status);
            windows::create_tray_panel(app.handle())?;
            tray::create(app)?;
            background::spawn_ticker(app.handle().clone());
            background::spawn_reminders(app.handle().clone());
            background::spawn_clipboard(app.handle().clone());
            background::spawn_app_tracking(app.handle().clone());
            backup::spawn_scheduler(app.handle().clone());
            let database = app.state::<Database>();
            if let Ok(root) = commands::note_attachments::root(app.handle()) {
                let _ = commands::note_attachments::purge_trash(
                    &database,
                    &root,
                    chrono::Utc::now().timestamp(),
                );
            }
            let _ = commands::trash::purge(&database, chrono::Utc::now().timestamp());
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
            (windows::onboarding::LABEL, WindowEvent::Destroyed) => {
                windows::onboarding::on_destroyed(window.app_handle());
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
            commands::tasks::skip_task_occurrence,
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
            commands::notes::list_note_versions,
            commands::notes::get_note_version,
            commands::notes::restore_note_version,
            commands::notes::list_note_history,
            commands::notes::save_note_conflict_copy,
            commands::notes::preserve_note_version,
            commands::notes::set_note_pinned_global,
            commands::note_attachments::add_note_attachment,
            commands::note_attachments::attach_note_files,
            commands::note_attachments::list_note_attachments,
            commands::note_attachments::get_note_attachment_data,
            commands::note_attachments::open_note_attachment,
            commands::note_attachments::delete_note_attachment,
            commands::note_attachments::open_note_link,
            commands::note_contexts::get_note_contexts,
            commands::note_contexts::set_note_context,
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
            commands::calendar::list_calendar,
            commands::calendar::create_event,
            commands::calendar::update_event,
            commands::calendar::delete_event,
            commands::trash::list_trash,
            commands::trash::restore_trash_item,
            commands::trash::delete_trash_item,
            commands::trash::empty_trash,
            commands::reminders::get_reminder_settings,
            commands::reminders::update_reminder_settings,
            commands::reminders::list_reminders,
            commands::workspaces::get_workspaces,
            commands::workspaces::set_active_workspace,
            commands::workspaces::create_workspace,
            commands::workspaces::update_workspace,
            commands::workspaces::archive_workspace,
            commands::workspaces::delete_workspace,
            commands::workspaces::set_workspace_projects,
            commands::workspaces::set_workspace_notes,
            commands::workspaces::add_workspace_resource,
            commands::workspaces::remove_workspace_resource,
            commands::workspaces::open_workspace_resources,
            commands::clipboard::get_clipboard_settings,
            commands::clipboard::update_clipboard_settings,
            commands::clipboard::list_clipboard,
            commands::clipboard::copy_clipboard_item,
            commands::clipboard::set_clipboard_favorite,
            commands::clipboard::delete_clipboard_item,
            commands::clipboard::clear_clipboard,
            commands::clipboard::get_clipboard_image,
            commands::clipboard::exclude_clipboard_app,
            commands::app_tracking::get_app_tracking_settings,
            commands::app_tracking::update_app_tracking_settings,
            commands::app_tracking::get_app_usage,
            commands::app_tracking::exclude_tracking_app,
            commands::app_tracking::clear_app_tracking,
            commands::onboarding::get_onboarding_state,
            commands::onboarding::update_onboarding_preferences,
            commands::onboarding::record_onboarding_step,
            commands::onboarding::finish_welcome_onboarding,
            commands::onboarding::mark_features_seen,
            commands::onboarding::record_onboarding_event,
            commands::onboarding::reset_onboarding,
            commands::onboarding::open_onboarding,
            commands::onboarding::close_onboarding,
            commands::onboarding::start_guided_tour,
            shortcuts::get_shortcut_status,
            teaching::commands::teaching_get_bootstrap,
            teaching::commands::teaching_create_course,
            teaching::commands::teaching_get_students,
            teaching::commands::teaching_add_student,
            teaching::commands::teaching_update_student,
            teaching::commands::teaching_get_attendance,
            teaching::commands::teaching_save_attendance,
            teaching::commands::teaching_get_gradebook,
            teaching::commands::teaching_save_grades,
            teaching::commands::teaching_get_group_gradebook,
            teaching::commands::teaching_save_group_grades,
            teaching::commands::teaching_get_groups,
            teaching::commands::teaching_save_group,
            teaching::commands::teaching_delete_group,
            teaching::commands::teaching_get_evaluations,
            teaching::commands::teaching_save_evaluation,
            teaching::commands::teaching_delete_evaluation,
            teaching::commands::teaching_save_session,
            teaching::commands::teaching_delete_session,
            teaching::commands::teaching_get_events,
            teaching::commands::teaching_save_event,
            teaching::commands::teaching_delete_event,
            teaching::commands::teaching_get_analytics,
            teaching::commands::teaching_get_report_summary,
            teaching::commands::teaching_export_course_csv,
            teaching::commands::teaching_export_course_excel,
            teaching::commands::teaching_get_periods,
            teaching::commands::teaching_save_period,
            teaching::commands::teaching_delete_period,
            teaching::commands::teaching_get_course_settings,
            teaching::commands::teaching_save_course_settings,
            teaching::commands::teaching_get_rubric,
            teaching::commands::teaching_save_rubric_criterion,
            teaching::commands::teaching_delete_rubric_criterion,
            teaching::commands::teaching_get_rubric_matrix,
            teaching::commands::teaching_save_rubric_scores,
            teaching::commands::teaching_get_student_profile,
            teaching::commands::teaching_save_observation,
            teaching::commands::teaching_toggle_observation,
            teaching::commands::teaching_apply_recovery,
            teaching::commands::teaching_get_announcements,
            teaching::commands::teaching_save_announcement,
            teaching::commands::teaching_delete_announcement,
            teaching::commands::teaching_import_students_excel,
            teaching::commands::teaching_import_desktop,
            teaching::commands::teaching_import_django,
            teaching::commands::teaching_backup_database,
            teaching::overview::teaching_get_overview,
            teaching::overview::teaching_get_overview_layout,
            teaching::overview::teaching_save_overview_layout,
            teaching::schedule::teaching_get_schedule,
            teaching::schedule::teaching_get_time_blocks,
            teaching::schedule::teaching_save_time_blocks,
            teaching::schedule::teaching_save_schedule_slot,
            teaching::schedule::teaching_delete_schedule_slot,
            teaching::schedule::teaching_generate_sessions,
            teaching::academic::teaching_get_academic_calendar,
            teaching::academic::teaching_save_academic_day,
            teaching::academic::teaching_delete_academic_day,
            teaching::academic::teaching_load_official_calendar,
            teaching::syllabus::teaching_get_syllabus,
            teaching::syllabus::teaching_save_topic,
            teaching::syllabus::teaching_delete_topic,
            teaching::syllabus::teaching_set_topic_done,
            teaching::syllabus::teaching_add_topics,
            teaching::syllabus::teaching_reorder_topics,
            teaching::syllabus::teaching_distribute_topics,
            teaching::syllabus::teaching_prepare_topic,
            teaching::final_sheet::teaching_get_final_sheet,
            teaching::final_sheet::teaching_save_final_sheet_settings,
            teaching::final_sheet::teaching_set_final_sheet_template,
            teaching::final_sheet::teaching_export_final_sheet,
            backup::get_backups,
            backup::update_backup_settings,
            backup::backup_now,
            backup::restore_backup,
            backup::reveal_backup_folder,
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
