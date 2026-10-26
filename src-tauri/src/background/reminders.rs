//! Recordatorios de tareas, notas y eventos, y resumen diario.
//!
//! Las filas de `reminders` se derivan de las entidades de origen: `reconcile` las
//! crea, las reprograma o las cancela, y la tabla solo recuerda qué aviso se entregó.
//! Las horas son de pared: tras un reposo o un cambio de hora, el siguiente ciclo
//! (como mucho 60 s) entrega lo que haya vencido sin repetir lo ya entregado.

use super::wakeup::Wakeup;
use crate::{
    database::Database,
    models::ReminderSettings,
    recurrence::{RecurrenceRule, parse_exceptions},
};
use chrono::{Local, TimeZone, Timelike};
use rusqlite::{Connection, OptionalExtension, params};
use std::time::Duration;
use uuid::Uuid;

/// Un aviso que llega más tarde que esto (app cerrada, Mac en reposo) se da por perdido.
const GRACE_SECONDS: i64 = 6 * 3600;
/// El resumen diario solo se envía durante las tres horas siguientes a su hora.
const DIGEST_WINDOW_MINUTES: i64 = 180;
/// Más avisos simultáneos se agrupan en uno.
const MAX_SEPARATE_NOTICES: usize = 3;
const MAX_WAIT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub title: String,
    pub body: String,
}

/// Hora local del ciclo, separada del reloj para poder probar la lógica.
#[derive(Debug, Clone)]
pub struct LocalMoment {
    pub now: i64,
    pub minute_of_day: i64,
    pub date: String,
    pub day_start: i64,
    pub day_end: i64,
}

impl LocalMoment {
    pub fn current() -> Self {
        let now = Local::now();
        let day_start = crate::background::timer::day_start(now.timestamp());
        let next_day = now
            .date_naive()
            .succ_opt()
            .and_then(|day| day.and_hms_opt(0, 0, 0));
        let day_end = next_day
            .and_then(|midnight| Local.from_local_datetime(&midnight).earliest())
            .map(|midnight| midnight.timestamp())
            .unwrap_or(day_start + 86_400);
        Self {
            now: now.timestamp(),
            minute_of_day: i64::from(now.hour() * 60 + now.minute()),
            date: now.format("%Y-%m-%d").to_string(),
            day_start,
            day_end,
        }
    }
}

pub fn load_settings(connection: &Connection) -> rusqlite::Result<ReminderSettings> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'reminders'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

pub fn validate_settings(settings: &ReminderSettings) -> Result<(), String> {
    if !(0..=1440).contains(&settings.task_lead_minutes) {
        return Err("El aviso de tareas debe estar entre 0 y 1 440 minutos antes".to_string());
    }
    for minute in [
        settings.digest_minute,
        settings.quiet_start,
        settings.quiet_end,
    ] {
        if !(0..1440).contains(&minute) {
            return Err("Hora no válida".to_string());
        }
    }
    Ok(())
}

fn in_quiet_hours(settings: &ReminderSettings, minute: i64) -> bool {
    let (start, end) = (settings.quiet_start, settings.quiet_end);
    settings.quiet_hours
        && match start.cmp(&end) {
            std::cmp::Ordering::Equal => false,
            std::cmp::Ordering::Less => minute >= start && minute < end,
            std::cmp::Ordering::Greater => minute >= start || minute < end,
        }
}

/// Avisos que deberían existir según las entidades: tareas abiertas con hora,
/// notas no archivadas con recordatorio y eventos con aviso.
const DESIRED: &str = "desired(entity_type, entity_id, remind_at) AS (
        SELECT 'task', id, due_at - ?1 FROM tasks
        WHERE status IN ('pending', 'in_progress') AND due_at IS NOT NULL AND due_has_time = 1
        UNION ALL
        SELECT 'note', id, reminder_at FROM notes
        WHERE reminder_at IS NOT NULL AND is_archived = 0
        UNION ALL
        SELECT 'event', id,
               starts_at + CASE WHEN is_all_day = 1 THEN 32400 ELSE 0 END - reminder_minutes * 60
        FROM calendar_events WHERE reminder_minutes IS NOT NULL AND recurrence_rule IS NULL
        UNION ALL
        SELECT 'event', entity_id, remind_at FROM temp.recurring_event_reminders
    )";

