use serde::Serialize;

mod app_tracking;
mod calendar;
mod clipboard;
mod focus;
mod onboarding;
mod projects;
mod tasks;
mod workspaces;

pub use app_tracking::{AppTrackingSettings, AppUsage, AppUsageReport};
pub use calendar::{
    CalendarEvent, CalendarRange, CalendarTask, EventInput, ReminderItem, ReminderSettings,
};
pub use clipboard::{ClipboardItem, ClipboardSettings, ExcludedApp};
pub use focus::{
    ActiveEntry, ActivePomodoro, DayStat, EntryInput, FocusSession, PomodoroSettings, ProjectTime,
    StartPomodoro, TimeEntry, TimeStats, TimerSnapshot, WorkContext,
};
pub use onboarding::{OnboardingPreferences, OnboardingState};
pub use projects::{ProjectDeleteMode, ProjectInput, ProjectSummary};
pub use tasks::{
    LinkedNote, Subtask, Tag, TaskDetail, TaskFilter, TaskInput, TaskSort, TaskSummary, TaskView,
};
pub use workspaces::{Workspace, WorkspaceInput, WorkspaceResource, WorkspaceState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardTask {
    pub id: String,
    pub title: String,
    pub priority: String,
    pub due_at: Option<i64>,
    pub due_has_time: bool,
    pub project_color: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardNote {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub color: String,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingEvent {
    pub id: String,
    pub title: String,
    pub starts_at: i64,
    pub is_all_day: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTimer {
    pub id: String,
    pub status: String,
    pub session_type: String,
    pub planned_seconds: i64,
    pub elapsed_seconds: i64,
    pub started_at: i64,
    pub expected_end_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub today_tasks: i64,
    pub overdue_tasks: i64,
    pub completed_today: i64,
    pub active_projects: i64,
    pub focus_seconds_today: i64,
    pub tracked_seconds_today: i64,
    pub completion_percent: f64,
    pub upcoming_tasks: Vec<DashboardTask>,
    pub recent_notes: Vec<DashboardNote>,
    pub next_event: Option<UpcomingEvent>,
    pub active_timer: Option<ActiveTimer>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayPreferences {
    pub launch_at_login: bool,
    pub launch_hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub color: String,
    pub project_id: Option<String>,
    pub reminder_at: Option<i64>,
    pub is_archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub window: NoteWindow,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteWindow {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: f64,
    pub height: f64,
    pub expanded_height: f64,
    pub opacity: f64,
    pub font_size: f64,
    pub display_mode: String,
    pub is_collapsed: bool,
    pub is_visible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub id: String,
    pub label: String,
    pub keys: String,
    pub registered: bool,
    pub error: Option<String>,
}
