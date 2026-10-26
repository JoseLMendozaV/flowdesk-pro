use crate::windows;
use tauri::{
    AppHandle, Runtime,
    menu::{HELP_SUBMENU_ID, Menu, MenuEvent, MenuItem, MenuItemKind},
};

pub const TOUR_ID: &str = "onboarding-tour";
pub const WHATS_NEW_ID: &str = "onboarding-whats-new";

/// Menú de la app: el predeterminado de Tauri con el recorrido y las novedades en Ayuda.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(help)) = menu.get(HELP_SUBMENU_ID) {
        help.set_text("Ayuda")?;
        help.append(&MenuItem::with_id(
            app,
            TOUR_ID,
            "Recorrido por FlowDesk",
            true,
            None::<&str>,
        )?)?;
        help.append(&MenuItem::with_id(
            app,
            WHATS_NEW_ID,
            "¿Qué hay de nuevo?",
            true,
            None::<&str>,
        )?)?;
    }
    Ok(menu)
}

/// Los manejadores de menú de Tauri son globales: este atiende las mismas acciones desde
/// la barra de menús de macOS y desde el menú del icono.
pub fn handle_event(app: &AppHandle, event: MenuEvent) {
    let mode = match event.id.as_ref() {
        TOUR_ID => "tour",
        WHATS_NEW_ID => "whats-new",
        _ => return,
    };
    let _ = windows::onboarding::open(app, mode, None);
}
