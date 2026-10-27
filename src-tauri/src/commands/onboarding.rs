use crate::{
    database::Database,
    models::{OnboardingPreferences, OnboardingState},
    windows,
};
use rusqlite::params;
use std::collections::BTreeMap;
use tauri::{AppHandle, Emitter, State};

/// Módulos operativos incluidos en este binario. El registro de funcionalidades del
/// frontend exige su capacidad antes de presentar una función: añadir aquí la de un
/// módulo nuevo es parte de darlo por terminado.
const CAPABILITIES: &[&str] = &[
    "dashboard",
    "tasks",
    "projects",
    "notes",
    "global-shortcuts",
    "pomodoro",
    "time-tracking",
    "app-tracking",
    "calendar",
    "reminders",
    "workspaces",
    "clipboard",
    "menu-bar",
    "updates",
    "recurrence",
    "trash",
    "command-palette",
    "teaching",
];

const WELCOME_OUTCOMES: &[&str] = &["completed", "skipped"];
const HISTORY_EVENTS: &[&str] = &[
    "whats_new_shown",
    "guided_tour_started",
    "guided_tour_completed",
];
const HISTORY_LIMIT: i64 = 200;
const MAX_FEATURES: usize = 200;

pub fn capabilities() -> Vec<String> {
    CAPABILITIES.iter().map(ToString::to_string).collect()
}

fn app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Identificadores estables del registro: minúsculas, dígitos, `-`, `_`, `.` y `:`.
fn validate_identifier(value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 80
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'-' | b'_' | b'.' | b':')
        });
    if valid {
        Ok(())
    } else {
        Err("Identificador de la guía no válido".to_string())
    }
}

fn record_history(
    connection: &rusqlite::Connection,
    event: &str,
    detail: Option<&str>,
    version: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO onboarding_history(event, detail, app_version) VALUES (?1, ?2, ?3)",
        params![event, detail, version],
    )?;
    connection.execute(
        "DELETE FROM onboarding_history
         WHERE id <= (SELECT id FROM onboarding_history ORDER BY id DESC LIMIT 1 OFFSET ?1)",
        [HISTORY_LIMIT],
    )?;
    Ok(())
}

pub fn load_state(
    database: &Database,
    version: &str,
    capabilities: Vec<String>,
) -> Result<OnboardingState, String> {
    database.with_connection(|connection| {
        connection.query_row(
            "SELECT welcome_status, show_welcome_on_startup, show_whats_new_on_update, resume_tour,
                    last_seen_app_version, last_seen_feature_revision, seen_features,
                    last_completed_step_id, last_onboarding_at
             FROM onboarding_state WHERE id = 1",
            [],
            |row| {
                let welcome_status: String = row.get(0)?;
                let seen: String = row.get(6)?;
                Ok(OnboardingState {
                    completed_initial_onboarding: welcome_status == "completed",
                    welcome_status,
                    show_welcome_on_startup: row.get(1)?,
                    show_whats_new_on_update: row.get(2)?,
                    resume_tour: row.get(3)?,
                    last_seen_app_version: row.get(4)?,
                    last_seen_feature_revision: row.get(5)?,
                    seen_features: serde_json::from_str(&seen).unwrap_or_default(),
                    last_completed_step_id: row.get(7)?,
                    last_onboarding_date: row.get(8)?,
                    app_version: version.to_string(),
                    capabilities,
                })
            },
        )
    })
}

pub fn store_preferences(
    database: &Database,
    preferences: &OnboardingPreferences,
) -> Result<(), String> {
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE onboarding_state
             SET show_welcome_on_startup = ?1, show_whats_new_on_update = ?2, resume_tour = ?3,
                 updated_at = unixepoch()
             WHERE id = 1",
            params![
                preferences.show_welcome_on_startup,
                preferences.show_whats_new_on_update,
                preferences.resume_tour
            ],
        )?;
        Ok(())
    })
}

pub fn store_step(database: &Database, step_id: Option<&str>) -> Result<(), String> {
    if let Some(step_id) = step_id {
        validate_identifier(step_id)?;
    }
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE onboarding_state
             SET last_completed_step_id = ?1, last_onboarding_at = unixepoch(), updated_at = unixepoch()
             WHERE id = 1",
            [step_id],
        )?;
        Ok(())
    })
}

/// Registra cómo terminó la bienvenida. No cambia si se abre al iniciar: eso solo lo
/// decide el usuario con «No volver a mostrar». Omitir no borra un recorrido completado,
/// y al completarlo el siguiente empieza desde el principio.
pub fn finish_welcome(database: &Database, outcome: &str, version: &str) -> Result<(), String> {
    if !WELCOME_OUTCOMES.contains(&outcome) {
        return Err("Resultado de la bienvenida no válido".to_string());
    }
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE onboarding_state
             SET welcome_status = CASE WHEN ?1 = 'skipped' AND welcome_status = 'completed' THEN 'completed' ELSE ?1 END,
                 last_completed_step_id = CASE WHEN ?1 = 'completed' THEN NULL ELSE last_completed_step_id END,
                 last_onboarding_at = unixepoch(), updated_at = unixepoch()
             WHERE id = 1",
            [outcome],
        )?;
        record_history(connection, &format!("welcome_{outcome}"), None, version)
    })
}

