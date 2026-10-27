//! Importación desde Control Docente (app de escritorio) y desde su versión Django, y
//! respaldo de la base. Los originales nunca se modifican: se leen desde una copia.

use super::{
    error::{AppError, AppResult},
    models::ImportResult,
    sync,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use std::{
    fs,
    path::{Path, PathBuf},
};

const IMPORTED_KEY: &str = "teaching_imported";

/// Tablas de Control Docente que se copian, en orden de dependencias, con sus columnas.
const DESKTOP_TABLES: &[(&str, &str)] = &[
    (
        "academic_periods",
        "id, name, start_date, end_date, is_active, is_closed",
    ),
    (
        "courses",
        "id, title, code, group_name, period_label, academic_period_id, professor, passing_grade,
         attendance_minimum, low_grade_alert, low_attendance_alert, promotion_requires_attendance,
         is_archived, created_at, updated_at",
    ),
    (
        "students",
        "id, identification, name, email, guardian_name, guardian_email, guardian_phone, created_at",
    ),
    (
        "enrollments",
        "id, course_id, student_id, status, enrolled_at",
    ),
    (
        "student_groups",
        "id, course_id, name, description, leader_membership_id, created_at",
    ),
    (
        "group_memberships",
        "id, group_id, enrollment_id, joined_at",
    ),
    (
        "class_sessions",
        "id, course_id, number, title, date, start_time, end_time, topic, attendance_token, is_held",
    ),
    (
        "attendance_records",
        "id, enrollment_id, session_id, status, arrival_time, departure_time, notes, checked_in_at",
    ),
    (
        "evaluations",
        "id, course_id, name, evaluation_type, grading_mode, weight, max_score, active, sort_order,
         due_date, published",
    ),
    (
        "grades",
        "id, enrollment_id, evaluation_id, score, feedback, published, updated_at",
    ),
    (
        "group_grades",
        "id, group_id, evaluation_id, score, updated_at",
    ),
    (
        "rubric_criteria",
        "id, evaluation_id, name, description, weight, max_score, sort_order",
    ),
    (
        "rubric_scores",
        "id, enrollment_id, criterion_id, score, feedback",
    ),
    (
        "recovery_grades",
        "id, enrollment_id, evaluation_id, original_score, recovery_score, applied_score, notes,
         created_at",
    ),
    (
        "student_observations",
        "id, enrollment_id, category, text, follow_up_date, resolved, private, created_at",
    ),
    (
        "academic_events",
        "id, course_id, title, event_type, starts_at, ends_at, description, reminder_days",
    ),
    (
        "announcements",
        "id, course_id, title, body, attachment, published, send_email, created_at",
    ),
    (
        "audit_logs",
        "id, course_id, action, description, created_at",
    ),
];

/// Base de la app de escritorio de Control Docente en este Mac, si existe.
pub fn desktop_database(home: &Path) -> Option<PathBuf> {
    let path = home
        .join("Library/Application Support/com.jmendoza.controldocente/control-docente.sqlite3");
    path.is_file().then_some(path)
}

pub fn was_imported(connection: &Connection) -> AppResult<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [IMPORTED_KEY],
            |row| row.get(0),
        )
        .optional()?)
}

fn require_empty(connection: &Connection) -> AppResult<()> {
    let courses: i64 =
        connection.query_row("SELECT COUNT(*) FROM courses", [], |row| row.get(0))?;
    if courses > 0 {
        return Err(AppError::Validation(
            "Docencia ya tiene materias. La importación solo puede hacerse con Docencia vacía."
                .into(),
        ));
    }
    Ok(())
}