/// Aviso de cada evento que se repite: el de la primera repetición que aún no ha pasado.
/// Si ya hay uno programado que venció durante el reposo, se conserva para entregarlo
/// tarde, como los demás; nunca se vuelve a uno ya entregado. Se calcula en Rust y se
/// deja en una tabla temporal para que `DESIRED` lo trate como a los demás.
fn fill_recurring_events(connection: &Connection, now: i64) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS recurring_event_reminders (
             entity_id TEXT PRIMARY KEY NOT NULL,
             remind_at INTEGER NOT NULL
         );
         DELETE FROM temp.recurring_event_reminders;",
    )?;
    let events = connection
        .prepare(
            "SELECT e.id, e.starts_at, e.is_all_day, e.reminder_minutes, e.recurrence_rule,
                    e.recurrence_exceptions, r.remind_at, r.status
             FROM calendar_events e
             LEFT JOIN reminders r ON r.entity_type = 'event' AND r.entity_id = e.id
             WHERE e.reminder_minutes IS NOT NULL AND e.recurrence_rule IS NOT NULL",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, starts_at, is_all_day, minutes, rule, exceptions, last_at, status) in events {
        let Some(rule) = RecurrenceRule::parse(Some(&rule)) else {
            continue;
        };
        let offset = if is_all_day { 32_400 } else { 0 } - minutes * 60;
        let threshold = match (last_at, status.as_deref()) {
            (Some(last_at), Some("scheduled")) if last_at >= now - GRACE_SECONDS => {
                last_at.min(now - 60)
            }
            (Some(last_at), Some("delivered" | "silenced" | "missed")) => {
                (last_at + 1).max(now - 60)
            }
            _ => now - 60,
        };
        let exceptions = parse_exceptions(&exceptions);
        if let Some(occurrence) = rule.first_from(starts_at, &exceptions, threshold - offset) {
            connection.execute(
                "INSERT INTO temp.recurring_event_reminders(entity_id, remind_at) VALUES (?1, ?2)",
                params![id, occurrence + offset],
            )?;
        }
    }
    Ok(())
}

/// Sincroniza `reminders` con las entidades. Un aviso nuevo o reprogramado cuya hora
/// ya pasó queda como perdido: no se avisa de algo que el usuario acaba de fechar en el pasado.
pub fn reconcile(
    connection: &mut Connection,
    settings: &ReminderSettings,
    now: i64,
) -> rusqlite::Result<()> {
    let lead = settings.task_lead_minutes * 60;
    let transaction = connection.transaction()?;
    fill_recurring_events(&transaction, now)?;
    transaction.execute(
        &format!(
            "WITH {DESIRED}
             INSERT INTO reminders(id, entity_type, entity_id, remind_at, status,
                created_at, updated_at)
             SELECT lower(hex(randomblob(16))), entity_type, entity_id, remind_at,
                    CASE WHEN remind_at < ?2 - 60 THEN 'missed' ELSE 'scheduled' END, ?2, ?2
             FROM desired WHERE true
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                remind_at = excluded.remind_at,
                status = excluded.status,
                delivered_at = NULL,
                updated_at = ?2
             WHERE reminders.remind_at != excluded.remind_at
                OR reminders.status = 'cancelled'"
        ),
        params![lead, now],
    )?;
    transaction.execute(
        &format!(
            "WITH {DESIRED}
             UPDATE reminders SET status = 'cancelled', updated_at = ?2
             WHERE status = 'scheduled'
             AND (entity_type, entity_id) NOT IN (SELECT entity_type, entity_id FROM desired)"
        ),
        params![lead, now],
    )?;
    transaction.commit()
}

struct DueReminder {
    id: String,
    entity_type: String,
    remind_at: i64,
    title: String,
    target_at: Option<i64>,
    is_all_day: bool,
    location: Option<String>,
}

