use super::ExcludedApp;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppTrackingSettings {
    pub enabled: bool,
    pub paused: bool,
    /// Minutos sin teclado ni ratón tras los que se deja de contar.
    pub idle_minutes: i64,
    pub retention_days: i64,
    pub excluded_apps: Vec<ExcludedApp>,
}

impl Default for AppTrackingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            paused: false,
            idle_minutes: 5,
            retention_days: 90,
            excluded_apps: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    pub bundle_id: String,
    pub app_name: String,
    pub today_seconds: i64,
    pub week_seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUsageReport {
    pub apps: Vec<AppUsage>,
    pub today_seconds: i64,
    pub week_seconds: i64,
    /// App que se está midiendo ahora, si la hay.
    pub current_app: Option<String>,
}
