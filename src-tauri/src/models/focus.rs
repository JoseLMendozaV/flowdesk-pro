use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSettings {
    pub focus_minutes: i64,
    pub short_break_minutes: i64,
    pub long_break_minutes: i64,
    pub long_break_every: i64,
    pub auto_start_breaks: bool,
    pub auto_start_focus: bool,
    pub notifications: bool,
}

impl Default for PomodoroSettings {
    fn default() -> Self {
        Self {
            focus_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            long_break_every: 4,
            auto_start_breaks: false,
            auto_start_focus: false,
            notifications: true,
        }
    }
}

/// Tarea y proyecto asociados a una sesión o registro, con sus nombres para mostrar.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkContext {
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivePomodoro {
    pub id: String,
    pub session_type: String,
    pub status: String,
    pub planned_seconds: i64,
    pub elapsed_seconds: i64,
    pub remaining_seconds: i64,
    pub started_at: i64,
    pub expected_end_at: Option<i64>,
    #[serde(flatten)]
    pub context: WorkContext,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveEntry {
    pub id: String,
    pub status: String,
    pub elapsed_seconds: i64,
    pub started_at: i64,
    pub description: String,
    #[serde(flatten)]
    pub context: WorkContext,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSnapshot {
    pub pomodoro: Option<ActivePomodoro>,
    pub entry: Option<ActiveEntry>,
    /// Tipo de sesión que corresponde a continuación según el ciclo.
    pub next_session_type: String,
    /// Sesiones de enfoque completadas hoy desde el último descanso largo.
    pub cycle_position: i64,
    pub focus_completed_today: i64,
    pub settings: PomodoroSettings,
    /// Hora de pared (ms) del cálculo; la interfaz solo la usa para animar la cuenta atrás.
    pub as_of_ms: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StartPomodoro {
    pub session_type: String,
    pub minutes: Option<i64>,
    pub task_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EntryInput {
    pub task_id: Option<String>,
    pub project_id: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: String,
    pub source: String,
    pub status: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_seconds: i64,
    pub description: String,
    #[serde(flatten)]
    pub context: WorkContext,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub session_type: String,
    pub status: String,
    pub planned_seconds: i64,
    pub elapsed_seconds: i64,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    #[serde(flatten)]
    pub context: WorkContext,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    pub day_start: i64,
    pub tracked_seconds: i64,
    pub focus_seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTime {
    pub project_id: Option<String>,
    pub name: Option<String>,
    pub color: Option<String>,
    pub seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeStats {
    pub week_start: i64,
    pub days: Vec<DayStat>,
    pub today_tracked_seconds: i64,
    pub today_focus_seconds: i64,
    pub week_tracked_seconds: i64,
    pub week_focus_seconds: i64,
    pub focus_sessions_today: i64,
    pub projects: Vec<ProjectTime>,
}
