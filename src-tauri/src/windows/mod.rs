use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_positioner::{Position, WindowExt};

/// Momento en que el panel se ocultó por perder el foco. Al pulsar el icono con el
/// panel abierto, macOS entrega primero la pérdida de foco y después el clic; sin
/// esta marca el mismo clic volvería a mostrar el panel recién ocultado.
static TRAY_PANEL_BLURRED_AT: Mutex<Option<Instant>> = Mutex::new(None);
const TRAY_REOPEN_GUARD: Duration = Duration::from_millis(300);

pub mod notes;
pub mod onboarding;

/// Informa a una ventana de si el usuario puede verla. Las ventanas ocultas aplazan
/// sus actualizaciones: WebKit mantiene un display link a la frecuencia del monitor
/// mientras una página oculta sigue repintando, y no lo suelta.
fn announce_visibility<R: Runtime>(app: &AppHandle<R>, label: &str, visible: bool) {
    let _ = app.emit(
        "flowdesk://visibility",
        serde_json::json!({ "label": label, "visible": visible }),
    );
}

/// Crea una ventana flotante (nota o panel del tray) con la app en modo accesorio.
///
/// macOS decide al crear la ventana si podrá entrar en el espacio de una app a
/// pantalla completa: solo lo permite si en ese momento la app es accesoria, y lo
/// conserva aunque después vuelva a ser regular. Una ventana creada en modo regular
/// nunca aparece ahí, ni siquiera con `FullScreenAuxiliary`. Comprobado con
/// ventanas de prueba en macOS 26 (docs/PHASE_04.md).
pub fn build_floating<R: Runtime, T>(app: &AppHandle<R>, build: impl FnOnce() -> T) -> T {
    #[cfg(target_os = "macos")]
    {
        let dashboard_visible = app
            .get_webview_window("main")
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        let result = build();
        if dashboard_visible {
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        }
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        build()
    }
}

/// Muestra la ventana en todos los escritorios, incluidos los de apps a pantalla
/// completa. Tauri solo expone `CanJoinAllSpaces`; falta `FullScreenAuxiliary`.
#[cfg(target_os = "macos")]
pub fn join_all_spaces<R: Runtime>(window: &WebviewWindow<R>, enabled: bool) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // SAFETY: Tauri devuelve el NSWindow vivo de esta ventana y estamos en el hilo principal.
        let ns_window = unsafe { &*pointer.cast::<NSWindow>() };
        let spaces = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary;
        let mut behavior = ns_window.collectionBehavior();
        if enabled {
            behavior = (behavior | spaces) & !NSWindowCollectionBehavior::MoveToActiveSpace;
        } else {
            behavior &= !spaces;
        }
        ns_window.setCollectionBehavior(behavior);
    });
}

#[cfg(not(target_os = "macos"))]
pub fn join_all_spaces<R: Runtime>(window: &WebviewWindow<R>, enabled: bool) {
    let _ = window.set_visible_on_all_workspaces(enabled);
}

pub fn create_tray_panel<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(
        app,
        "tray-panel",
        WebviewUrl::App("index.html?view=tray".into()),
    )
    .title("FlowDesk Pro")
    .inner_size(360.0, 520.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false);
    let window = build_floating(app, || builder.build())?;
    join_all_spaces(&window, true);
    Ok(())
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        announce_visibility(app, "main", true);
    }
}

pub fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        announce_visibility(app, "main", false);
    }
    enter_background_mode(app);
}

pub fn enter_background_mode<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

pub fn hide_tray_panel<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("tray-panel") {
        let _ = window.hide();
        announce_visibility(app, "tray-panel", false);
    }
}

pub fn hide_tray_panel_on_blur<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("tray-panel")
        && window.is_visible().unwrap_or(false)
    {
        if let Ok(mut blurred_at) = TRAY_PANEL_BLURRED_AT.lock() {
            *blurred_at = Some(Instant::now());
        }
        let _ = window.hide();
        announce_visibility(app, "tray-panel", false);
    }
}

pub fn toggle_tray_panel<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("tray-panel") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        announce_visibility(app, "tray-panel", false);
        return;
    }
    let hidden_by_this_click = TRAY_PANEL_BLURRED_AT
        .lock()
        .ok()
        .and_then(|mut blurred_at| blurred_at.take())
        .is_some_and(|instant| instant.elapsed() < TRAY_REOPEN_GUARD);
    if hidden_by_this_click {
        return;
    }
    let _ = window.move_window_constrained(Position::TrayBottomCenter);
    let _ = window.show();
    let _ = window.set_focus();
    announce_visibility(app, "tray-panel", true);
}
