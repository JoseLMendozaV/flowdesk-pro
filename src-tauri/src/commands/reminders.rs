use crate::{
    background::reminders::{REMINDER_TITLE, ReminderService, load_settings, validate_settings},
    database::Database,
    models::{ReminderItem, ReminderSettings},
};
use chrono::Utc;
use tauri::{AppHandle, Emitter, State};

const UPCOMING_SECONDS: i64 = 7 * 86_400;
const RECENT_SECONDS: i64 = 86_400;

pub fn store_settings(database: &Database, settings: &ReminderSettings) -> Result<(), String> {
    validate_settings(settings)?;
    let value = serde_json::to_string(settings).map_err(|error| error.to_string())?;
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES ('reminders', ?1, unixepoch())
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            [value],
        )?;
        Ok(())
    })
}

/// Avisos de los próximos 7 días y los entregados o silenciados en las últimas 24 h.
pub fn query_reminders(database: &Database, now: i64) -> Result<Vec<ReminderItem>, String> {
    database.with_connection(|connection| {
        connection
            .prepare(&format!(
                "SELECT r.id, r.entity_type, r.entity_id, {REMINDER_TITLE}, r.remind_at, r.status
                 FROM reminders r
                 WHERE (r.status = 'scheduled' AND r.remind_at < ?1 + ?2)
                    OR (r.status IN ('delivered', 'silenced') AND r.delivered_at >= ?1 - ?3)
                 ORDER BY r.status != 'scheduled', r.remind_at
                 LIMIT 20"
            ))?
            .query_map(
                rusqlite::params![now, UPCOMING_SECONDS, RECENT_SECONDS],
                |row| {
                    Ok(ReminderItem {
                        id: row.get(0)?,
                        entity_type: row.get(1)?,
                        entity_id: row.get(2)?,
                        title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        remind_at: row.get(4)?,
                        status: row.get(5)?,
                    })
                },
            )?
            .collect()
    })
}

#[tauri::command]
pub fn get_reminder_settings(database: State<'_, Database>) -> Result<ReminderSettings, String> {
    database.with_connection(load_settings)
}

#[tauri::command]
pub fn update_reminder_settings(
    settings: ReminderSettings,
    database: State<'_, Database>,
    service: State<'_, ReminderService>,
    app: AppHandle,
) -> Result<ReminderSettings, String> {
    store_settings(&database, &settings)?;
    service.wakeup.wake();
    let _ = app.emit("flowdesk://data-changed", "reminders");
    Ok(settings)
}

#[tauri::command]
pub fn list_reminders(database: State<'_, Database>) -> Result<Vec<ReminderItem>, String> {
    query_reminders(&database, Utc::now().timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::background::reminders::reconcile;

    #[test]
    fn lists_upcoming_reminders_and_stores_settings() {
        let database = Database::in_memory();
        let now = Utc::now().timestamp();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO tasks(id, title, due_at, due_has_time) VALUES
                        ('t1', 'Revisar actas', ?1, 1), ('t2', 'Lejana', ?2, 1)",
                    [now + 3_600, now + 30 * 86_400],
                )
            })
            .expect("tasks");
        let settings = ReminderSettings {
            task_lead_minutes: 30,
            ..ReminderSettings::default()
        };
        store_settings(&database, &settings).expect("store");
        assert_eq!(
            database.with_connection(load_settings).expect("load"),
            settings
        );
        database
            .with_connection_mut(|connection| reconcile(connection, &settings, now))
            .expect("reconcile");
        let items = query_reminders(&database, now).expect("list");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Revisar actas");
        assert_eq!(items[0].remind_at, now + 1_800);

        let invalid = ReminderSettings {
            quiet_end: -1,
            ..ReminderSettings::default()
        };
        assert!(store_settings(&database, &invalid).is_err());
    }
}
