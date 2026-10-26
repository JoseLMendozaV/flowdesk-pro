use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Preferencias y progreso de la bienvenida. La revisión de cada funcionalidad
/// conocida permite anunciar tanto las nuevas como las que cambiaron de forma visible.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingState {
    pub welcome_status: String,
    pub completed_initial_onboarding: bool,
    pub show_welcome_on_startup: bool,
    pub show_whats_new_on_update: bool,
    pub resume_tour: bool,
    pub last_seen_app_version: Option<String>,
    pub last_seen_feature_revision: Option<String>,
    pub seen_features: BTreeMap<String, u32>,
    pub last_completed_step_id: Option<String>,
    pub last_onboarding_date: Option<i64>,
    /// Versión instalada, para comparar con la última que el usuario conoció.
    pub app_version: String,
    /// Módulos que este binario incluye; el registro solo presenta lo que aparece aquí.
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingPreferences {
    pub show_welcome_on_startup: bool,
    pub show_whats_new_on_update: bool,
    pub resume_tour: bool,
}