pub const REMINDER_TITLE: &str = "CASE r.entity_type
        WHEN 'task' THEN (SELECT title FROM tasks WHERE id = r.entity_id)
        WHEN 'note' THEN (SELECT COALESCE(NULLIF(trim(title), ''), substr(trim(content), 1, 80))
                          FROM notes WHERE id = r.entity_id)
        ELSE (SELECT title FROM calendar_events WHERE id = r.entity_id) END";

fn clock_time(timestamp: i64) -> String {
    Local
        .timestamp_opt(timestamp, 0)
        .single()
        .map(|moment| moment.format("%H:%M").to_string())
        .unwrap_or_default()
}

fn describe(reminder: &DueReminder, now: i64) -> Notice {
    let title = if reminder.title.trim().is_empty() {
        "Nota sin título".to_string()
    } else {
        reminder.title.clone()
    };
    let body = match (reminder.entity_type.as_str(), reminder.target_at) {
        ("task", Some(due)) if due <= now => "Tarea: vence ahora".to_string(),
        ("task", Some(due)) => format!("Tarea: vence a las {}", clock_time(due)),
        ("event", Some(_)) if reminder.is_all_day => "Evento de todo el día".to_string(),
        ("event", Some(starts)) => {
            let when = if starts <= now {
                "Evento: empieza ahora".to_string()
            } else {
                format!("Evento: empieza a las {}", clock_time(starts))
            };
            match &reminder.location {
                Some(location) => format!("{when} · {location}"),
                None => when,
            }
        }
        _ => "Recordatorio de nota".to_string(),
    };
    Notice { title, body }
}

