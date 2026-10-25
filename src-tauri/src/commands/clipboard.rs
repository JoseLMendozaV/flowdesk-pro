use crate::{
    background::clipboard::{
        self, ClipContent, ClipboardService, PREVIEW_CHARS, load_settings, validate_settings,
    },
    database::Database,
    models::{ClipboardItem, ClipboardSettings},
};
use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use tauri::{AppHandle, Emitter, State, ipc::Response};
use uuid::Uuid;

fn notify(app: &AppHandle) {
    let _ = app.emit("flowdesk://data-changed", "clipboard");
}

fn require_id(item_id: &str) -> Result<(), String> {
    Uuid::parse_str(item_id)
        .map(|_| ())
        .map_err(|_| "Identificador no válido".to_string())
}

pub fn store_settings(database: &Database, settings: &ClipboardSettings) -> Result<(), String> {
    validate_settings(settings)?;
    let value = serde_json::to_string(settings).map_err(|error| error.to_string())?;
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES ('clipboard', ?1, unixepoch())
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            [value],
        )?;
        Ok(())
    })
}

/// Las posibles credenciales (solo si el usuario decidió guardarlas) nunca llegan a
/// la interfaz: se muestran ocultas y solo se pueden volver a copiar.
pub fn query_items(
    database: &Database,
    search: Option<&str>,
    favorites_only: bool,
) -> Result<Vec<ClipboardItem>, String> {
    let search = search.map(str::trim).filter(|value| !value.is_empty());
    if search.is_some_and(|value| value.chars().count() > 200) {
        return Err("La búsqueda no puede superar 200 caracteres".to_string());
    }
    let pattern = search.map(|value| {
        let escaped = value
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        format!("%{escaped}%")
    });
    database.with_connection(|connection| {
        connection
            .prepare(
                "SELECT id, content_type,
                    CASE WHEN is_sensitive = 1 THEN NULL ELSE substr(text_content, 1, ?3) END,
                    COALESCE(length(text_content), 0), byte_size, source_app, is_favorite,
                    is_sensitive, created_at
                 FROM clipboard_items
                 WHERE (?1 IS NULL OR (is_sensitive = 0 AND text_content LIKE ?1 ESCAPE '\\'))
                 AND (?2 = 0 OR is_favorite = 1)
                 ORDER BY created_at DESC, rowid DESC LIMIT 500",
            )?
            .query_map(params![pattern, favorites_only, PREVIEW_CHARS], |row| {
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    preview: row.get(2)?,
                    char_count: row.get(3)?,
                    byte_size: row.get(4)?,
                    source_app: row.get(5)?,
                    is_favorite: row.get(6)?,
                    is_sensitive: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .collect()
    })
}

fn load_content(database: &Database, item_id: &str) -> Result<ClipContent, String> {
    require_id(item_id)?;
    let (text, image_path) = database
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT text_content, image_path FROM clipboard_items WHERE id = ?1",
                    [item_id],
                    |row| {
                        Ok((
                            row.get::<_, Option<String>>(0)?,
                            row.get::<_, Option<String>>(1)?,
                        ))
                    },
                )
                .optional()
        })?
        .ok_or_else(|| "El elemento no existe".to_string())?;
    match (text, image_path) {
        (Some(text), _) => Ok(ClipContent::Text(text)),
        (None, Some(path)) => {
            let data = std::fs::read(&path).map_err(|_| "La imagen ya no existe".to_string())?;
            let extension = if path.ends_with(".png") {
                "png"
            } else {
                "tiff"
            };
            Ok(ClipContent::Image { data, extension })
        }
        _ => Err("El elemento está vacío".to_string()),
    }
}

#[tauri::command]
pub fn get_clipboard_settings(database: State<'_, Database>) -> Result<ClipboardSettings, String> {
    database.with_connection(load_settings)
}

#[tauri::command]
pub fn update_clipboard_settings(
    settings: ClipboardSettings,
    database: State<'_, Database>,
    service: State<'_, ClipboardService>,
    app: AppHandle,
) -> Result<ClipboardSettings, String> {
    store_settings(&database, &settings)?;
    clipboard::prune(&database, settings.max_items)?;
    service.wakeup.wake();
    notify(&app);
    Ok(settings)
}