fn stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Copia coherente de una base SQLite (incluido lo pendiente en su WAL) sin escribir en ella.
fn snapshot(source: &Path, destination: &Path) -> AppResult<()> {
    if !source.is_file() {
        return Err(AppError::Validation(
            "Selecciona un archivo SQLite válido.".into(),
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let reader = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    reader.execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])?;
    Ok(())
}

fn has_table(connection: &Connection, schema: &str, table: &str) -> AppResult<bool> {
    Ok(connection
        .query_row(
            &format!("SELECT 1 FROM {schema}.sqlite_master WHERE type = 'table' AND name = ?1"),
            [table],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some())
}

fn counts(connection: &Connection, message: String) -> AppResult<ImportResult> {
    Ok(ImportResult {
        courses: connection.query_row("SELECT COUNT(*) FROM courses", [], |row| row.get(0))?,
        students: connection.query_row("SELECT COUNT(*) FROM students", [], |row| row.get(0))?,
        enrollments: connection
            .query_row("SELECT COUNT(*) FROM enrollments", [], |row| row.get(0))?,
        message,
    })
}

/// Copia las filas de `source` en las tablas de Docencia y refleja el resultado en FlowDesk.
fn import_attached(
    connection: &mut Connection,
    copy: &Path,
    statements: &str,
    marker: &str,
) -> AppResult<()> {
    connection.execute(
        "ATTACH DATABASE ?1 AS legacy",
        [copy.to_string_lossy().as_ref()],
    )?;
    let result = (|| -> AppResult<()> {
        let transaction = connection.transaction()?;
        transaction.execute_batch(statements)?;
        localize_legacy_datetimes(&transaction)?;
        sync::sync_all(&transaction)?;
        transaction.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, unixepoch())
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![IMPORTED_KEY, marker],
        )?;
        transaction.commit()?;
        Ok(())
    })();
    let _ = connection.execute_batch("DETACH DATABASE legacy;");
    result
}

/// Importa la base de la app de escritorio de Control Docente.
pub fn import_desktop(
    connection: &mut Connection,
    source: &Path,
    backups: &Path,
) -> AppResult<ImportResult> {
    require_empty(connection)?;
    let copy = backups.join(format!("control-docente-{}.sqlite3", stamp()));
    snapshot(source, &copy)?;
    {
        let check = Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        if !has_table(&check, "main", "courses")? || !has_table(&check, "main", "class_sessions")? {
            return Err(AppError::Validation(
                "El archivo no parece pertenecer a Control Docente.".into(),
            ));
        }
    }
    let statements: String = DESKTOP_TABLES
        .iter()
        .map(|(table, columns)| {
            format!("INSERT INTO main.{table} ({columns}) SELECT {columns} FROM legacy.{table};\n")
        })
        .collect();
    import_attached(connection, &copy, &statements, "desktop")?;
    counts(
        connection,
        "Se importó Control Docente. El archivo original no se modificó; queda una copia en los respaldos de FlowDesk.".into(),
    )
}

/// Importa la base de la versión Django de Control Docente (`db.sqlite3`).
pub fn import_django(
    connection: &mut Connection,
    source: &Path,
    backups: &Path,
) -> AppResult<ImportResult> {
    require_empty(connection)?;
    let copy = backups.join(format!("django-original-{}.sqlite3", stamp()));
    snapshot(source, &copy)?;
    {
        let check = Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        if !has_table(&check, "main", "academico_course")? {
            return Err(AppError::Validation(
                "El archivo no parece pertenecer a Control Docente Django.".into(),
            ));
        }
    }
    import_attached(connection, &copy, DJANGO_IMPORT, "django")?;
    counts(
        connection,
        "Los datos de Django se importaron correctamente. El archivo original no fue modificado."
            .into(),
    )
}