/// La ventana de bienvenida se cerró sin terminar: queda como omitida si estaba
/// pendiente. Seguirá abriéndose al iniciar mientras el usuario no la desactive.
pub fn dismiss_welcome(database: &Database, version: &str) -> Result<bool, String> {
    database.with_connection(|connection| {
        let changed = connection.execute(
            "UPDATE onboarding_state
             SET welcome_status = 'skipped', last_onboarding_at = unixepoch(), updated_at = unixepoch()
             WHERE id = 1 AND welcome_status = 'pending'",
            [],
        )?;
        if changed > 0 {
            record_history(connection, "welcome_skipped", Some("window-closed"), version)?;
        }
        Ok(changed > 0)
    })
}

/// Suma las funcionalidades presentadas a las ya conocidas, conservando la revisión mayor.
pub fn mark_seen(
    database: &Database,
    features: &BTreeMap<String, u32>,
    revision: &str,
    version: &str,
) -> Result<(), String> {
    if features.len() > MAX_FEATURES || revision.len() > 4_000 {
        return Err("Demasiadas funcionalidades".to_string());
    }
    for id in features.keys() {
        validate_identifier(id)?;
    }
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        let stored: String = transaction.query_row(
            "SELECT seen_features FROM onboarding_state WHERE id = 1",
            [],
            |row| row.get(0),
        )?;
        let mut seen: BTreeMap<String, u32> = serde_json::from_str(&stored).unwrap_or_default();
        for (id, feature_revision) in features {
            let known = seen.entry(id.clone()).or_insert(0);
            *known = (*known).max(*feature_revision);
        }
        let seen = serde_json::to_string(&seen).unwrap_or_else(|_| "{}".to_string());
        transaction.execute(
            "UPDATE onboarding_state
             SET seen_features = ?1, last_seen_feature_revision = ?2, last_seen_app_version = ?3,
                 updated_at = unixepoch()
             WHERE id = 1",
            params![seen, revision, version],
        )?;
        transaction.commit()
    })
}

pub fn store_event(
    database: &Database,
    event: &str,
    detail: Option<&str>,
    version: &str,
) -> Result<(), String> {
    if !HISTORY_EVENTS.contains(&event) {
        return Err("Evento de la guía no válido".to_string());
    }
    let detail = detail.map(|value| value.chars().take(500).collect::<String>());
    database
        .with_connection(|connection| record_history(connection, event, detail.as_deref(), version))
}

/// Vuelve a empezar: la bienvenida queda pendiente y el progreso se borra. Lo que el
/// usuario ya conoce se mantiene para no repetir novedades.
pub fn reset(database: &Database, version: &str) -> Result<(), String> {
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE onboarding_state
             SET welcome_status = 'pending', last_completed_step_id = NULL, updated_at = unixepoch()
             WHERE id = 1",
            [],
        )?;
        record_history(connection, "reset", None, version)
    })
}

fn changed(app: &AppHandle, database: &Database) -> Result<OnboardingState, String> {
    let _ = app.emit("flowdesk://data-changed", "onboarding");
    load_state(database, &app_version(app), capabilities())
}

#[tauri::command]
pub fn get_onboarding_state(
    app: AppHandle,
    database: State<'_, Database>,
) -> Result<OnboardingState, String> {
    load_state(&database, &app_version(&app), capabilities())
}

#[tauri::command]
pub fn update_onboarding_preferences(
    app: AppHandle,
    database: State<'_, Database>,
    preferences: OnboardingPreferences,
) -> Result<OnboardingState, String> {
    store_preferences(&database, &preferences)?;
    changed(&app, &database)
}

#[tauri::command]
pub fn record_onboarding_step(
    app: AppHandle,
    database: State<'_, Database>,
    step_id: Option<String>,
) -> Result<(), String> {
    store_step(&database, step_id.as_deref())?;
    let _ = app.emit("flowdesk://data-changed", "onboarding");
    Ok(())
}

#[tauri::command]
pub fn finish_welcome_onboarding(
    app: AppHandle,
    database: State<'_, Database>,
    outcome: String,
) -> Result<OnboardingState, String> {
    finish_welcome(&database, &outcome, &app_version(&app))?;
    changed(&app, &database)
}

