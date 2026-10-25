//! Seguimiento automático del tiempo por aplicación, con consentimiento previo.
//!
//! Cada 5 s se toma una muestra: app en primer plano (solo identificador y nombre)
//! y segundos sin actividad. Las muestras forman tramos continuos que se guardan en
//! `app_tracking` al cerrarse y, como punto de control, cada minuto. Un tramo se
//! cierra al cambiar de app, al quedar inactivo, con una app excluida o si entre dos
//! muestras pasó demasiado tiempo (reposo o cambio de hora).

use super::wakeup::Wakeup;
use crate::{
    background::timer::day_start,
    database::Database,
    models::{AppTrackingSettings, AppUsage, AppUsageReport, ExcludedApp},
};
use chrono::{Datelike, Local, TimeZone};
use rusqlite::{Connection, OptionalExtension, params};
use std::{sync::Mutex, time::Duration};
use uuid::Uuid;

pub const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);
/// Más separación entre muestras indica reposo, un hilo retrasado o un cambio de hora.
const MAX_GAP_SECONDS: i64 = 30;
const CHECKPOINT_SECONDS: i64 = 60;
/// Los tramos más cortos (pasar de largo por una app) no se guardan.
const MIN_SEGMENT_SECONDS: i64 = 3;

pub fn load_settings(connection: &Connection) -> rusqlite::Result<AppTrackingSettings> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'app_tracking'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