/// Marca los avisos vencidos y devuelve los que deben mostrarse. La marca y la
/// entrada de historial se escriben antes de mostrar nada: un cierre inesperado
/// puede perder un aviso, pero nunca duplicarlo.
pub fn collect_due(
    database: &Database,
    settings: &ReminderSettings,
    moment: &LocalMoment,
) -> Result<Vec<Notice>, String> {
    let now = moment.now;
    let silent = !settings.enabled || in_quiet_hours(settings, moment.minute_of_day);
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        let due = transaction
            .prepare(&format!(
                "SELECT r.id, r.entity_type, r.remind_at, {REMINDER_TITLE},
                    CASE r.entity_type
                        WHEN 'task' THEN (SELECT due_at FROM tasks WHERE id = r.entity_id)
                        WHEN 'event' THEN r.remind_at + (
                            SELECT reminder_minutes * 60
                                   - CASE WHEN is_all_day = 1 THEN 32400 ELSE 0 END
                            FROM calendar_events WHERE id = r.entity_id) END,
                    COALESCE((SELECT is_all_day FROM calendar_events
                              WHERE r.entity_type = 'event' AND id = r.entity_id), 0),
                    (SELECT location FROM calendar_events
                     WHERE r.entity_type = 'event' AND id = r.entity_id)
                 FROM reminders r
                 WHERE r.status = 'scheduled' AND r.remind_at <= ?1
                 ORDER BY r.remind_at, r.rowid"
            ))?
            .query_map([now], |row| {
                Ok(DueReminder {
                    id: row.get(0)?,
                    entity_type: row.get(1)?,
                    remind_at: row.get(2)?,
                    title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    target_at: row.get(4)?,
                    is_all_day: row.get(5)?,
                    location: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut notices = Vec::new();
        for reminder in due {
            let status = if reminder.remind_at < now - GRACE_SECONDS {
                "missed"
            } else if silent {
                "silenced"
            } else {
                "delivered"
            };
            transaction.execute(
                "UPDATE reminders SET status = ?1, delivered_at = ?2, updated_at = ?2
                 WHERE id = ?3",
                params![status, now, reminder.id],
            )?;
            if status != "delivered" {
                continue;
            }
            let notice = describe(&reminder, now);
            let inserted = transaction.execute(
                "INSERT OR IGNORE INTO notification_history(id, reminder_id, notification_type,
                    title, delivered_at, deduplication_key)
                 VALUES (?1, ?2, 'reminder', ?3, ?4, ?5)",
                params![
                    Uuid::new_v4().to_string(),
                    reminder.id,
                    notice.title,
                    now,
                    format!("reminder:{}:{}", reminder.id, reminder.remind_at)
                ],
            )?;
            if inserted > 0 {
                notices.push(notice);
            }
        }
        transaction.commit()?;
        Ok(group(notices))
    })
}

fn group(notices: Vec<Notice>) -> Vec<Notice> {
    if notices.len() <= MAX_SEPARATE_NOTICES {
        return notices;
    }
    let titles: Vec<_> = notices.iter().map(|notice| notice.title.as_str()).collect();
    vec![Notice {
        title: format!("{} recordatorios", notices.len()),
        body: titles.join(" · "),
    }]
}

/// Resumen de la mañana con las tareas de hoy y las vencidas. Se envía una vez al
/// día, solo si hay algo pendiente y fuera de las horas de silencio.
pub fn collect_digest(
    database: &Database,
    settings: &ReminderSettings,
    moment: &LocalMoment,
) -> Result<Option<Notice>, String> {
    let minutes_after = moment.minute_of_day - settings.digest_minute;
    if !settings.enabled
        || !settings.daily_digest
        || !(0..DIGEST_WINDOW_MINUTES).contains(&minutes_after)
        || in_quiet_hours(settings, moment.minute_of_day)
    {
        return Ok(None);
    }
    database.with_connection(|connection| {
        let (today, overdue): (i64, i64) = connection.query_row(
            "SELECT
                COUNT(*) FILTER (WHERE due_at >= ?1 AND due_at < ?2),
                COUNT(*) FILTER (WHERE due_at < ?1)
             FROM tasks WHERE status IN ('pending', 'in_progress')",
            params![moment.day_start, moment.day_end],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if today + overdue == 0 {
            return Ok(None);
        }
        let mut parts = Vec::new();
        match today {
            0 => {}
            1 => parts.push("1 tarea para hoy".to_string()),
            count => parts.push(format!("{count} tareas para hoy")),
        }
        match overdue {
            0 => {}
            1 => parts.push("1 vencida".to_string()),
            count => parts.push(format!("{count} vencidas")),
        }
        let notice = Notice {
            title: "Tu día en FlowDesk".to_string(),
            body: parts.join(" · "),
        };
        let inserted = connection.execute(
            "INSERT OR IGNORE INTO notification_history(id, notification_type, title,
                delivered_at, deduplication_key)
             VALUES (?1, 'digest', ?2, ?3, ?4)",
            params![
                Uuid::new_v4().to_string(),
                notice.title,
                moment.now,
                format!("digest:{}", moment.date)
            ],
        )?;
        Ok((inserted > 0).then_some(notice))
    })
}

/// Hay avisos vencidos por entregar (o por dar por perdidos).
pub fn has_due(database: &Database, now: i64) -> bool {
    database
        .with_connection(|connection| {
            connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM reminders WHERE status = 'scheduled' AND remind_at <= ?1)",
                [now],
                |row| row.get(0),
            )
        })
        .unwrap_or(false)
}

/// Hasta el siguiente aviso programado, con un máximo de 60 s para notar a tiempo
/// los cambios de hora, el reposo y el resumen diario.
pub fn next_wait(database: &Database, now: i64) -> Duration {
    let next: Option<i64> = database
        .with_connection(|connection| {
            connection.query_row(
                "SELECT MIN(remind_at) FROM reminders WHERE status = 'scheduled'",
                [],
                |row| row.get(0),
            )
        })
        .unwrap_or(None);
    match next {
        Some(at) => Duration::from_secs((at - now).clamp(1, 60) as u64),
        None => MAX_WAIT,
    }
}

/// Señal para el hilo de recordatorios: despertar y volver a derivar los avisos.
pub struct ReminderService {
    pub wakeup: Wakeup,
}