/// Respaldo coherente de toda la base de FlowDesk (también lo que esté en el WAL).
pub fn backup(connection: &Connection, database_path: &Path, destination: &Path) -> AppResult<()> {
    if destination == database_path {
        return Err(AppError::Validation(
            "Selecciona una ubicación diferente para el respaldo.".into(),
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    connection.execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])?;
    Ok(())
}

/// Django (`USE_TZ = True`) guarda los `DateTimeField` en UTC como `AAAA-MM-DD HH:MM:SS`,
/// mientras que Docencia guarda fechas de entrega y eventos en hora local con el formato de
/// `datetime-local` (`AAAA-MM-DDTHH:MM`). Solo se convierten los valores con el formato de
/// Django, así que repetir la conversión no altera los datos ya convertidos.
pub fn localize_legacy_datetimes(connection: &Connection) -> AppResult<()> {
    connection.execute_batch(
        "UPDATE evaluations
         SET due_date = strftime('%Y-%m-%dT%H:%M', due_date, 'localtime')
         WHERE due_date LIKE '____-__-__ %';
         UPDATE academic_events
         SET starts_at = strftime('%Y-%m-%dT%H:%M', starts_at, 'localtime')
         WHERE starts_at LIKE '____-__-__ %';
         UPDATE academic_events
         SET ends_at = strftime('%Y-%m-%dT%H:%M', ends_at, 'localtime')
         WHERE ends_at LIKE '____-__-__ %';",
    )?;
    Ok(())
}

const DJANGO_IMPORT: &str = r#"
INSERT INTO academic_periods (id, name, start_date, end_date, is_active, is_closed)
SELECT id, name, start_date, end_date, is_active, is_closed
FROM legacy.academico_academicperiod;

INSERT INTO courses (
    id, title, code, group_name, period_label, academic_period_id, professor,
    passing_grade, attendance_minimum, low_grade_alert, low_attendance_alert,
    promotion_requires_attendance, is_archived, created_at, updated_at
)
SELECT id, title, code, "group", period, academic_period_id, professor,
       passing_grade, attendance_minimum, low_grade_alert, low_attendance_alert,
       promotion_requires_attendance, is_archived, created_at, updated_at
FROM legacy.academico_course;

INSERT INTO students (
    id, identification, name, email, guardian_name, guardian_email, guardian_phone, created_at
)
SELECT id, identification, name, email, guardian_name, guardian_email, guardian_phone, created_at
FROM legacy.academico_student;

INSERT INTO enrollments (id, course_id, student_id, status, enrolled_at)
SELECT id, course_id, student_id, status, enrolled_at
FROM legacy.academico_enrollment;

INSERT INTO student_groups (id, course_id, name, description, leader_membership_id, created_at)
SELECT id, course_id, name, description, leader_id, created_at
FROM legacy.academico_studentgroup;

INSERT INTO group_memberships (id, group_id, enrollment_id, joined_at)
SELECT id, group_id, enrollment_id, joined_at
FROM legacy.academico_groupmembership;

INSERT INTO class_sessions (
    id, course_id, number, title, date, start_time, end_time, topic, attendance_token, is_held
)
SELECT id, course_id, number, title, date, start_time, end_time, topic, attendance_token, is_held
FROM legacy.academico_classsession;

INSERT INTO attendance_records (
    id, enrollment_id, session_id, status, arrival_time, departure_time, notes, checked_in_at
)
SELECT id, enrollment_id, session_id, status, arrival_time, departure_time, notes, checked_in_at
FROM legacy.academico_attendancerecord;

INSERT INTO evaluations (
    id, course_id, name, evaluation_type, grading_mode, weight, max_score, active, sort_order,
    due_date, published
)
SELECT id, course_id, name, evaluation_type, grading_mode, weight, max_score, active, "order",
       due_date, published
FROM legacy.academico_evaluation;

INSERT INTO grades (id, enrollment_id, evaluation_id, score, feedback, published, updated_at)
SELECT id, enrollment_id, evaluation_id, score, feedback, published, updated_at
FROM legacy.academico_grade;

INSERT INTO group_grades (id, group_id, evaluation_id, score, updated_at)
SELECT id, group_id, evaluation_id, score, updated_at
FROM legacy.academico_groupgrade;

INSERT INTO rubric_criteria (id, evaluation_id, name, description, weight, max_score, sort_order)
SELECT id, evaluation_id, name, description, weight, max_score, "order"
FROM legacy.academico_rubriccriterion;

INSERT INTO rubric_scores (id, enrollment_id, criterion_id, score, feedback)
SELECT id, enrollment_id, criterion_id, score, feedback
FROM legacy.academico_rubricscore;

INSERT INTO recovery_grades (
    id, enrollment_id, evaluation_id, original_score, recovery_score, applied_score, notes,
    created_at
)
SELECT id, enrollment_id, evaluation_id, original_score, recovery_score, applied_score, notes,
       created_at
FROM legacy.academico_recoverygrade;

INSERT INTO student_observations (
    id, enrollment_id, category, text, follow_up_date, resolved, private, created_at
)
SELECT id, enrollment_id, category, text, follow_up_date, resolved, private, created_at
FROM legacy.academico_studentobservation;

INSERT INTO academic_events (
    id, course_id, title, event_type, starts_at, ends_at, description, reminder_days
)
SELECT id, course_id, title, event_type, starts_at, ends_at, description, reminder_days
FROM legacy.academico_academicevent;

INSERT INTO announcements (
    id, course_id, title, body, attachment, published, send_email, created_at
)
SELECT id, course_id, title, body, attachment, published, send_email, created_at
FROM legacy.academico_announcement;

INSERT INTO audit_logs (id, course_id, action, description, created_at)
SELECT id, course_id, action, description, created_at
FROM legacy.academico_auditlog;
"#;