pub fn validate_settings(settings: &AppTrackingSettings) -> Result<(), String> {
    if !(1..=60).contains(&settings.idle_minutes) {
        return Err("La inactividad debe estar entre 1 y 60 minutos".to_string());
    }
    if !(7..=365).contains(&settings.retention_days) {
        return Err("La retención debe estar entre 7 y 365 días".to_string());
    }
    if settings.excluded_apps.len() > 100 {
        return Err("Demasiadas aplicaciones excluidas".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct Sample {
    pub now: i64,
    pub app: Option<ExcludedApp>,
    pub idle_seconds: i64,
}

#[derive(Debug, Clone)]
struct Segment {
    id: String,
    app: ExcludedApp,
    started_at: i64,
    last_seen: i64,
    saved: bool,
    saved_at: i64,
}

#[derive(Default)]
pub struct Tracker {
    current: Option<Segment>,
}

fn save(connection: &Connection, segment: &Segment, ended_at: i64) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO app_tracking(id, bundle_id, app_name, started_at, ended_at, duration_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5 - ?4)
         ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at,
            duration_seconds = excluded.duration_seconds",
        params![
            segment.id,
            segment.app.bundle_id,
            segment.app.name,
            segment.started_at,
            ended_at
        ],
    )?;
    Ok(())
}

impl Tracker {
    /// Nombre de la app que se está midiendo.
    pub fn current_app(&self) -> Option<String> {
        self.current
            .as_ref()
            .map(|segment| segment.app.name.clone())
    }

    /// Segundos del tramo actual aún no guardados, para las estadísticas en vivo.
    fn unsaved(&self, now: i64) -> Option<(&ExcludedApp, i64, i64)> {
        self.current.as_ref().map(|segment| {
            let from = if segment.saved {
                segment.saved_at
            } else {
                segment.started_at
            };
            (
                &segment.app,
                segment.started_at,
                (now.min(segment.last_seen + 5) - from).max(0),
            )
        })
    }

    fn close(&mut self, connection: &Connection, ended_at: i64) -> rusqlite::Result<bool> {
        let Some(segment) = self.current.take() else {
            return Ok(false);
        };
        let ended_at = ended_at.max(segment.started_at);
        if segment.saved || ended_at - segment.started_at >= MIN_SEGMENT_SECONDS {
            save(connection, &segment, ended_at)?;
            return Ok(true);
        }
        Ok(false)
    }

    /// Procesa una muestra. Devuelve si cambió algo guardado.
    pub fn sample(
        &mut self,
        database: &Database,
        settings: &AppTrackingSettings,
        sample: Sample,
    ) -> Result<bool, String> {
        let now = sample.now;
        let idle = sample.idle_seconds >= settings.idle_minutes * 60;
        let app = sample.app.filter(|app| {
            !settings
                .excluded_apps
                .iter()
                .any(|excluded| excluded.bundle_id == app.bundle_id)
        });
        database.with_connection(|connection| {
            let mut changed = false;
            if let Some(segment) = &mut self.current {
                let gap = now - segment.last_seen;
                let same_app = app
                    .as_ref()
                    .is_some_and(|app| app.bundle_id == segment.app.bundle_id);
                if !(0..=MAX_GAP_SECONDS).contains(&gap) {
                    let last_seen = segment.last_seen;
                    changed |= self.close(connection, last_seen)?;
                } else if idle {
                    // Se deja de contar desde la última actividad, no desde que se notó.
                    changed |= self.close(connection, now - sample.idle_seconds)?;
                } else if !same_app {
                    changed |= self.close(connection, now)?;
                } else {
                    segment.last_seen = now;
                    let since = if segment.saved {
                        segment.saved_at
                    } else {
                        segment.started_at
                    };
                    if now - since >= CHECKPOINT_SECONDS {
                        save(connection, segment, now)?;
                        segment.saved = true;
                        segment.saved_at = now;
                        changed = true;
                    }
                }
            }
            if self.current.is_none()
                && !idle
                && let Some(app) = app
            {
                self.current = Some(Segment {
                    id: Uuid::new_v4().to_string(),
                    app,
                    started_at: now,
                    last_seen: now,
                    saved: false,
                    saved_at: now,
                });
            }
            Ok(changed)
        })
    }

    /// Cierra el tramo actual (pausa, desactivación o salida de la app).
    pub fn finish(&mut self, database: &Database) -> Result<bool, String> {
        let Some(last_seen) = self.current.as_ref().map(|segment| segment.last_seen) else {
            return Ok(false);
        };
        database.with_connection(|connection| self.close(connection, last_seen))
    }
}

pub fn prune(database: &Database, retention_days: i64, now: i64) -> Result<(), String> {
    database.with_connection(|connection| {
        connection.execute(
            "DELETE FROM app_tracking WHERE started_at < ?1",
            [now - retention_days * 86_400],
        )?;
        Ok(())
    })
}

pub fn clear(database: &Database) -> Result<(), String> {
    database.with_connection(|connection| {
        connection.execute("DELETE FROM app_tracking", [])?;
        Ok(())
    })
}

fn week_start(now: i64) -> i64 {
    let today = day_start(now);
    let weekday = Local
        .timestamp_opt(now, 0)
        .single()
        .map(|moment| i64::from(moment.weekday().num_days_from_monday()))
        .unwrap_or(0);
    day_start(today - weekday * 86_400 + 43_200)
}

/// Tiempo por app hoy y esta semana (lunes a domingo). Cada tramo cuenta en el día
/// en que empezó.
pub fn report(database: &Database, tracker: &Tracker, now: i64) -> Result<AppUsageReport, String> {
    let today = day_start(now);
    let week = week_start(now);
    let mut apps: Vec<AppUsage> = database.with_connection(|connection| {
        connection
            .prepare(
                "SELECT bundle_id,
                    (SELECT app_name FROM app_tracking latest WHERE latest.bundle_id = a.bundle_id
                     ORDER BY started_at DESC LIMIT 1),
                    COALESCE(SUM(duration_seconds) FILTER (WHERE started_at >= ?1), 0),
                    COALESCE(SUM(duration_seconds), 0)
                 FROM app_tracking a WHERE started_at >= ?2
                 GROUP BY bundle_id",
            )?
            .query_map(params![today, week], |row| {
                Ok(AppUsage {
                    bundle_id: row.get(0)?,
                    app_name: row.get(1)?,
                    today_seconds: row.get(2)?,
                    week_seconds: row.get(3)?,
                })
            })?
            .collect()
    })?;
    if let Some((app, started_at, seconds)) = tracker.unsaved(now)
        && started_at >= week
        && seconds > 0
    {
        let today_seconds = if started_at >= today { seconds } else { 0 };
        match apps
            .iter_mut()
            .find(|usage| usage.bundle_id == app.bundle_id)
        {
            Some(usage) => {
                usage.today_seconds += today_seconds;
                usage.week_seconds += seconds;
            }
            None => apps.push(AppUsage {
                bundle_id: app.bundle_id.clone(),
                app_name: app.name.clone(),
                today_seconds,
                week_seconds: seconds,
            }),
        }
    }
    apps.sort_by(|a, b| {
        b.today_seconds
            .cmp(&a.today_seconds)
            .then(b.week_seconds.cmp(&a.week_seconds))
    });
    Ok(AppUsageReport {
        today_seconds: apps.iter().map(|usage| usage.today_seconds).sum(),
        week_seconds: apps.iter().map(|usage| usage.week_seconds).sum(),
        current_app: tracker.current_app(),
        apps,
    })
}

pub struct AppTrackingService {
    pub tracker: Mutex<Tracker>,
    pub wakeup: Wakeup,
}

impl Default for AppTrackingService {
    fn default() -> Self {
        Self {
            tracker: Mutex::new(Tracker::default()),
            wakeup: Wakeup::new(false),
        }
    }
}

impl AppTrackingService {
    pub fn finish(&self, database: &Database) {
        if let Ok(mut tracker) = self.tracker.lock() {
            let _ = tracker.finish(database);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn app(id: &str) -> Option<ExcludedApp> {
        Some(ExcludedApp {
            bundle_id: format!("com.example.{id}"),
            name: id.to_string(),
        })
    }

    fn rows(database: &Database) -> Vec<(String, i64)> {
        database
            .with_connection(|connection| {
                connection
                    .prepare(
                        "SELECT app_name, duration_seconds FROM app_tracking ORDER BY started_at",
                    )?
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect()
            })
            .expect("rows")
    }

    fn feed(
        tracker: &mut Tracker,
        database: &Database,
        settings: &AppTrackingSettings,
        samples: &[(i64, Option<ExcludedApp>, i64)],
    ) {
        for (offset, app, idle_seconds) in samples {
            tracker
                .sample(
                    database,
                    settings,
                    Sample {
                        now: NOW + offset,
                        app: app.clone(),
                        idle_seconds: *idle_seconds,
                    },
                )
                .expect("sample");
        }
    }

    #[test]
    fn switching_apps_closes_segments() {
        let database = Database::in_memory();
        let settings = AppTrackingSettings {
            enabled: true,
            ..AppTrackingSettings::default()
        };
        let mut tracker = Tracker::default();
        feed(
            &mut tracker,
            &database,
            &settings,
            &[
                (0, app("Xcode"), 0),
                (5, app("Xcode"), 0),
                (10, app("Xcode"), 0),
                (15, app("Safari"), 0),
                (16, app("Notas"), 0),
                (20, app("Xcode"), 0),
            ],
        );
        // Notas duró 4 s y se guarda; Safari solo 1 s y se descarta.
        assert_eq!(
            rows(&database),
            [("Xcode".to_string(), 15), ("Notas".to_string(), 4)]
        );
        assert_eq!(tracker.current_app().as_deref(), Some("Xcode"));
        tracker.finish(&database).expect("finish");
        assert_eq!(rows(&database).len(), 2);
    }

    #[test]
    fn idle_time_and_excluded_apps_are_not_counted() {
        let database = Database::in_memory();
        let settings = AppTrackingSettings {
            enabled: true,
            idle_minutes: 1,
            excluded_apps: vec![ExcludedApp {
                bundle_id: "com.example.Banco".to_string(),
                name: "Banco".to_string(),
            }],
            ..AppTrackingSettings::default()
        };
        let mut tracker = Tracker::default();
        feed(
            &mut tracker,
            &database,
            &settings,
            &[
                (0, app("Word"), 0),
                (20, app("Word"), 0),
                (40, app("Word"), 20),
                // Sin actividad desde el segundo 20: se cuenta hasta ahí.
                (60, app("Word"), 40),
                (80, app("Word"), 60),
                (85, app("Word"), 0),
                (100, app("Banco"), 0),
                (105, app("Banco"), 0),
            ],
        );
        assert_eq!(
            rows(&database),
            [("Word".to_string(), 20), ("Word".to_string(), 15)]
        );
        assert!(tracker.current_app().is_none());
    }

    #[test]
    fn sleep_or_clock_jumps_close_at_last_sample() {
        let database = Database::in_memory();
        let settings = AppTrackingSettings::default();
        let mut tracker = Tracker::default();
        feed(
            &mut tracker,
            &database,
            &settings,
            &[
                (0, app("Mail"), 0),
                (10, app("Mail"), 0),
                // Reposo de una hora.
                (3_610, app("Mail"), 0),
                (3_620, app("Mail"), 0),
                // Reloj atrasado manualmente.
                (100, app("Mail"), 0),
            ],
        );
        assert_eq!(
            rows(&database),
            [("Mail".to_string(), 10), ("Mail".to_string(), 10)]
        );
    }

    #[test]
    fn long_segments_are_checkpointed_and_reported_live() {
        let database = Database::in_memory();
        let settings = AppTrackingSettings::default();
        let mut tracker = Tracker::default();
        let samples: Vec<_> = (0..=26).map(|step| (step * 5, app("Figma"), 0)).collect();
        feed(&mut tracker, &database, &settings, &samples);
        // Punto de control a los 60 y 120 s; el resto, en memoria.
        assert_eq!(rows(&database), [("Figma".to_string(), 120)]);
        let live = report(&database, &tracker, NOW + 130).expect("report");
        assert_eq!(live.apps.len(), 1);
        assert_eq!(live.apps[0].week_seconds, 130);
        assert_eq!(live.current_app.as_deref(), Some("Figma"));
        tracker.finish(&database).expect("finish");
        assert_eq!(rows(&database), [("Figma".to_string(), 130)]);
    }

    #[test]
    fn prunes_old_rows_and_validates_settings() {
        let database = Database::in_memory();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO app_tracking(id, bundle_id, app_name, started_at, ended_at,
                        duration_seconds) VALUES ('viejo', 'a', 'A', ?1, ?1, 0)",
                    [NOW - 100 * 86_400],
                )
            })
            .expect("row");
        prune(&database, 90, NOW).expect("prune");
        assert!(rows(&database).is_empty());
        assert!(validate_settings(&AppTrackingSettings::default()).is_ok());
        let invalid = AppTrackingSettings {
            idle_minutes: 0,
            ..AppTrackingSettings::default()
        };
        assert!(validate_settings(&invalid).is_err());
    }
}
