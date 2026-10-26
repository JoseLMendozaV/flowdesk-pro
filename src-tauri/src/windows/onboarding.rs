use crate::{commands::onboarding, database::Database, windows};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder,
    webview::PageLoadEvent,
};

pub const LABEL: &str = "onboarding";
const MODES: &[&str] = &["welcome", "tour", "features", "whats-new", "shortcuts"];
const WIDTH: f64 = 900.0;
const HEIGHT: f64 = 620.0;
const MIN_WIDTH: f64 = 720.0;
const MIN_HEIGHT: f64 = 520.0;
/// Margen respecto al área útil del monitor (sin Dock ni barra de menús).
const SCREEN_MARGIN: f64 = 48.0;

/// La ventana se abrió como bienvenida inicial: cerrarla sin elegir cuenta como omitirla.
static PRESENTING_WELCOME: AtomicBool = AtomicBool::new(false);

/// Tamaño inicial acotado al monitor de la ventana principal, para pantallas pequeñas.
fn initial_size(app: &AppHandle) -> (f64, f64) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return (WIDTH, HEIGHT);
    };
    let area = monitor
        .work_area()
        .size
        .to_logical::<f64>(monitor.scale_factor());
    (
        WIDTH.min(area.width - SCREEN_MARGIN).max(MIN_WIDTH),
        HEIGHT.min(area.height - SCREEN_MARGIN).max(MIN_HEIGHT),
    )
}

/// Abre la bienvenida, el recorrido, el catálogo, las novedades o los atajos. Si la
/// ventana ya existe, cambia de modo y se enfoca: nunca hay dos.
pub fn validate_mode(mode: &str) -> Result<(), String> {
    if MODES.contains(&mode) {
        Ok(())
    } else {
        Err("Modo de la guía no válido".to_string())
    }
}

/// La ventana se cierra para la visita guiada y volverá a abrirse después: no cuenta
/// como cerrar la bienvenida.
pub fn suspend_welcome() {
    PRESENTING_WELCOME.store(false, Ordering::SeqCst);
}

pub fn open(app: &AppHandle, mode: &str, feature_id: Option<&str>) -> Result<(), String> {
    validate_mode(mode)?;
    if mode == "welcome" {
        PRESENTING_WELCOME.store(true, Ordering::SeqCst);
    }
    // El dashboard queda disponible detrás, también al abrirla desde la barra de menú.
    windows::hide_tray_panel(app);
    windows::show_main_window(app);

    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.emit_to(
            LABEL,
            "flowdesk://onboarding-open",
            serde_json::json!({ "mode": mode, "featureId": feature_id }),
        );
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let mut url = format!("index.html?view=onboarding&mode={mode}");
    if let Some(feature_id) = feature_id {
        url.push_str("&feature=");
        url.push_str(feature_id);
    }
    let (width, height) = initial_size(app);
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(url.into()))
        .title("Bienvenida a FlowDesk Pro")
        .inner_size(width, height)
        .min_inner_size(MIN_WIDTH.min(width), MIN_HEIGHT.min(height))
        .center()
        .maximizable(false)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .visible(false)
        // Se muestra cuando la página ya pintó, sin destello blanco en modo oscuro.
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
}

/// Al destruirse la ventana. Si era la bienvenida y estaba pendiente, queda como omitida;
/// seguirá abriéndose al iniciar mientras el usuario no la desactive.
pub fn on_destroyed(app: &AppHandle) {
    if !PRESENTING_WELCOME.swap(false, Ordering::SeqCst) {
        return;
    }
    if let Some(database) = app.try_state::<Database>()
        && onboarding::dismiss_welcome(&database, &app.package_info().version.to_string())
            .unwrap_or(false)
    {
        let _ = app.emit("flowdesk://data-changed", "onboarding");
    }
}
