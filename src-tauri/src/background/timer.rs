//! Estado de Pomodoro y cronómetro manual gestionado por Rust.
//!
//! SQLite guarda cada sesión; en memoria solo se conserva el instante del reloj de
//! actividad en que se sincronizó por última vez el tiempo transcurrido. Para una fila
//! en curso: `transcurrido = elapsed_seconds + (reloj_actividad_ahora - ancla)`.
//! Ese reloj no avanza en reposo ni cambia con la hora del sistema.

use super::clock::Clock;
use crate::{
    database::Database,
    models::{
        ActiveEntry, ActivePomodoro, EntryInput, PomodoroSettings, StartPomodoro, TimerSnapshot,
        WorkContext,
    },
};
use chrono::{Local, TimeZone};
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    collections::HashMap,
    sync::{Condvar, Mutex, MutexGuard},
    time::Duration,
};
use uuid::Uuid;

pub const SESSION_TYPES: &[&str] = &["focus", "short_break", "long_break"];
/// Diferencia entre reloj continuo y de actividad a partir de la cual hubo reposo.
const SLEEP_THRESHOLD: Duration = Duration::from_secs(5);
/// Cada cuánto se guarda el tiempo en curso para recuperarse de un cierre inesperado.
const CHECKPOINT_EVERY: Duration = Duration::from_secs(60);
const IDLE_WAIT: Duration = Duration::from_secs(600);
/// Un enfoque interrumpido antes de un minuto no se registra como tiempo trabajado.
const MIN_FOCUS_ENTRY_SECONDS: i64 = 60;

pub struct TimerService {
    clock: Box<dyn Clock>,
    inner: Mutex<Inner>,
    wake: Condvar,
}

struct Inner {
    anchors: HashMap<String, Duration>,
    last_gap: Duration,
    last_checkpoint: Duration,
    dirty: bool,
}

#[derive(Debug, Default)]
pub struct TickReport {
    pub changed: bool,
    /// El equipo estuvo en reposo y se pausaron temporizadores en curso.
    pub paused_after_sleep: bool,
    pub completed: Option<CompletedSession>,
    pub running: bool,
    pub next_wait: Duration,
}

#[derive(Debug, Clone)]
pub struct CompletedSession {
    pub session_type: String,
    pub next_session_type: String,
    pub next_minutes: i64,
    pub auto_started: bool,
    pub notify: bool,
}

#[derive(Debug, Clone)]
struct PomodoroRow {
    id: String,
    session_type: String,
    status: String,
    planned: i64,
    elapsed: i64,
    started_at: i64,
    expected_end_at: Option<i64>,
    task_id: Option<String>,
    project_id: Option<String>,
}

#[derive(Debug, Clone)]
struct EntryRow {
    id: String,
    status: String,
    elapsed: i64,
    started_at: i64,
    description: String,
    task_id: Option<String>,
    project_id: Option<String>,
}

fn load_pomodoro(connection: &Connection) -> rusqlite::Result<Option<PomodoroRow>> {
    connection
        .query_row(
            "SELECT id, session_type, status, planned_seconds, elapsed_seconds, started_at,
                    expected_end_at, task_id, project_id
             FROM pomodoro_sessions WHERE status IN ('running', 'paused')",
            [],
            |row| {
                Ok(PomodoroRow {
                    id: row.get(0)?,
                    session_type: row.get(1)?,
                    status: row.get(2)?,
                    planned: row.get(3)?,
                    elapsed: row.get(4)?,
                    started_at: row.get(5)?,
                    expected_end_at: row.get(6)?,
                    task_id: row.get(7)?,
                    project_id: row.get(8)?,
                })
            },
        )
        .optional()
}

fn load_entry(connection: &Connection) -> rusqlite::Result<Option<EntryRow>> {
    connection
        .query_row(
            "SELECT id, status, duration_seconds, started_at, description, task_id, project_id
             FROM time_entries WHERE source = 'manual' AND status IN ('running', 'paused')",
            [],
            |row| {
                Ok(EntryRow {
                    id: row.get(0)?,
                    status: row.get(1)?,
                    elapsed: row.get(2)?,
                    started_at: row.get(3)?,
                    description: row.get(4)?,
                    task_id: row.get(5)?,
                    project_id: row.get(6)?,
                })
            },
        )
        .optional()
}

