//! Docencia: la gestión académica de Control Docente integrada en FlowDesk (materias,
//! estudiantes, equipos, asistencia, evaluaciones, calificaciones, planificación,
//! analítica e informes), más el horario semanal y su reflejo en el calendario.

pub mod academic;
pub mod commands;
pub mod error;
pub mod final_sheet;
pub mod legacy;
pub mod models;
pub mod overview;
pub mod schedule;
pub mod syllabus;
pub mod sync;
#[cfg(test)]
mod tests;
pub mod xlsx_template;

use tauri::{AppHandle, Emitter};

/// Avisa a las ventanas de los datos que cambiaron (ver `flowdesk://data-changed`).
pub fn notify(app: &AppHandle, kinds: &[&str]) {
    for kind in kinds {
        let _ = app.emit("flowdesk://data-changed", *kind);
    }
}
