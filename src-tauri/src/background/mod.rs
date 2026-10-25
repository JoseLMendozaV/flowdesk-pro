//! Servicios que siguen funcionando con todas las ventanas ocultas.

pub mod app_tracking;
pub mod clipboard;
pub mod clock;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod reminders;
pub mod timer;
pub mod wakeup;

use crate::{database::Database, models::TimerSnapshot, tray};
use reminders::{LocalMoment, ReminderService};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager};
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

/// Hilo de recordatorios. Despierta al cambiar tareas, notas o eventos, y como
/// mucho cada 60 s para notar el reposo, los cambios de hora y el resumen diario.
pub fn spawn_reminders(app: AppHandle) {
    let listener = app.clone();
    app.listen_any("flowdesk://data-changed", move |event| {
        if matches!(event.payload(), "\"tasks\"" | "\"notes\"" | "\"calendar\"") {
            listener.state::<ReminderService>().wakeup.wake();
        }
    });
    let spawned = std::thread::Builder::new()
        .name("flowdesk-reminders".to_string())
        .spawn(move || {
            let mut dirty = true;
            loop {
                let service = app.state::<ReminderService>();
                let database = app.state::<Database>();
                let settings = database
                    .with_connection(reminders::load_settings)
                    .unwrap_or_default();
                let moment = LocalMoment::current();
                if dirty {
                    let _ = database.with_connection_mut(|connection| {
                        reminders::reconcile(connection, &settings, moment.now)
                    });
                }
                let mut notices =
                    reminders::collect_due(&database, &settings, &moment).unwrap_or_default();
                if let Ok(Some(digest)) = reminders::collect_digest(&database, &settings, &moment) {
                    notices.push(digest);
                }
                if dirty || !notices.is_empty() {
                    let _ = app.emit("flowdesk://data-changed", "reminders");
                }
                for notice in notices {
                    notify(&app, &notice.title, &notice.body);
                }
                dirty = service
                    .wakeup
                    .wait(Some(reminders::next_wait(&database, moment.now)));
            }
        });
    if let Err(error) = spawned {
        eprintln!("No se pudo iniciar el servicio de recordatorios: {error}");
    }
}

/// Hilo del portapapeles: compara `changeCount` cada segundo solo con consentimiento
/// y sin pausa; en otro caso duerme hasta que cambian las preferencias.
pub fn spawn_clipboard(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("flowdesk-clipboard".to_string())
        .spawn(move || {
            loop {
                let service = app.state::<clipboard::ClipboardService>();
                let database = app.state::<Database>();
                let settings = database
                    .with_connection(clipboard::load_settings)
                    .unwrap_or_default();
                if !settings.enabled || settings.paused || cfg!(not(target_os = "macos")) {
                    service.forget();
                    service.wakeup.wait(None);
                    continue;
                }
                #[cfg(target_os = "macos")]
                if service.observe(clipboard::pasteboard::change_count())
                    && let Some(clip) = clipboard::pasteboard::read(settings.capture_images)
                    && let Ok(clipboard::Capture::Stored) = clipboard::capture(
                        &database,
                        &service.images_dir,
                        &settings,
                        clip,
                        chrono::Utc::now().timestamp(),
                    )
                {
                    let _ = app.emit("flowdesk://data-changed", "clipboard");
                }
                service.wakeup.wait(Some(clipboard::POLL_INTERVAL));
            }
        });
    if let Err(error) = spawned {
        eprintln!("No se pudo iniciar el servicio de portapapeles: {error}");
    }
}

/// Hilo del seguimiento automático: una muestra cada 5 s con consentimiento y sin
/// pausa; en otro caso duerme hasta que cambian las preferencias.
pub fn spawn_app_tracking(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("flowdesk-app-tracking".to_string())
        .spawn(move || {
            let mut last_prune = 0;
            loop {
                let service = app.state::<app_tracking::AppTrackingService>();
                let database = app.state::<Database>();
                let settings = database
                    .with_connection(app_tracking::load_settings)
                    .unwrap_or_default();
                if !settings.enabled || settings.paused || cfg!(not(target_os = "macos")) {
                    service.finish(&database);
                    service.wakeup.wait(None);
                    continue;
                }
                let now = chrono::Utc::now().timestamp();
                if now - last_prune > 3_600 {
                    let _ = app_tracking::prune(&database, settings.retention_days, now);
                    last_prune = now;
                }
                #[cfg(target_os = "macos")]
                {
                    let sample = app_tracking::Sample {
                        now,
                        app: macos::frontmost_app(),
                        idle_seconds: macos::idle_seconds(),
                    };
                    let changed = service
                        .tracker
                        .lock()
                        .ok()
                        .and_then(|mut tracker| tracker.sample(&database, &settings, sample).ok())
                        .unwrap_or(false);
                    if changed {
                        let _ = app.emit("flowdesk://data-changed", "app-usage");
                    }
                }
                service.wakeup.wait(Some(app_tracking::SAMPLE_INTERVAL));
            }
        });
    if let Err(error) = spawned {
        eprintln!("No se pudo iniciar el seguimiento automático: {error}");
    }
}