pub fn load_context(
    connection: &Connection,
    task_id: Option<&str>,
    project_id: Option<&str>,
) -> rusqlite::Result<WorkContext> {
    let task_title = match task_id {
        Some(id) => connection
            .query_row("SELECT title FROM tasks WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .optional()?,
        None => None,
    };
    let project = match project_id {
        Some(id) => connection
            .query_row(
                "SELECT name, color FROM projects WHERE id = ?1",
                [id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?,
        None => None,
    };
    Ok(WorkContext {
        task_id: task_id.map(str::to_string),
        task_title,
        project_id: project_id.map(str::to_string),
        project_name: project.as_ref().map(|(name, _)| name.clone()),
        project_color: project.map(|(_, color)| color),
    })
}

/// Recalcula la caché `tasks.tracked_seconds` a partir de los registros de tiempo.
pub fn refresh_task_time(connection: &Connection, task_id: Option<&str>) -> rusqlite::Result<()> {
    if let Some(task_id) = task_id {
        connection.execute(
            "UPDATE tasks SET tracked_seconds =
                (SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries WHERE task_id = ?1)
             WHERE id = ?1",
            [task_id],
        )?;
    }
    Ok(())
}

pub fn load_settings(connection: &Connection) -> rusqlite::Result<PomodoroSettings> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'pomodoro'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

pub fn validate_settings(settings: &PomodoroSettings) -> Result<(), String> {
    let checks = [
        (
            settings.focus_minutes,
            1,
            180,
            "El enfoque debe durar entre 1 y 180 minutos",
        ),
        (
            settings.short_break_minutes,
            1,
            60,
            "El descanso corto debe durar entre 1 y 60 minutos",
        ),
        (
            settings.long_break_minutes,
            1,
            120,
            "El descanso largo debe durar entre 1 y 120 minutos",
        ),
        (
            settings.long_break_every,
            2,
            12,
            "El descanso largo debe llegar cada 2 a 12 sesiones",
        ),
    ];
    for (value, min, max, message) in checks {
        if !(min..=max).contains(&value) {
            return Err(message.to_string());
        }
    }
    Ok(())
}

fn minutes_for(settings: &PomodoroSettings, session_type: &str) -> i64 {
    match session_type {
        "short_break" => settings.short_break_minutes,
        "long_break" => settings.long_break_minutes,
        _ => settings.focus_minutes,
    }
}

/// Inicio del día local que contiene `wall`.
pub fn day_start(wall: i64) -> i64 {
    Local
        .timestamp_opt(wall, 0)
        .single()
        .and_then(|moment| moment.date_naive().and_hms_opt(0, 0, 0))
        .and_then(|midnight| Local.from_local_datetime(&midnight).earliest())
        .map(|midnight| midnight.timestamp())
        .unwrap_or(wall - wall.rem_euclid(86_400))
}

struct Cycle {
    next_session_type: String,
    position: i64,
    focus_today: i64,
}

fn cycle(connection: &Connection, wall: i64, every: i64) -> rusqlite::Result<Cycle> {
    let completed: Vec<String> = connection
        .prepare(
            "SELECT session_type FROM pomodoro_sessions
             WHERE status = 'completed' AND completed_at >= ?1
             ORDER BY completed_at DESC, rowid DESC",
        )?
        .query_map([day_start(wall)], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let position = completed
        .iter()
        .take_while(|kind| kind.as_str() != "long_break")
        .filter(|kind| kind.as_str() == "focus")
        .count() as i64;
    let focus_today = completed
        .iter()
        .filter(|kind| kind.as_str() == "focus")
        .count() as i64;
    let next_session_type = match completed.first().map(String::as_str) {
        Some("focus") if position > 0 && position % every == 0 => "long_break",
        Some("focus") => "short_break",
        _ => "focus",
    };
    Ok(Cycle {
        next_session_type: next_session_type.to_string(),
        position: position % every,
        focus_today,
    })
}

fn insert_focus_entry(
    connection: &Connection,
    session: &PomodoroRow,
    seconds: i64,
    wall: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO time_entries(id, task_id, project_id, source, status, started_at, ended_at,
            duration_seconds, pomodoro_session_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pomodoro', 'completed', ?4, ?5, ?6, ?7, ?5, ?5)",
        params![
            Uuid::new_v4().to_string(),
            session.task_id,
            session.project_id,
            session.started_at,
            wall,
            seconds,
            session.id
        ],
    )?;
    refresh_task_time(connection, session.task_id.as_deref())
}

impl TimerService {
    pub fn new(clock: Box<dyn Clock>) -> Self {
        let awake = clock.awake();
        let gap = clock.continuous().saturating_sub(awake);
        Self {
            clock,
            inner: Mutex::new(Inner {
                anchors: HashMap::new(),
                last_gap: gap,
                last_checkpoint: awake,
                dirty: false,
            }),
            wake: Condvar::new(),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Inner>, String> {
        self.inner
            .lock()
            .map_err(|_| "El servicio de temporizadores no está disponible".to_string())
    }

    fn elapsed(&self, inner: &Inner, id: &str, stored: i64, status: &str) -> Duration {
        let base = Duration::from_secs(stored.max(0) as u64);
        match (status, inner.anchors.get(id)) {
            ("running", Some(anchor)) => base + self.clock.awake().saturating_sub(*anchor),
            _ => base,
        }
    }

    /// Fija el tiempo transcurrido en segundos enteros y mueve el ancla conservando
    /// la fracción, para no acumular errores de redondeo.
    fn settle(&self, inner: &mut Inner, id: &str, exact: Duration) -> i64 {
        let seconds = exact.as_secs();
        if inner.anchors.contains_key(id) {
            let fraction = exact - Duration::from_secs(seconds);
            inner
                .anchors
                .insert(id.to_string(), self.clock.awake().saturating_sub(fraction));
        }
        seconds as i64
    }

    fn mark_dirty(&self, inner: &mut Inner) {
        inner.dirty = true;
        self.wake.notify_all();
    }

    /// Espera hasta `timeout` o hasta que una operación cambie el estado.
    pub fn wait(&self, timeout: Duration) {
        let Ok(guard) = self.inner.lock() else {
            return;
        };
        if let Ok((mut guard, _)) = self
            .wake
            .wait_timeout_while(guard, timeout, |inner| !inner.dirty)
        {
            guard.dirty = false;
        }
    }

    /// Tras un inicio, las filas que figuraban en curso proceden de un cierre inesperado:
    /// quedan en pausa con el último tiempo guardado (se pierde como mucho un minuto).
    pub fn recover(&self, database: &Database) -> Result<usize, String> {
        let wall = self.clock.wall();
        database.with_connection(|connection| {
            let sessions = connection.execute(
                "UPDATE pomodoro_sessions SET status = 'paused', paused_at = ?1,
                    expected_end_at = NULL, updated_at = ?1
                 WHERE status = 'running'",
                [wall],
            )?;
            let entries = connection.execute(
                "UPDATE time_entries SET status = 'paused', updated_at = ?1
                 WHERE source = 'manual' AND status = 'running'",
                [wall],
            )?;
            Ok(sessions + entries)
        })
    }

    pub fn snapshot(&self, database: &Database) -> Result<TimerSnapshot, String> {
        let inner = self.lock()?;
        self.snapshot_locked(&inner, database)
    }

    fn snapshot_locked(&self, inner: &Inner, database: &Database) -> Result<TimerSnapshot, String> {
        let wall = self.clock.wall();
        let (pomodoro, entry, settings, cycle) = database.with_connection(|connection| {
            let settings = load_settings(connection)?;
            let cycle = cycle(connection, wall, settings.long_break_every)?;
            let pomodoro = match load_pomodoro(connection)? {
                Some(row) => {
                    let context = load_context(
                        connection,
                        row.task_id.as_deref(),
                        row.project_id.as_deref(),
                    )?;
                    Some((row, context))
                }
                None => None,
            };
            let entry = match load_entry(connection)? {
                Some(row) => {
                    let context = load_context(
                        connection,
                        row.task_id.as_deref(),
                        row.project_id.as_deref(),
                    )?;
                    Some((row, context))
                }
                None => None,
            };
            Ok((pomodoro, entry, settings, cycle))
        })?;

        let pomodoro = pomodoro.map(|(row, context)| {
            let elapsed = self
                .elapsed(inner, &row.id, row.elapsed, &row.status)
                .as_secs() as i64;
            let remaining = (row.planned - elapsed).max(0);
            ActivePomodoro {
                id: row.id,
                session_type: row.session_type,
                expected_end_at: (row.status == "running")
                    .then_some(wall + remaining)
                    .or(row.expected_end_at),
                status: row.status,
                planned_seconds: row.planned,
                elapsed_seconds: elapsed.min(row.planned),
                remaining_seconds: remaining,
                started_at: row.started_at,
                context,
            }
        });
        let entry = entry.map(|(row, context)| ActiveEntry {
            elapsed_seconds: self
                .elapsed(inner, &row.id, row.elapsed, &row.status)
                .as_secs() as i64,
            id: row.id,
            status: row.status,
            started_at: row.started_at,
            description: row.description,
            context,
        });
        Ok(TimerSnapshot {
            pomodoro,
            entry,
            next_session_type: cycle.next_session_type,
            cycle_position: cycle.position,
            focus_completed_today: cycle.focus_today,
            settings,
            as_of_ms: chrono::Utc::now().timestamp_millis(),
        })
    }

    fn resolve_context(
        &self,
        database: &Database,
        task_id: Option<String>,
        project_id: Option<String>,
    ) -> Result<(Option<String>, Option<String>), String> {
        let task_id = task_id.filter(|id| !id.is_empty());
        let mut project_id = project_id.filter(|id| !id.is_empty());
        if let Some(task_id) = &task_id {
            let task_project: Option<Option<String>> = database.with_connection(|connection| {
                connection
                    .query_row(
                        "SELECT project_id FROM tasks WHERE id = ?1",
                        [task_id],
                        |row| row.get(0),
                    )
                    .optional()
            })?;
            match task_project {
                None => return Err("La tarea no existe".to_string()),
                Some(task_project) => {
                    if project_id.is_none() {
                        project_id = task_project;
                    }
                }
            }
        }
        if let Some(project_id) = &project_id {
            let exists: bool = database.with_connection(|connection| {
                connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                    [project_id],
                    |row| row.get(0),
                )
            })?;
            if !exists {
                return Err("El proyecto no existe".to_string());
            }
        }
        Ok((task_id, project_id))
    }

    pub fn start_pomodoro(
        &self,
        database: &Database,
        input: StartPomodoro,
    ) -> Result<TimerSnapshot, String> {
        let mut inner = self.lock()?;
        self.start_pomodoro_locked(&mut inner, database, input)?;
        self.snapshot_locked(&inner, database)
    }

    fn start_pomodoro_locked(
        &self,
        inner: &mut Inner,
        database: &Database,
        input: StartPomodoro,
    ) -> Result<(), String> {
        let session_type = if input.session_type.is_empty() {
            "focus".to_string()
        } else {
            input.session_type
        };
        if !SESSION_TYPES.contains(&session_type.as_str()) {
            return Err("Tipo de sesión no válido".to_string());
        }
        let (settings, active, entry) = database.with_connection(|connection| {
            Ok((
                load_settings(connection)?,
                load_pomodoro(connection)?,
                load_entry(connection)?,
            ))
        })?;
        if active.is_some() {
            return Err("Ya hay una sesión en curso. Finalízala antes de empezar otra".to_string());
        }
        if session_type == "focus"
            && entry
                .as_ref()
                .is_some_and(|entry| entry.status == "running")
        {
            return Err(
                "El cronómetro manual está en marcha. Páusalo para no contar el tiempo dos veces"
                    .to_string(),
            );
        }
        let minutes = input
            .minutes
            .unwrap_or_else(|| minutes_for(&settings, &session_type));
        if !(1..=180).contains(&minutes) {
            return Err("La duración debe estar entre 1 y 180 minutos".to_string());
        }
        let (task_id, project_id) = if session_type == "focus" {
            self.resolve_context(database, input.task_id, input.project_id)?
        } else {
            (None, None)
        };
        let id = Uuid::new_v4().to_string();
        let wall = self.clock.wall();
        let planned = minutes * 60;
        database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO pomodoro_sessions(id, task_id, project_id, session_type, status,
                    planned_seconds, elapsed_seconds, started_at, resumed_at, expected_end_at,
                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'running', ?5, 0, ?6, ?6, ?7, ?6, ?6)",
                params![
                    id,
                    task_id,
                    project_id,
                    session_type,
                    planned,
                    wall,
                    wall + planned
                ],
            )?;
            Ok(())
        })?;
        inner.anchors.insert(id, self.clock.awake());
        self.mark_dirty(inner);
        Ok(())
    }

    fn pause_pomodoro_locked(
        &self,
        inner: &mut Inner,
        database: &Database,
        row: &PomodoroRow,
    ) -> Result<(), String> {
        let exact = self.elapsed(inner, &row.id, row.elapsed, &row.status);
        let elapsed = self.settle(inner, &row.id, exact).min(row.planned);
        let wall = self.clock.wall();
        database.with_connection(|connection| {
            connection.execute(
                "UPDATE pomodoro_sessions SET status = 'paused', elapsed_seconds = ?1,
                    paused_at = ?2, expected_end_at = NULL, updated_at = ?2
                 WHERE id = ?3",
                params![elapsed, wall, row.id],
            )?;
            Ok(())
        })?;
        inner.anchors.remove(&row.id);
        self.mark_dirty(inner);
        Ok(())
    }

    fn require_pomodoro(&self, database: &Database) -> Result<PomodoroRow, String> {
        database
            .with_connection(load_pomodoro)?
            .ok_or_else(|| "No hay ninguna sesión en curso".to_string())
    }

    pub fn pause_pomodoro(&self, database: &Database) -> Result<TimerSnapshot, String> {
        let mut inner = self.lock()?;
        let row = self.require_pomodoro(database)?;
        if row.status != "running" {
            return Err("La sesión ya está en pausa".to_string());
        }
        self.pause_pomodoro_locked(&mut inner, database, &row)?;
        self.snapshot_locked(&inner, database)
    }

    pub fn resume_pomodoro(&self, database: &Database) -> Result<TimerSnapshot, String> {
        let mut inner = self.lock()?;
        let row = self.require_pomodoro(database)?;
        if row.status != "paused" {
            return Err("La sesión no está en pausa".to_string());
        }
        if row.session_type == "focus" {
            let entry = database.with_connection(load_entry)?;
            if entry.is_some_and(|entry| entry.status == "running") {
                return Err(
                    "El cronómetro manual está en marcha. Páusalo para no contar el tiempo dos veces"
                        .to_string(),
                );
            }
        }
        let wall = self.clock.wall();
        database.with_connection(|connection| {
            connection.execute(
                "UPDATE pomodoro_sessions SET status = 'running', resumed_at = ?1,
                    paused_at = NULL, expected_end_at = ?2, updated_at = ?1
                 WHERE id = ?3",
                params![wall, wall + (row.planned - row.elapsed).max(0), row.id],
            )?;
            Ok(())
        })?;
        inner.anchors.insert(row.id.clone(), self.clock.awake());
        self.mark_dirty(&mut inner);
        self.snapshot_locked(&inner, database)
    }

    /// Termina la sesión antes de tiempo. Se conserva el tiempo trabajado.
    pub fn stop_pomodoro(&self, database: &Database) -> Result<TimerSnapshot, String> {
        let mut inner = self.lock()?;
        let row = self.require_pomodoro(database)?;
        let exact = self.elapsed(&inner, &row.id, row.elapsed, &row.status);
        let elapsed = (exact.as_secs() as i64).min(row.planned);
        let wall = self.clock.wall();
        let status = if elapsed >= row.planned {
            "completed"
        } else {
            "cancelled"
        };
        database.with_connection_mut(|connection| {
            let transaction = connection.transaction()?;
            transaction.execute(
                "UPDATE pomodoro_sessions SET status = ?1, elapsed_seconds = ?2, completed_at = ?3,
                    paused_at = NULL, expected_end_at = NULL, updated_at = ?3
                 WHERE id = ?4",
                params![status, elapsed, wall, row.id],
            )?;
            if row.session_type == "focus" && elapsed >= MIN_FOCUS_ENTRY_SECONDS {
                insert_focus_entry(&transaction, &row, elapsed, wall)?;
            }
            transaction.commit()
        })?;
        inner.anchors.remove(&row.id);
        self.mark_dirty(&mut inner);
        self.snapshot_locked(&inner, database)
    }

    /// Acción única para atajo de teclado y barra de menú.
    pub fn toggle_pomodoro(&self, database: &Database) -> Result<TimerSnapshot, String> {
        match database.with_connection(load_pomodoro)? {
            Some(row) if row.status == "running" => self.pause_pomodoro(database),
            Some(_) => self.resume_pomodoro(database),
            None => {
                let next = self.snapshot(database)?.next_session_type;
                self.start_pomodoro(
                    database,
                    StartPomodoro {
                        session_type: next,
                        ..StartPomodoro::default()
                    },
                )
            }
        }
    }

    fn require_entry(&self, database: &Database) -> Result<EntryRow, String> {
        database
            .with_connection(load_entry)?
            .ok_or_else(|| "No hay ningún cronómetro en marcha".to_string())
    }

    pub fn start_entry(
        &self,
        database: &Database,
        input: EntryInput,
    ) -> Result<TimerSnapshot, String> {
        let mut inner = self.lock()?;
        let description = input.description.trim().to_string();
        if description.chars().count() > 240 {
            return Err("La descripción no puede superar 240 caracteres".to_string());
        }
        let (active, pomodoro) = database.with_connection(|connection| {
            Ok((load_entry(connection)?, load_pomodoro(connection)?))
        })?;
        if active.is_some() {
            return Err(
                "Ya hay un cronómetro en marcha. Finalízalo antes de empezar otro".to_string(),
            );
        }
        if pomodoro.is_some_and(|row| row.session_type == "focus" && row.status == "running") {
            return Err(
                "Hay un Pomodoro de enfoque en marcha: ya está registrando este tiempo".to_string(),
            );
        }
        let (task_id, project_id) =
            self.resolve_context(database, input.task_id, input.project_id)?;
        let id = Uuid::new_v4().to_string();
        let wall = self.clock.wall();
        database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO time_entries(id, task_id, project_id, source, status, started_at,
                    resumed_at, duration_seconds, description, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'manual', 'running', ?4, ?4, 0, ?5, ?4, ?4)",
                params![id, task_id, project_id, wall, description],
            )?;
            Ok(())
        })?;
        inner.anchors.insert(id, self.clock.awake());
        self.mark_dirty(&mut inner);
        self.snapshot_locked(&inner, database)
    }

    fn pause_entry_locked(
        &self,
        inner: &mut Inner,
        database: &Database,
        row: &EntryRow,
    ) -> Result<(), String> {
        let exact = self.elapsed(inner, &row.id, row.elapsed, &row.status);
        let elapsed = self.settle(inner, &row.id, exact);
        let wall = self.clock.wall();
        database.with_connection(|connection| {
            connection.execute(
                "UPDATE time_entries SET status = 'paused', duration_seconds = ?1, updated_at = ?2
                 WHERE id = ?3",
                params![elapsed, wall, row.id],
            )?;
            refresh_task_time(connection, row.task_id.as_deref())
        })?;
        inner.anchors.remove(&row.id);
        self.mark_dirty(inner);
        Ok(())
    }

    pub fn pause_entry(&self, database: &Database) -> Result<TimerSnapshot, String> {
        let mut inner = self.lock()?;
        let row = self.require_entry(database)?;
        if row.status != "running" {
            return Err("El cronómetro ya está en pausa".to_string());
        }
        self.pause_entry_locked(&mut inner, database, &row)?;
        self.snapshot_locked(&inner, database)
    }

    pub fn resume_entry(&self, database: &Database) -> Result<TimerSnapshot, String> {
        let mut inner = self.lock()?;
        let row = self.require_entry(database)?;
        if row.status != "paused" {
            return Err("El cronómetro no está en pausa".to_string());
        }
        let pomodoro = database.with_connection(load_pomodoro)?;
        if pomodoro.is_some_and(|row| row.session_type == "focus" && row.status == "running") {
            return Err(
                "Hay un Pomodoro de enfoque en marcha: ya está registrando este tiempo".to_string(),
            );
        }
        let wall = self.clock.wall();
        database.with_connection(|connection| {
            connection.execute(
                "UPDATE time_entries SET status = 'running', resumed_at = ?1, updated_at = ?1
                 WHERE id = ?2",
                params![wall, row.id],
            )?;
            Ok(())
        })?;
        inner.anchors.insert(row.id.clone(), self.clock.awake());
        self.mark_dirty(&mut inner);
        self.snapshot_locked(&inner, database)
    }

    pub fn stop_entry(&self, database: &Database) -> Result<TimerSnapshot, String> {
        let mut inner = self.lock()?;
        let row = self.require_entry(database)?;
        let elapsed = self
            .elapsed(&inner, &row.id, row.elapsed, &row.status)
            .as_secs() as i64;
        let wall = self.clock.wall();
        database.with_connection(|connection| {
            if elapsed == 0 {
                connection.execute("DELETE FROM time_entries WHERE id = ?1", [&row.id])?;
            } else {
                connection.execute(
                    "UPDATE time_entries SET status = 'completed', duration_seconds = ?1,
                        ended_at = ?2, updated_at = ?2
                     WHERE id = ?3",
                    params![elapsed, wall, row.id],
                )?;
            }
            refresh_task_time(connection, row.task_id.as_deref())
        })?;
        inner.anchors.remove(&row.id);
        self.mark_dirty(&mut inner);
        self.snapshot_locked(&inner, database)
    }

    /// Olvida el ancla de un registro eliminado desde la lista de tiempos.
    pub fn forget(&self, id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.anchors.remove(id);
            self.mark_dirty(&mut inner);
        }
    }

    /// Pausa todo lo que esté en marcha guardando el tiempo exacto (salida de la app).
    pub fn suspend_all(&self, database: &Database) -> Result<bool, String> {
        let mut inner = self.lock()?;
        self.pause_running(&mut inner, database)
    }

    fn pause_running(&self, inner: &mut Inner, database: &Database) -> Result<bool, String> {
        let (pomodoro, entry) = database.with_connection(|connection| {
            Ok((load_pomodoro(connection)?, load_entry(connection)?))
        })?;
        let mut paused = false;
        if let Some(row) = pomodoro.filter(|row| row.status == "running") {
            self.pause_pomodoro_locked(inner, database, &row)?;
            paused = true;
        }
        if let Some(row) = entry.filter(|row| row.status == "running") {
            self.pause_entry_locked(inner, database, &row)?;
            paused = true;
        }
        Ok(paused)
    }

    /// Un ciclo del servicio: detecta reposo, completa sesiones y guarda puntos de control.
    pub fn tick(&self, database: &Database) -> Result<TickReport, String> {
        let mut inner = self.lock()?;
        let mut report = TickReport::default();
        let awake = self.clock.awake();
        let gap = self.clock.continuous().saturating_sub(awake);
        let slept = gap.saturating_sub(inner.last_gap) > SLEEP_THRESHOLD;
        inner.last_gap = gap;

        if slept && self.pause_running(&mut inner, database)? {
            report.changed = true;
            report.paused_after_sleep = true;
        }

        let (pomodoro, settings) = database.with_connection(|connection| {
            Ok((load_pomodoro(connection)?, load_settings(connection)?))
        })?;
        if let Some(row) = pomodoro.filter(|row| row.status == "running") {
            let elapsed = self.elapsed(&inner, &row.id, row.elapsed, &row.status);
            if elapsed >= Duration::from_secs(row.planned as u64) {
                report.completed =
                    Some(self.complete_locked(&mut inner, database, &row, &settings)?);
                report.changed = true;
            }
        }

        if awake.saturating_sub(inner.last_checkpoint) >= CHECKPOINT_EVERY {
            self.checkpoint(&mut inner, database)?;
            inner.last_checkpoint = awake;
        }

        let (pomodoro, entry) = database.with_connection(|connection| {
            Ok((load_pomodoro(connection)?, load_entry(connection)?))
        })?;
        let mut wait = IDLE_WAIT;
        let mut running = false;
        if let Some(row) = pomodoro.filter(|row| row.status == "running") {
            running = true;
            let elapsed = self.elapsed(&inner, &row.id, row.elapsed, &row.status);
            let remaining = Duration::from_secs(row.planned as u64).saturating_sub(elapsed);
            // Despierta al terminar y cada vez que cambia el minuto visible en la barra de menú.
            let to_next_minute =
                Duration::from_nanos((remaining.as_nanos() % 60_000_000_000) as u64);
            wait = wait.min(remaining).min(if to_next_minute.is_zero() {
                Duration::from_secs(60)
            } else {
                to_next_minute
            });
        }
        if let Some(row) = entry.filter(|row| row.status == "running") {
            running = true;
            let elapsed = self.elapsed(&inner, &row.id, row.elapsed, &row.status);
            let past_minute = Duration::from_nanos((elapsed.as_nanos() % 60_000_000_000) as u64);
            wait = wait.min(Duration::from_secs(60) - past_minute);
        }
        if running {
            let since_checkpoint = awake.saturating_sub(inner.last_checkpoint);
            wait = wait.min(CHECKPOINT_EVERY.saturating_sub(since_checkpoint));
        }
        report.running = running;
        report.next_wait = wait.max(Duration::from_millis(200));
        Ok(report)
    }

    fn checkpoint(&self, inner: &mut Inner, database: &Database) -> Result<(), String> {
        let (pomodoro, entry) = database.with_connection(|connection| {
            Ok((load_pomodoro(connection)?, load_entry(connection)?))
        })?;
        let wall = self.clock.wall();
        if let Some(row) = pomodoro.filter(|row| row.status == "running") {
            let exact = self.elapsed(inner, &row.id, row.elapsed, &row.status);
            let elapsed = self.settle(inner, &row.id, exact).min(row.planned);
            database.with_connection(|connection| {
                connection.execute(
                    "UPDATE pomodoro_sessions SET elapsed_seconds = ?1, updated_at = ?2 WHERE id = ?3",
                    params![elapsed, wall, row.id],
                )?;
                Ok(())
            })?;
        }
        if let Some(row) = entry.filter(|row| row.status == "running") {
            let exact = self.elapsed(inner, &row.id, row.elapsed, &row.status);
            let elapsed = self.settle(inner, &row.id, exact);
            database.with_connection(|connection| {
                connection.execute(
                    "UPDATE time_entries SET duration_seconds = ?1, updated_at = ?2 WHERE id = ?3",
                    params![elapsed, wall, row.id],
                )?;
                Ok(())
            })?;
        }
        Ok(())
    }

    fn complete_locked(
        &self,
        inner: &mut Inner,
        database: &Database,
        row: &PomodoroRow,
        settings: &PomodoroSettings,
    ) -> Result<CompletedSession, String> {
        let wall = self.clock.wall();
        database.with_connection_mut(|connection| {
            let transaction = connection.transaction()?;
            transaction.execute(
                "UPDATE pomodoro_sessions SET status = 'completed', elapsed_seconds = planned_seconds,
                    completed_at = ?1, paused_at = NULL, expected_end_at = NULL, updated_at = ?1
                 WHERE id = ?2",
                params![wall, row.id],
            )?;
            if row.session_type == "focus" {
                insert_focus_entry(&transaction, row, row.planned, wall)?;
            }
            transaction.execute(
                "INSERT OR IGNORE INTO notification_history(id, notification_type, title,
                    delivered_at, deduplication_key)
                 VALUES (?1, 'pomodoro', ?2, ?3, ?4)",
                params![
                    Uuid::new_v4().to_string(),
                    row.session_type,
                    wall,
                    format!("pomodoro:{}", row.id)
                ],
            )?;
            transaction.commit()
        })?;
        inner.anchors.remove(&row.id);

        let next = database
            .with_connection(|connection| cycle(connection, wall, settings.long_break_every))?
            .next_session_type;
        let auto_start = if next == "focus" {
            settings.auto_start_focus
        } else {
            settings.auto_start_breaks
        };
        let mut auto_started = false;
        if auto_start {
            // Un enfoque encadenado retoma la tarea del último enfoque.
            let (task_id, project_id) = if next == "focus" {
                database.with_connection(|connection| {
                    connection
                        .query_row(
                            "SELECT task_id, project_id FROM pomodoro_sessions
                             WHERE session_type = 'focus' ORDER BY started_at DESC LIMIT 1",
                            [],
                            |row| Ok((row.get(0)?, row.get(1)?)),
                        )
                        .optional()
                        .map(Option::unwrap_or_default)
                })?
            } else {
                (None, None)
            };
            auto_started = self
                .start_pomodoro_locked(
                    inner,
                    database,
                    StartPomodoro {
                        session_type: next.clone(),
                        minutes: None,
                        task_id,
                        project_id,
                    },
                )
                .is_ok();
        }
        self.mark_dirty(inner);
        Ok(CompletedSession {
            session_type: row.session_type.clone(),
            next_minutes: minutes_for(settings, &next),
            next_session_type: next,
            auto_started,
            notify: settings.notifications,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::background::clock::testing::ManualClock;
    use std::sync::Arc;

    struct Shared(Arc<ManualClock>);
    impl Clock for Shared {
        fn awake(&self) -> Duration {
            self.0.awake()
        }
        fn continuous(&self) -> Duration {
            self.0.continuous()
        }
        fn wall(&self) -> i64 {
            self.0.wall()
        }
    }

    fn setup() -> (Database, TimerService, Arc<ManualClock>) {
        let clock = Arc::new(ManualClock::new(chrono::Utc::now().timestamp()));
        let service = TimerService::new(Box::new(Shared(clock.clone())));
        (Database::in_memory(), service, clock)
    }

    fn focus(minutes: i64) -> StartPomodoro {
        StartPomodoro {
            session_type: "focus".to_string(),
            minutes: Some(minutes),
            ..StartPomodoro::default()
        }
    }

    fn query(database: &Database, sql: &str) -> i64 {
        database
            .with_connection(|connection| connection.query_row(sql, [], |row| row.get(0)))
            .expect("query")
    }

    #[test]
    fn counts_down_and_completes_with_time_entry() {
        let (database, service, clock) = setup();
        let snapshot = service.start_pomodoro(&database, focus(25)).expect("start");
        assert_eq!(snapshot.pomodoro.as_ref().unwrap().remaining_seconds, 1500);

        clock.advance(600);
        let snapshot = service.snapshot(&database).expect("snapshot");
        assert_eq!(snapshot.pomodoro.unwrap().remaining_seconds, 900);
        let report = service.tick(&database).expect("tick");
        assert!(report.completed.is_none());
        assert!(report.next_wait <= Duration::from_secs(60));

        clock.advance(900);
        let report = service.tick(&database).expect("tick");
        let completed = report.completed.expect("completed");
        assert_eq!(completed.session_type, "focus");
        assert_eq!(completed.next_session_type, "short_break");
        assert!(!completed.auto_started);
        assert_eq!(
            query(
                &database,
                "SELECT SUM(duration_seconds) FROM time_entries WHERE source = 'pomodoro'"
            ),
            1500
        );
        assert!(service.snapshot(&database).unwrap().pomodoro.is_none());
        // Un segundo ciclo no vuelve a completar ni a notificar.
        assert!(service.tick(&database).unwrap().completed.is_none());
        assert_eq!(
            query(&database, "SELECT COUNT(*) FROM notification_history"),
            1
        );
    }

    #[test]
    fn pause_freezes_time_and_resume_continues() {
        let (database, service, clock) = setup();
        service.start_pomodoro(&database, focus(25)).expect("start");
        clock.advance(300);
        service.pause_pomodoro(&database).expect("pause");
        clock.advance(3_600);
        let paused = service.snapshot(&database).unwrap().pomodoro.unwrap();
        assert_eq!(paused.status, "paused");
        assert_eq!(paused.elapsed_seconds, 300);
        service.resume_pomodoro(&database).expect("resume");
        clock.advance(100);
        assert_eq!(
            service
                .snapshot(&database)
                .unwrap()
                .pomodoro
                .unwrap()
                .elapsed_seconds,
            400
        );
    }

    #[test]
    fn system_sleep_pauses_running_timers() {
        let (database, service, clock) = setup();
        service.start_pomodoro(&database, focus(25)).expect("start");
        clock.advance(120);
        clock.sleep(7_200);
        let report = service.tick(&database).expect("tick");
        assert!(report.paused_after_sleep);
        let pomodoro = service.snapshot(&database).unwrap().pomodoro.unwrap();
        assert_eq!(pomodoro.status, "paused");
        assert_eq!(pomodoro.elapsed_seconds, 120);
    }

    #[test]
    fn wall_clock_changes_do_not_alter_elapsed_time() {
        let (database, service, clock) = setup();
        service.start_pomodoro(&database, focus(25)).expect("start");
        clock.advance(60);
        clock.shift_wall(-86_400);
        clock.advance(60);
        clock.shift_wall(7_200);
        let pomodoro = service.snapshot(&database).unwrap().pomodoro.unwrap();
        assert_eq!(pomodoro.elapsed_seconds, 120);
        assert!(service.tick(&database).unwrap().completed.is_none());
    }

    #[test]
    fn long_break_after_configured_focus_sessions() {
        let (database, service, clock) = setup();
        let mut next = Vec::new();
        for _ in 0..4 {
            service.start_pomodoro(&database, focus(1)).expect("focus");
            clock.advance(60);
            next.push(
                service
                    .tick(&database)
                    .unwrap()
                    .completed
                    .unwrap()
                    .next_session_type,
            );
            service
                .start_pomodoro(
                    &database,
                    StartPomodoro {
                        session_type: next.last().unwrap().clone(),
                        minutes: Some(1),
                        ..StartPomodoro::default()
                    },
                )
                .expect("break");
            clock.advance(60);
            service.tick(&database).unwrap();
        }
        assert_eq!(
            next,
            ["short_break", "short_break", "short_break", "long_break"]
        );
        let snapshot = service.snapshot(&database).unwrap();
        assert_eq!(snapshot.focus_completed_today, 4);
        assert_eq!(snapshot.cycle_position, 0);
        assert_eq!(snapshot.next_session_type, "focus");
    }

    #[test]
    fn auto_start_chains_the_break() {
        let (database, service, clock) = setup();
        database
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE settings SET value = json_set(value, '$.autoStartBreaks', json('true'))
                     WHERE key = 'pomodoro'",
                    [],
                )
            })
            .expect("settings");
        service.start_pomodoro(&database, focus(1)).expect("focus");
        clock.advance(60);
        assert!(
            service
                .tick(&database)
                .unwrap()
                .completed
                .unwrap()
                .auto_started
        );
        let pomodoro = service.snapshot(&database).unwrap().pomodoro.unwrap();
        assert_eq!(pomodoro.session_type, "short_break");
        assert_eq!(pomodoro.status, "running");
    }

    #[test]
    fn early_stop_records_worked_time_only_after_a_minute() {
        let (database, service, clock) = setup();
        service.start_pomodoro(&database, focus(25)).expect("start");
        clock.advance(30);
        service.stop_pomodoro(&database).expect("stop");
        assert_eq!(query(&database, "SELECT COUNT(*) FROM time_entries"), 0);
        assert_eq!(
            query(
                &database,
                "SELECT COUNT(*) FROM pomodoro_sessions WHERE status = 'cancelled'"
            ),
            1
        );

        service.start_pomodoro(&database, focus(25)).expect("start");
        clock.advance(600);
        service.stop_pomodoro(&database).expect("stop");
        assert_eq!(
            query(&database, "SELECT SUM(duration_seconds) FROM time_entries"),
            600
        );
    }

    #[test]
    fn manual_entries_update_task_time() {
        let (database, service, clock) = setup();
        database
            .with_connection(|connection| {
                connection.execute("INSERT INTO tasks(id, title) VALUES ('t1', 'Informe')", [])
            })
            .expect("task");
        let snapshot = service
            .start_entry(
                &database,
                EntryInput {
                    task_id: Some("t1".to_string()),
                    ..EntryInput::default()
                },
            )
            .expect("start");
        assert_eq!(
            snapshot.entry.unwrap().context.task_title.as_deref(),
            Some("Informe")
        );
        clock.advance(90);
        service.pause_entry(&database).expect("pause");
        clock.advance(1_000);
        service.resume_entry(&database).expect("resume");
        clock.advance(30);
        service.stop_entry(&database).expect("stop");
        assert_eq!(
            query(
                &database,
                "SELECT tracked_seconds FROM tasks WHERE id = 't1'"
            ),
            120
        );
    }

    #[test]
    fn focus_and_manual_timer_do_not_overlap() {
        let (database, service, _clock) = setup();
        service
            .start_entry(&database, EntryInput::default())
            .expect("entry");
        assert!(service.start_pomodoro(&database, focus(25)).is_err());
        // Los descansos no registran tiempo, así que sí pueden coexistir.
        assert!(
            service
                .start_pomodoro(
                    &database,
                    StartPomodoro {
                        session_type: "short_break".to_string(),
                        ..StartPomodoro::default()
                    },
                )
                .is_ok()
        );
    }

    #[test]
    fn checkpoints_and_recovers_after_unexpected_exit() {
        let (database, service, clock) = setup();
        service.start_pomodoro(&database, focus(25)).expect("start");
        clock.advance(130);
        service.tick(&database).expect("checkpoint");
        assert_eq!(
            query(&database, "SELECT elapsed_seconds FROM pomodoro_sessions"),
            130
        );

        // Un proceso nuevo no tiene anclas: la sesión queda en pausa con lo guardado.
        let restarted = TimerService::new(Box::new(ManualClock::new(clock.wall())));
        assert_eq!(restarted.recover(&database).expect("recover"), 1);
        let pomodoro = restarted.snapshot(&database).unwrap().pomodoro.unwrap();
        assert_eq!(pomodoro.status, "paused");
        assert_eq!(pomodoro.elapsed_seconds, 130);
    }

    #[test]
    fn suspend_all_saves_exact_time_on_exit() {
        let (database, service, clock) = setup();
        service.start_pomodoro(&database, focus(25)).expect("start");
        clock.advance(42);
        assert!(service.suspend_all(&database).expect("suspend"));
        assert_eq!(
            query(&database, "SELECT elapsed_seconds FROM pomodoro_sessions"),
            42
        );
    }
}