impl Default for ReminderService {
    fn default() -> Self {
        // Pendiente desde el inicio: el primer ciclo deriva los avisos.
        Self {
            wakeup: Wakeup::new(true),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn moment(now: i64, minute_of_day: i64) -> LocalMoment {
        LocalMoment {
            now,
            minute_of_day,
            date: "2027-01-15".to_string(),
            day_start: now - minute_of_day * 60,
            day_end: now - minute_of_day * 60 + 86_400,
        }
    }

    fn execute(database: &Database, sql: &str) {
        database
            .with_connection(|connection| connection.execute_batch(sql))
            .expect("sql");
    }

    fn sync(database: &Database, settings: &ReminderSettings, now: i64) {
        database
            .with_connection_mut(|connection| reconcile(connection, settings, now))
            .expect("reconcile");
    }

    fn status(database: &Database, entity_id: &str) -> Option<String> {
        database
            .with_connection(|connection| {
                connection
                    .query_row(
                        "SELECT status FROM reminders WHERE entity_id = ?1",
                        [entity_id],
                        |row| row.get(0),
                    )
                    .optional()
            })
            .expect("status")
    }

    fn task_due(database: &Database, id: &str, due_at: i64) {
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO tasks(id, title, due_at, due_has_time) VALUES (?1, ?1, ?2, 1)",
                    params![id, due_at],
                )
            })
            .expect("task");
    }

    #[test]
    fn task_reminder_fires_once_before_due() {
        let database = Database::in_memory();
        let settings = ReminderSettings::default();
        task_due(&database, "informe", NOW + 3_600);
        sync(&database, &settings, NOW);
        assert_eq!(status(&database, "informe").as_deref(), Some("scheduled"));

        let early = collect_due(&database, &settings, &moment(NOW + 2_000, 600)).expect("due");
        assert!(early.is_empty());
        // Diez minutos antes del vencimiento.
        let at = NOW + 3_600 - 600;
        let notices = collect_due(&database, &settings, &moment(at, 600)).expect("due");
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, "informe");
        assert!(notices[0].body.starts_with("Tarea: vence a las"));
        assert!(
            collect_due(&database, &settings, &moment(at + 5, 600))
                .expect("again")
                .is_empty()
        );
        // Volver a sincronizar sin cambios no reprograma el aviso entregado.
        sync(&database, &settings, at + 10);
        assert_eq!(status(&database, "informe").as_deref(), Some("delivered"));
    }

    #[test]
    fn rescheduling_and_completing_update_reminders() {
        let database = Database::in_memory();
        let settings = ReminderSettings::default();
        task_due(&database, "tarea", NOW + 3_600);
        sync(&database, &settings, NOW);
        execute(
            &database,
            &format!(
                "UPDATE tasks SET due_at = {} WHERE id = 'tarea'",
                NOW + 7_200
            ),
        );
        sync(&database, &settings, NOW);
        let remind_at: i64 = database
            .with_connection(|connection| {
                connection.query_row("SELECT remind_at FROM reminders", [], |row| row.get(0))
            })
            .expect("remind_at");
        assert_eq!(remind_at, NOW + 7_200 - 600);

        execute(
            &database,
            "UPDATE tasks SET status = 'completed' WHERE id = 'tarea'",
        );
        sync(&database, &settings, NOW);
        assert_eq!(status(&database, "tarea").as_deref(), Some("cancelled"));
        execute(
            &database,
            "UPDATE tasks SET status = 'pending' WHERE id = 'tarea'",
        );
        sync(&database, &settings, NOW);
        assert_eq!(status(&database, "tarea").as_deref(), Some("scheduled"));

        execute(&database, "DELETE FROM tasks WHERE id = 'tarea'");
        assert_eq!(status(&database, "tarea"), None);
    }

    #[test]
    fn past_dates_and_stale_reminders_are_not_announced() {
        let database = Database::in_memory();
        let settings = ReminderSettings::default();
        // Fechada en el pasado al crearse: no avisa.
        task_due(&database, "ayer", NOW - 86_400);
        // Programada, pero la app estuvo cerrada más de 6 h.
        task_due(&database, "antigua", NOW + 600);
        sync(&database, &settings, NOW);
        assert_eq!(status(&database, "ayer").as_deref(), Some("missed"));

        let later = NOW + 600 + GRACE_SECONDS + 60;
        assert!(
            collect_due(&database, &settings, &moment(later, 600))
                .expect("due")
                .is_empty()
        );
        assert_eq!(status(&database, "antigua").as_deref(), Some("missed"));
    }

    #[test]
    fn reminder_due_during_sleep_is_delivered_on_wake() {
        let database = Database::in_memory();
        let settings = ReminderSettings::default();
        task_due(&database, "llamada", NOW + 1_200);
        sync(&database, &settings, NOW);
        // El Mac despierta 40 minutos después de la hora del aviso.
        let wake = NOW + 1_200 - 600 + 2_400;
        let notices = collect_due(&database, &settings, &moment(wake, 600)).expect("due");
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].body, "Tarea: vence ahora");
    }

    #[test]
    fn quiet_hours_and_disabled_reminders_stay_silent() {
        let database = Database::in_memory();
        let quiet = ReminderSettings {
            quiet_hours: true,
            quiet_start: 22 * 60,
            quiet_end: 8 * 60,
            ..ReminderSettings::default()
        };
        task_due(&database, "noche", NOW + 1_000);
        sync(&database, &quiet, NOW);
        let notices = collect_due(&database, &quiet, &moment(NOW + 1_000, 23 * 60)).expect("due");
        assert!(notices.is_empty());
        assert_eq!(status(&database, "noche").as_deref(), Some("silenced"));

        assert!(in_quiet_hours(&quiet, 2 * 60));
        assert!(!in_quiet_hours(&quiet, 8 * 60));
        let disabled = ReminderSettings {
            enabled: false,
            ..ReminderSettings::default()
        };
        task_due(&database, "apagado", NOW + 2_000);
        sync(&database, &disabled, NOW);
        assert!(
            collect_due(&database, &disabled, &moment(NOW + 2_000, 600))
                .expect("due")
                .is_empty()
        );
        assert_eq!(status(&database, "apagado").as_deref(), Some("silenced"));
    }

    #[test]
    fn notes_and_events_produce_reminders() {
        let database = Database::in_memory();
        let settings = ReminderSettings::default();
        execute(
            &database,
            &format!(
                "INSERT INTO notes(id, title, content, reminder_at)
                    VALUES ('nota', '', 'Llamar al laboratorio', {at});
                 INSERT INTO calendar_events(id, title, starts_at, ends_at, location,
                    reminder_minutes)
                    VALUES ('evento', 'Tutoría', {start}, {end}, 'Aula 3', 5);",
                at = NOW + 60,
                start = NOW + 900,
                end = NOW + 4_500
            ),
        );
        sync(&database, &settings, NOW);
        let notices = collect_due(&database, &settings, &moment(NOW + 60, 600)).expect("due");
        assert_eq!(
            notices,
            [Notice {
                title: "Llamar al laboratorio".to_string(),
                body: "Recordatorio de nota".to_string()
            }]
        );
        let notices = collect_due(&database, &settings, &moment(NOW + 1_000, 600)).expect("due");
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, "Tutoría");
        assert!(notices[0].body.ends_with("· Aula 3"));

        execute(
            &database,
            "UPDATE notes SET is_archived = 1, reminder_at = reminder_at + 600",
        );
        sync(&database, &settings, NOW);
        assert_eq!(status(&database, "nota").as_deref(), Some("delivered"));
        execute(&database, "DELETE FROM calendar_events");
        assert_eq!(status(&database, "evento"), None);
    }

    #[test]
    fn recurring_events_remind_each_occurrence_once() {
        let database = Database::in_memory();
        let settings = ReminderSettings::default();
        let remind_at = |database: &Database| -> i64 {
            database
                .with_connection(|connection| {
                    connection.query_row(
                        "SELECT remind_at FROM reminders WHERE entity_id = 'serie'",
                        [],
                        |row| row.get(0),
                    )
                })
                .expect("reminder")
        };
        // Diario, empezó hace dos días: el aviso es el de la repetición de hoy.
        execute(
            &database,
            &format!(
                "INSERT INTO calendar_events(id, title, starts_at, ends_at, reminder_minutes,
                    recurrence_rule)
                    VALUES ('serie', 'Clase', {start}, {end}, 10,
                    '{{\"frequency\":\"daily\",\"interval\":1}}');",
                start = NOW - 2 * 86_400 + 1_800,
                end = NOW - 2 * 86_400 + 5_400
            ),
        );
        sync(&database, &settings, NOW);
        let today = remind_at(&database);
        assert_eq!(today, NOW + 1_200);

        assert!(!has_due(&database, today - 1));
        assert!(has_due(&database, today));
        let notices = collect_due(&database, &settings, &moment(today, 600)).expect("due");
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, "Clase");
        assert!(!has_due(&database, today));
        assert!(notices[0].body.starts_with("Evento: empieza a las"));

        // Tras entregarlo, se programa el de mañana y no se repite el de hoy.
        sync(&database, &settings, today + 60);
        assert_eq!(status(&database, "serie").as_deref(), Some("scheduled"));
        let tomorrow = remind_at(&database);
        assert_eq!(tomorrow, today + 86_400);
        assert!(
            collect_due(&database, &settings, &moment(today + 120, 600))
                .expect("due")
                .is_empty()
        );

        // Quitar la repetición de mañana salta al día siguiente.
        let occurrence = tomorrow + 600;
        execute(
            &database,
            &format!("UPDATE calendar_events SET recurrence_exceptions = '[{occurrence}]'"),
        );
        sync(&database, &settings, today + 180);
        assert_eq!(remind_at(&database), tomorrow + 86_400);
    }

    #[test]
    fn simultaneous_reminders_are_grouped() {
        let database = Database::in_memory();
        let settings = ReminderSettings::default();
        for id in ["a", "b", "c", "d"] {
            task_due(&database, id, NOW + 700);
        }
        sync(&database, &settings, NOW);
        let notices = collect_due(&database, &settings, &moment(NOW + 100, 600)).expect("due");
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].title, "4 recordatorios");
    }

    #[test]
    fn daily_digest_is_sent_once_with_pending_tasks() {
        let database = Database::in_memory();
        let settings = ReminderSettings::default();
        let morning = moment(NOW, 9 * 60 + 5);
        assert_eq!(
            collect_digest(&database, &settings, &morning).expect("digest"),
            None
        );

        execute(
            &database,
            &format!(
                "INSERT INTO tasks(id, title, due_at) VALUES ('hoy', 'Hoy', {today}),
                    ('vieja', 'Vieja', {old}), ('otra', 'Otra', {old})",
                today = morning.day_start + 43_200,
                old = morning.day_start - 86_400
            ),
        );
        let early = moment(NOW, 8 * 60);
        assert_eq!(
            collect_digest(&database, &settings, &early).expect("digest"),
            None
        );
        let notice = collect_digest(&database, &settings, &morning)
            .expect("digest")
            .expect("notice");
        assert_eq!(notice.body, "1 tarea para hoy · 2 vencidas");
        assert_eq!(
            collect_digest(&database, &settings, &morning).expect("again"),
            None
        );
    }

    #[test]
    fn validates_settings() {
        assert!(validate_settings(&ReminderSettings::default()).is_ok());
        let invalid = ReminderSettings {
            digest_minute: 1440,
            ..ReminderSettings::default()
        };
        assert!(validate_settings(&invalid).is_err());
        let invalid = ReminderSettings {
            task_lead_minutes: -1,
            ..ReminderSettings::default()
        };
        assert!(validate_settings(&invalid).is_err());
    }

    #[test]
    fn wait_never_exceeds_a_minute() {
        let database = Database::in_memory();
        assert_eq!(next_wait(&database, NOW), MAX_WAIT);
        task_due(&database, "pronto", NOW + 615);
        sync(&database, &ReminderSettings::default(), NOW);
        assert_eq!(next_wait(&database, NOW), Duration::from_secs(15));
    }
}
