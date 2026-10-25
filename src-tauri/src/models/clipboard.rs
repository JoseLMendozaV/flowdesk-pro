use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedApp {
    pub bundle_id: String,
    pub name: String,
}

/// `enabled` es el consentimiento; `paused` detiene la captura sin retirarlo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSettings {
    pub enabled: bool,
    pub paused: bool,
    pub max_items: i64,
    pub capture_images: bool,
    pub skip_sensitive: bool,
    pub excluded_apps: Vec<ExcludedApp>,
}

impl Default for ClipboardSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            paused: false,
            max_items: 200,
            capture_images: true,
            skip_sensitive: true,
            excluded_apps: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    pub content_type: String,
    /// Primeros caracteres del texto; el contenido completo solo se lee al copiarlo.
    pub preview: Option<String>,
    pub char_count: i64,
    pub byte_size: i64,
    pub source_app: Option<String>,
    pub is_favorite: bool,
    pub is_sensitive: bool,
    pub created_at: i64,
}
