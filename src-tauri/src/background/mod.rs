//! Servicios que siguen funcionando con todas las ventanas ocultas.

pub mod clock;
pub mod timer;

use crate::{database::Database, models::TimerSnapshot, tray};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
pub use timer::{CompletedSession, TimerService};

/// Comunica a todas las ventanas y a la barra de menú el estado de los temporizadores.
pub fn publish(app: &AppHandle, snapshot: &TimerSnapshot) {
    let _ = app.emit("flowdesk://timer-changed", snapshot);
    let _ = app.emit("flowdesk://data-changed", "time");
    tray::show_timer(app, snapshot);
}

/// Acción común del atajo global, el menú y el panel de la barra de menú.
pub fn toggle_pomodoro(app: &AppHandle) {
    let service = app.state::<TimerService>();
    let database = app.state::<Database>();
    match service.toggle_pomodoro(&database) {
        Ok(snapshot) => publish(app, &snapshot),
        // Sin ventana visible, el aviso es la única forma de explicar el rechazo.
        Err(error) => notify(app, "Pomodoro", &error),
    }
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn notify_completed(app: &AppHandle, session: &CompletedSession) {
    let next = match session.next_session_type.as_str() {
        "long_break" => format!("descanso largo de {} min", session.next_minutes),
        "short_break" => format!("descanso de {} min", session.next_minutes),
        _ => format!("sesión de enfoque de {} min", session.next_minutes),
    };
    let (title, body) = if session.session_type == "focus" {
        (
            "Sesión de enfoque completada",
            if session.auto_started {
                format!("Tu {next} ya está en marcha.")
            } else {
                format!("Es momento de un {next}.")
            },
        )
    } else {
        (
            "Descanso terminado",
            if session.auto_started {
                format!("La {next} ya está en marcha.")
            } else {
                "¿Lista la siguiente sesión de enfoque?".to_string()
            },
        )
    };
    notify(app, title, &body);
}

/// Evita que App Nap retrase el hilo mientras haya un temporizador en marcha.
#[derive(Default)]
struct ActivityAssertion {
    #[cfg(target_os = "macos")]
    token: Option<
        objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2::runtime::NSObjectProtocol>>,
    >,
}

impl ActivityAssertion {
    #[cfg(target_os = "macos")]
    fn set(&mut self, active: bool) {
        use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

        let info = NSProcessInfo::processInfo();
        match (active, self.token.take()) {
            (true, None) => {
                let reason = NSString::from_str("Temporizador de FlowDesk en marcha");
                self.token = Some(info.beginActivityWithOptions_reason(
                    NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
                    &reason,
                ));
            }
            (false, Some(token)) => {
                // SAFETY: el token procede de `beginActivityWithOptions_reason`.
                unsafe { info.endActivity(&token) };
            }
            (_, token) => self.token = token,
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn set(&mut self, _active: bool) {}
}

pub fn spawn_ticker(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("flowdesk-timers".to_string())
        .spawn(move || {
            let mut activity = ActivityAssertion::default();
            loop {
                let service = app.state::<TimerService>();
                let database = app.state::<Database>();
                let wait = match service.tick(&database) {
                    Ok(report) => {
                        activity.set(report.running);
                        let snapshot = service.snapshot(&database).ok();
                        if let Some(snapshot) = &snapshot {
                            if report.changed {
                                publish(&app, snapshot);
                            } else {
                                // Cambio de minuto: solo el título de la barra de menú.
                                tray::show_timer(&app, snapshot);
                            }
                        }
                        let notifications =
                            snapshot.is_some_and(|snapshot| snapshot.settings.notifications);
                        if let Some(completed) = report.completed.filter(|session| session.notify) {
                            notify_completed(&app, &completed);
                        }
                        if report.paused_after_sleep && notifications {
                            notify(
                                &app,
                                "Temporizador en pausa",
                                "El Mac estuvo en reposo. Reanúdalo cuando vuelvas.",
                            );
                        }
                        report.next_wait
                    }
                    Err(_) => Duration::from_secs(30),
                };
                service.wait(wait);
            }
        });
    if let Err(error) = spawned {
        eprintln!("No se pudo iniciar el servicio de temporizadores: {error}");
    }
}