#[tauri::command]
pub fn list_clipboard(
    search: Option<String>,
    favorites_only: bool,
    database: State<'_, Database>,
) -> Result<Vec<ClipboardItem>, String> {
    query_items(&database, search.as_deref(), favorites_only)
}

/// Copia de nuevo un elemento. La escritura propia no se vuelve a capturar: el
/// elemento sube al principio directamente.
#[tauri::command]
pub fn copy_clipboard_item(
    item_id: String,
    database: State<'_, Database>,
    service: State<'_, ClipboardService>,
    app: AppHandle,
) -> Result<(), String> {
    let content = load_content(&database, &item_id)?;
    #[cfg(target_os = "macos")]
    {
        let change_count = clipboard::pasteboard::write(&content)?;
        service.observe(change_count);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&content, &service);
        return Err("El portapapeles solo está disponible en macOS".to_string());
    }
    let now = Utc::now().timestamp();
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE clipboard_items SET created_at = ?1, last_used_at = ?1 WHERE id = ?2",
            params![now, item_id],
        )?;
        Ok(())
    })?;
    notify(&app);
    Ok(())
}

#[tauri::command]
pub fn set_clipboard_favorite(
    item_id: String,
    favorite: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    require_id(&item_id)?;
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE clipboard_items SET is_favorite = ?1 WHERE id = ?2",
            params![favorite, item_id],
        )?;
        Ok(())
    })?;
    notify(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_clipboard_item(
    item_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    require_id(&item_id)?;
    clipboard::remove(&database, Some(&item_id))?;
    notify(&app);
    Ok(())
}

/// Borra el historial salvo los favoritos.
#[tauri::command]
pub fn clear_clipboard(database: State<'_, Database>, app: AppHandle) -> Result<(), String> {
    clipboard::remove(&database, None)?;
    notify(&app);
    Ok(())
}

/// Bytes de una imagen guardada, sin pasar por JSON.
#[tauri::command]
pub fn get_clipboard_image(
    item_id: String,
    database: State<'_, Database>,
) -> Result<Response, String> {
    match load_content(&database, &item_id)? {
        ClipContent::Image { data, .. } => Ok(Response::new(data)),
        ClipContent::Text(_) => Err("El elemento no es una imagen".to_string()),
    }
}

/// Excluye una app elegida en el selector de archivos.
#[tauri::command]
pub fn exclude_clipboard_app(
    path: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<ClipboardSettings, String> {
    #[cfg(target_os = "macos")]
    let info = crate::background::macos::bundle_info(&path)
        .ok_or_else(|| "No es una aplicación válida".to_string())?;
    #[cfg(not(target_os = "macos"))]
    let info: crate::models::ExcludedApp = {
        let _ = &path;
        return Err("Solo disponible en macOS".to_string());
    };
    let mut settings = database.with_connection(load_settings)?;
    if !settings
        .excluded_apps
        .iter()
        .any(|excluded| excluded.bundle_id == info.bundle_id)
    {
        settings.excluded_apps.push(info);
    }
    store_settings(&database, &settings)?;
    notify(&app);
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::background::clipboard::{Clip, capture};

    #[test]
    fn lists_hide_sensitive_previews_and_search_escapes_wildcards() {
        let database = Database::in_memory();
        let settings = ClipboardSettings {
            enabled: true,
            skip_sensitive: false,
            ..ClipboardSettings::default()
        };
        for (index, value) in ["100% listo", "1000 listos", "Tr0ub4dor&3x"]
            .iter()
            .enumerate()
        {
            let clip = Clip {
                content: ClipContent::Text(value.to_string()),
                protected: false,
                source: None,
            };
            capture(
                &database,
                &std::env::temp_dir(),
                &settings,
                clip,
                index as i64,
            )
            .expect("capture");
        }
        let all = query_items(&database, None, false).expect("all");
        assert_eq!(all.len(), 3);
        assert!(all[0].is_sensitive && all[0].preview.is_none());
        let found = query_items(&database, Some("0%"), false).expect("search");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].preview.as_deref(), Some("100% listo"));
        assert!(
            query_items(&database, Some("Tr0ub"), false)
                .expect("hidden")
                .is_empty()
        );
        assert!(
            query_items(&database, None, true)
                .expect("favorites")
                .is_empty()
        );
        let text = load_content(&database, &all[0].id).expect("content");
        assert_eq!(text, ClipContent::Text("Tr0ub4dor&3x".to_string()));
    }
}
