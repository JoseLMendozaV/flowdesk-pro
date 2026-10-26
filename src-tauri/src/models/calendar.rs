use crate::recurrence::RecurrenceRule;
use serde::{Deserialize, Serialize};

/// Los eventos de todo el día empiezan a medianoche local del primer día y terminan
/// a medianoche del día siguiente al último (fin exclusivo). En un evento que se repite,
/// `starts_at` y `ends_at` son los de la repetición y `series_starts_at` el de la primera.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub description: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub starts_at: i64,
    pub ends_at: i64,
    pub is_all_day: bool,
    pub location: Option<String>,
    pub reminder_minutes: Option<i64>,
    pub recurrence: Option<RecurrenceRule>,
    pub series_starts_at: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EventInput {
    pub title: String,
    pub description: String,
    pub project_id: Option<String>,
    pub starts_at: i64,
    pub ends_at: i64,
    pub is_all_day: bool,
    pub location: Option<String>,
    pub reminder_minutes: Option<i64>,
    pub recurrence: Option<RecurrenceRule>,
}

/// A qué repeticiones de un evento se aplica un cambio o un borrado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventScope {
    This,
    Following,
    All,
}

/// Tarea con fecha límite dentro del intervalo consultado.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarTask {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub due_at: i64,
    pub due_has_time: bool,
    pub project_color: Option<String>,
    /// Duración del bloque en la cuadrícula del calendario.
    pub estimated_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRange {
    pub events: Vec<CalendarEvent>,
    pub tasks: Vec<CalendarTask>,
}

/// Horas expresadas en minutos desde la medianoche local.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSettings {
    pub enabled: bool,
    pub task_lead_minutes: i64,
    pub daily_digest: bool,
    pub digest_minute: i64,
    pub quiet_hours: bool,
    pub quiet_start: i64,
    pub quiet_end: i64,
}

impl Default for ReminderSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            task_lead_minutes: 10,
            daily_digest: true,
            digest_minute: 9 * 60,
            quiet_hours: false,
            quiet_start: 22 * 60,
            quiet_end: 8 * 60,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderItem {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub title: String,
    pub remind_at: i64,
    pub status: String,
}