#[tauri::command]
pub fn mark_features_seen(
    app: AppHandle,
    database: State<'_, Database>,
    features: BTreeMap<String, u32>,
    revision: String,
) -> Result<OnboardingState, String> {
    mark_seen(&database, &features, &revision, &app_version(&app))?;
    changed(&app, &database)
}

#[tauri::command]
pub fn record_onboarding_event(
    app: AppHandle,
    database: State<'_, Database>,
    event: String,
    detail: Option<String>,
) -> Result<(), String> {
    store_event(&database, &event, detail.as_deref(), &app_version(&app))
}

#[tauri::command]
pub fn reset_onboarding(
    app: AppHandle,
    database: State<'_, Database>,
) -> Result<OnboardingState, String> {
    reset(&database, &app_version(&app))?;
    changed(&app, &database)
}

#[tauri::command]
pub fn open_onboarding(
    app: AppHandle,
    mode: String,
    feature_id: Option<String>,
) -> Result<(), String> {
    if let Some(feature_id) = feature_id.as_deref() {
        validate_identifier(feature_id)?;
    }
    windows::onboarding::open(&app, &mode, feature_id.as_deref())
}

#[tauri::command]
pub fn close_onboarding(app: AppHandle) {
    windows::onboarding::close(&app);
}

/// Visita guiada sobre la interfaz real: cierra la ventana de bienvenida, que taparía
/// el dashboard, y pide a la ventana principal que empiece. Con `return_mode`, al
/// terminar la visita la ventana vuelve a abrirse en ese modo y en la misma función:
/// mirar una función en la app no cuenta como omitir el recorrido.
#[tauri::command]
pub fn start_guided_tour(
    app: AppHandle,
    feature_id: Option<String>,
    return_mode: Option<String>,
) -> Result<(), String> {
    if let Some(feature_id) = feature_id.as_deref() {
        validate_identifier(feature_id)?;
    }
    if let Some(mode) = return_mode.as_deref() {
        windows::onboarding::validate_mode(mode)?;
        windows::onboarding::suspend_welcome();
    }
    windows::onboarding::close(&app);
    windows::hide_tray_panel(&app);
    windows::show_main_window(&app);
    let return_to =
        return_mode.map(|mode| serde_json::json!({ "mode": mode, "featureId": feature_id }));
    app.emit_to(
        "main",
        "flowdesk://guided-tour",
        serde_json::json!({ "featureId": feature_id, "returnTo": return_to }),
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERSION: &str = "0.3.0";

    fn state(database: &Database) -> OnboardingState {
        load_state(database, VERSION, vec![]).expect("state")
    }

    fn history(database: &Database) -> Vec<String> {
        database
            .with_connection(|connection| {
                connection
                    .prepare("SELECT event FROM onboarding_history ORDER BY id")?
                    .query_map([], |row| row.get(0))?
                    .collect()
            })
            .expect("history")
    }

    #[test]
    fn first_run_shows_welcome_with_independent_preferences() {
        let database = Database::in_memory();
        let initial = state(&database);
        assert_eq!(initial.welcome_status, "pending");
        assert!(initial.show_welcome_on_startup);
        assert!(initial.show_whats_new_on_update);
        assert!(initial.seen_features.is_empty());
        assert!(initial.last_seen_app_version.is_none());

        store_preferences(
            &database,
            &OnboardingPreferences {
                show_welcome_on_startup: false,
                show_whats_new_on_update: true,
                resume_tour: false,
            },
        )
        .expect("preferences");
        let stored = state(&database);
        assert!(!stored.show_welcome_on_startup);
        assert!(stored.show_whats_new_on_update);
        assert!(!stored.resume_tour);
        assert_eq!(stored.welcome_status, "pending");
    }

    #[test]
    fn completing_or_skipping_keeps_the_welcome_until_the_user_disables_it() {
        let database = Database::in_memory();
        store_step(&database, Some("feature:tasks")).expect("step");
        finish_welcome(&database, "skipped", VERSION).expect("skip");
        let skipped = state(&database);
        assert_eq!(skipped.welcome_status, "skipped");
        // Sigue abriéndose al iniciar hasta que el usuario lo desactive.
        assert!(skipped.show_welcome_on_startup);
        assert!(!skipped.completed_initial_onboarding);
        // Omitir conserva el punto en que se dejó para «Continuar donde lo dejé».
        assert_eq!(
            skipped.last_completed_step_id.as_deref(),
            Some("feature:tasks")
        );

        finish_welcome(&database, "completed", VERSION).expect("complete");
        let completed = state(&database);
        assert!(completed.completed_initial_onboarding);
        assert!(completed.show_welcome_on_startup);
        assert!(completed.last_completed_step_id.is_none());
        assert!(completed.last_onboarding_date.is_some());
        // Omitir después no borra que se completó.
        finish_welcome(&database, "skipped", VERSION).expect("skip after completing");
        assert!(state(&database).completed_initial_onboarding);
        assert_eq!(
            history(&database),
            ["welcome_skipped", "welcome_completed", "welcome_skipped"]
        );
        assert!(finish_welcome(&database, "later", VERSION).is_err());
    }

    #[test]
    fn closing_the_window_marks_a_pending_welcome_as_skipped_once() {
        let database = Database::in_memory();
        assert!(dismiss_welcome(&database, VERSION).expect("dismiss"));
        let dismissed = state(&database);
        assert_eq!(dismissed.welcome_status, "skipped");
        assert!(dismissed.show_welcome_on_startup);
        // Una segunda vez no cambia nada ni duplica el historial.
        assert!(!dismiss_welcome(&database, VERSION).expect("second dismiss"));
        assert_eq!(history(&database), ["welcome_skipped"]);

        // Cerrar una bienvenida ya completada no la marca como omitida.
        finish_welcome(&database, "completed", VERSION).expect("complete");
        assert!(!dismiss_welcome(&database, VERSION).expect("dismiss completed"));
        assert_eq!(state(&database).welcome_status, "completed");
    }

    #[test]
    fn only_the_user_preference_stops_the_automatic_welcome() {
        let database = Database::in_memory();
        finish_welcome(&database, "completed", VERSION).expect("complete");
        dismiss_welcome(&database, VERSION).expect("dismiss");
        assert!(state(&database).show_welcome_on_startup);
        store_preferences(
            &database,
            &OnboardingPreferences {
                show_welcome_on_startup: false,
                show_whats_new_on_update: true,
                resume_tour: true,
            },
        )
        .expect("disable");
        finish_welcome(&database, "skipped", VERSION).expect("skip");
        assert!(!state(&database).show_welcome_on_startup);
    }

    #[test]
    fn seen_features_merge_and_keep_highest_revision() {
        let database = Database::in_memory();
        let first = BTreeMap::from([("tasks".to_string(), 1), ("notes".to_string(), 2)]);
        mark_seen(&database, &first, "1:notes@2,tasks@1", "0.2.0").expect("first");
        let second = BTreeMap::from([("tasks".to_string(), 3), ("notes".to_string(), 1)]);
        mark_seen(&database, &second, "1:notes@2,tasks@3", VERSION).expect("second");
        let stored = state(&database);
        assert_eq!(stored.seen_features.get("tasks"), Some(&3));
        assert_eq!(stored.seen_features.get("notes"), Some(&2));
        assert_eq!(stored.last_seen_app_version.as_deref(), Some(VERSION));
        assert_eq!(
            stored.last_seen_feature_revision.as_deref(),
            Some("1:notes@2,tasks@3")
        );

        let invalid = BTreeMap::from([("Tareas'; DROP".to_string(), 1)]);
        assert!(mark_seen(&database, &invalid, "x", VERSION).is_err());
        assert!(store_step(&database, Some("../paso")).is_err());
    }

    #[test]
    fn reset_restarts_the_tour_but_keeps_known_features() {
        let database = Database::in_memory();
        mark_seen(
            &database,
            &BTreeMap::from([("tasks".to_string(), 1)]),
            "1:tasks@1",
            VERSION,
        )
        .expect("seen");
        finish_welcome(&database, "completed", VERSION).expect("complete");
        store_step(&database, Some("feature:notes")).expect("step");
        reset(&database, VERSION).expect("reset");
        let restarted = state(&database);
        assert_eq!(restarted.welcome_status, "pending");
        assert!(restarted.last_completed_step_id.is_none());
        assert_eq!(restarted.seen_features.get("tasks"), Some(&1));
    }

    #[test]
    fn history_accepts_known_events_and_stays_bounded() {
        let database = Database::in_memory();
        assert!(store_event(&database, "borrar_todo", None, VERSION).is_err());
        for _ in 0..(HISTORY_LIMIT + 25) {
            store_event(&database, "guided_tour_started", Some("dashboard"), VERSION)
                .expect("event");
        }
        assert_eq!(history(&database).len() as i64, HISTORY_LIMIT);
    }

    #[test]
    fn migration_keeps_existing_data() {
        let mut connection = rusqlite::Connection::open_in_memory().expect("database");
        let migrations = crate::database::migrations();
        for (_, sql) in &migrations[..8] {
            connection.execute_batch(sql).expect("previous migrations");
        }
        connection
            .execute(
                "INSERT INTO tasks(id, title) VALUES ('task', 'Antes de la migración')",
                [],
            )
            .expect("task");
        let transaction = connection.transaction().expect("transaction");
        transaction
            .execute_batch(migrations[8].1)
            .expect("migration 9");
        transaction.commit().expect("commit");
        let (tasks, status): (i64, String) = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM tasks), welcome_status FROM onboarding_state",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("rows");
        assert_eq!((tasks, status.as_str()), (1, "pending"));
    }
}
