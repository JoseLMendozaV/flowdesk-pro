//! Reflejo de Docencia en el resto de FlowDesk.
//!
//! Cada materia tiene su proyecto; las franjas del horario son eventos que se repiten;
//! las entregas de evaluaciones y la planificación aparecen en el calendario, y los
//! seguimientos de observaciones son tareas. Lo reflejado lleva `source = 'teaching'`:
//! se cambia desde Docencia y desaparece con su origen (disparadores de la migración 13).
//! Todo se escribe con la conexión que ya tiene el comando, dentro de su transacción.

use super::error::AppResult;
use crate::{
    commands::{projects::PROJECT_COLORS, workspaces::active_workspace},
    recurrence::{Frequency, RecurrenceRule},
};
use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

pub const SOURCE: &str = "teaching";
const DELIVERY_MINUTES: i64 = 30;
const PLANNING_MINUTES: i64 = 60;
/// Los avisos de eventos admiten como mucho una semana de antelación.
const MAX_REMINDER_MINUTES: i64 = 7 * 24 * 60;

/// Instante local de una fecha `AAAA-MM-DD` u hora `AAAA-MM-DDTHH:MM` (también con segundos
/// o con espacio, como en los datos importados). Devuelve si tenía hora.
pub fn parse_local(value: &str) -> Option<(i64, bool)> {
    let value = value.trim();
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return local_timestamp(date.and_time(NaiveTime::MIN)).map(|at| (at, false));
    }
    let normalized = value.replace(' ', "T");
    let short = normalized.get(..16)?;
    let moment = NaiveDateTime::parse_from_str(short, "%Y-%m-%dT%H:%M").ok()?;
    local_timestamp(moment).map(|at| (at, true))
}

pub fn local_timestamp(moment: NaiveDateTime) -> Option<i64> {
    Local
        .from_local_datetime(&moment)
        .earliest()
        .or_else(|| {
            Local
                .from_local_datetime(&(moment + chrono::TimeDelta::hours(1)))
                .earliest()
        })
        .map(|value| value.timestamp())
}

pub fn parse_time(value: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(value.get(..5)?, "%H:%M").ok()
}

struct CourseInfo {
    title: String,
    code: String,
    group_name: String,
    period_label: String,
    is_archived: bool,
    project_id: Option<String>,
}

fn course_info(connection: &Connection, course_id: i64) -> rusqlite::Result<Option<CourseInfo>> {
    connection
        .query_row(
            "SELECT c.title, c.code, c.group_name, c.period_label, c.is_archived,
                    (SELECT p.id FROM projects p WHERE p.id = c.project_id)
             FROM courses c WHERE c.id = ?1",
            [course_id],
            |row| {
                Ok(CourseInfo {
                    title: row.get(0)?,
                    code: row.get(1)?,
                    group_name: row.get(2)?,
                    period_label: row.get(3)?,
                    is_archived: row.get(4)?,
                    project_id: row.get(5)?,
                })
            },
        )
        .optional()
}

fn project_name(course: &CourseInfo) -> String {
    if course.group_name.trim().is_empty() {
        course.title.clone()
    } else {
        format!("{} · {}", course.title, course.group_name)
    }
}

fn course_detail(course: &CourseInfo) -> String {
    [
        (!course.code.is_empty()).then(|| format!("Código {}", course.code)),
        (!course.group_name.is_empty()).then(|| format!("Grupo {}", course.group_name)),
        (!course.period_label.is_empty()).then(|| course.period_label.clone()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ")
}

/// Proyecto de FlowDesk de la materia: lo crea si no existe (o se borró) y mantiene su
/// nombre y archivado al día. Devuelve su identificador.
pub fn sync_course_project(connection: &Connection, course_id: i64) -> AppResult<Option<String>> {
    let Some(course) = course_info(connection, course_id)? else {
        return Ok(None);
    };
    let name = project_name(&course);
    let detail = course_detail(&course);
    let now = Utc::now().timestamp();
    let project_id = match course.project_id {
        Some(project_id) => {
            connection.execute(
                "UPDATE projects SET name = ?1, description = ?2,
                    archived_at = CASE WHEN ?3 THEN COALESCE(archived_at, ?4) ELSE NULL END,
                    updated_at = ?4
                 WHERE id = ?5",
                params![name, detail, course.is_archived, now, project_id],
            )?;
            project_id
        }
        None => {
            let project_id = Uuid::new_v4().to_string();
            let color = PROJECT_COLORS[(course_id.unsigned_abs() as usize) % PROJECT_COLORS.len()];
            connection.execute(
                "INSERT INTO projects(id, name, description, color, status, created_at, updated_at,
                    archived_at)
                 VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5, CASE WHEN ?6 THEN ?5 END)",
                params![project_id, name, detail, color, now, course.is_archived],
            )?;
            // Como cualquier proyecto nuevo, pertenece al espacio activo.
            if let Some(workspace_id) = active_workspace(connection)? {
                connection.execute(
                    "INSERT OR IGNORE INTO workspace_projects(workspace_id, project_id) VALUES (?1, ?2)",
                    params![workspace_id, project_id],
                )?;
            }
            connection.execute(
                "UPDATE courses SET project_id = ?1 WHERE id = ?2",
                params![project_id, course_id],
            )?;
            project_id
        }
    };
    Ok(Some(project_id))
}

/// Evento del calendario que refleja algo de Docencia.
struct Mirror {
    external: String,
    title: String,
    description: String,
    starts_at: i64,
    ends_at: i64,
    is_all_day: bool,
    location: Option<String>,
    reminder_minutes: Option<i64>,
    project_id: Option<String>,
    recurrence: Option<RecurrenceRule>,
}

/// Crea o actualiza el evento reflejado y devuelve su identificador. Conserva las
/// repeticiones quitadas a mano (festivos) mientras no cambie el inicio de la serie.
fn upsert_event(
    connection: &Connection,
    existing: Option<String>,
    mirror: &Mirror,
) -> rusqlite::Result<String> {
    let now = Utc::now().timestamp();
    let rule = mirror.recurrence.as_ref().map(RecurrenceRule::to_json);
    let current: Option<(String, i64)> = match &existing {
        Some(id) => connection
            .query_row(
                "SELECT id, starts_at FROM calendar_events WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?,
        None => None,
    };
    if let Some((id, starts_at)) = current {
        connection.execute(
            "UPDATE calendar_events SET title = ?1, description = ?2, project_id = ?3,
                starts_at = ?4, ends_at = ?5, is_all_day = ?6, location = ?7,
                reminder_minutes = ?8, recurrence_rule = ?9,
                recurrence_exceptions = CASE WHEN ?4 = ?10 THEN recurrence_exceptions ELSE '[]' END,
                source = ?11, external_id = ?12, updated_at = ?13
             WHERE id = ?14",
            params![
                mirror.title,
                mirror.description,
                mirror.project_id,
                mirror.starts_at,
                mirror.ends_at,
                mirror.is_all_day,
                mirror.location,
                mirror.reminder_minutes,
                rule,
                starts_at,
                SOURCE,
                mirror.external,
                now,
                id
            ],
        )?;
        return Ok(id);
    }
    // Un reflejo huérfano con la misma clave (por ejemplo, de una importación) se sustituye.
    connection.execute(
        "DELETE FROM calendar_events WHERE source = ?1 AND external_id = ?2",
        params![SOURCE, mirror.external],
    )?;
    let id = Uuid::new_v4().to_string();
    connection.execute(
        "INSERT INTO calendar_events(id, title, description, project_id, starts_at, ends_at,
            is_all_day, location, reminder_minutes, recurrence_rule, source, external_id,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
        params![
            id,
            mirror.title,
            mirror.description,
            mirror.project_id,
            mirror.starts_at,
            mirror.ends_at,
            mirror.is_all_day,
            mirror.location,
            mirror.reminder_minutes,
            rule,
            SOURCE,
            mirror.external,
            now
        ],
    )?;
    Ok(id)
}

fn remove_event(connection: &Connection, event_id: Option<String>) -> rusqlite::Result<()> {
    if let Some(event_id) = event_id {
        connection.execute("DELETE FROM calendar_events WHERE id = ?1", [event_id])?;
    }
    Ok(())
}

/// Un día entero, de medianoche a medianoche, o un bloque de `minutes` desde la hora dada.
fn span(starts_at: i64, has_time: bool, minutes: i64) -> (i64, i64, bool) {
    if has_time {
        (starts_at, starts_at + minutes * 60, false)
    } else {
        let next = Local
            .timestamp_opt(starts_at, 0)
            .single()
            .and_then(|moment| moment.date_naive().succ_opt())
            .and_then(|day| local_timestamp(day.and_time(NaiveTime::MIN)))
            .unwrap_or(starts_at + 86_400);
        (starts_at, next, true)
    }
}

/// La entrega de una evaluación activa con fecha aparece en el calendario.
pub fn sync_evaluation(connection: &Connection, evaluation_id: i64) -> AppResult<()> {
    let Some((course_id, name, active, due_date, event_id)) = connection
        .query_row(
            "SELECT course_id, name, active, due_date, calendar_event_id FROM evaluations WHERE id = ?1",
            [evaluation_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(());
    };
    let due = due_date.as_deref().and_then(parse_local).filter(|_| active);
    let Some((due_at, has_time)) = due else {
        remove_event(connection, event_id)?;
        connection.execute(
            "UPDATE evaluations SET calendar_event_id = NULL WHERE id = ?1",
            [evaluation_id],
        )?;
        return Ok(());
    };
    let project_id = sync_course_project(connection, course_id)?;
    let course = course_info(connection, course_id)?;
    let (starts_at, ends_at, is_all_day) = span(due_at, has_time, DELIVERY_MINUTES);
    let mirror = Mirror {
        external: format!("evaluation:{evaluation_id}"),
        title: format!("Entrega: {name}"),
        description: course.as_ref().map(project_name).unwrap_or_default(),
        starts_at,
        ends_at,
        is_all_day,
        location: None,
        reminder_minutes: None,
        project_id,
        recurrence: None,
    };
    let id = upsert_event(connection, event_id, &mirror)?;
    connection.execute(
        "UPDATE evaluations SET calendar_event_id = ?1 WHERE id = ?2",
        params![id, evaluation_id],
    )?;
    Ok(())
}

/// Los mismos tipos que la pantalla Planificación.
fn event_type_label(event_type: &str) -> &'static str {
    match event_type {
        "class" => "Clase",
        "evaluation" => "Evaluación",
        "delivery" => "Entrega",
        "meeting" => "Reunión",
        _ => "Otro",
    }
}

/// La planificación (clases, entregas, reuniones) aparece en el calendario con su aviso.
pub fn sync_academic_event(connection: &Connection, event_id: i64) -> AppResult<()> {
    let Some((
        course_id,
        title,
        event_type,
        starts_at,
        ends_at,
        description,
        reminder_days,
        mirror_id,
    )) = connection
        .query_row(
            "SELECT course_id, title, event_type, starts_at, ends_at, description, reminder_days,
                        calendar_event_id
                 FROM academic_events WHERE id = ?1",
            [event_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(());
    };
    let Some((start, has_time)) = parse_local(&starts_at) else {
        remove_event(connection, mirror_id)?;
        connection.execute(
            "UPDATE academic_events SET calendar_event_id = NULL WHERE id = ?1",
            [event_id],
        )?;
        return Ok(());
    };
    let (mut first, mut last, is_all_day) = span(start, has_time, PLANNING_MINUTES);
    if let Some((end, _)) = ends_at.as_deref().and_then(parse_local)
        && end > start
    {
        if is_all_day {
            last = span(end, false, 0).1;
        } else {
            last = end;
        }
    }
    if last <= first {
        first = start;
        last = start + PLANNING_MINUTES * 60;
    }
    let project_id = sync_course_project(connection, course_id)?;
    let course = course_info(connection, course_id)?;
    let detail = [
        Some(event_type_label(&event_type).to_string()),
        course.as_ref().map(project_name),
        (!description.trim().is_empty()).then(|| description.trim().to_string()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let mirror = Mirror {
        external: format!("planning:{event_id}"),
        title,
        description: detail,
        starts_at: first,
        ends_at: last,
        is_all_day,
        location: None,
        reminder_minutes: (reminder_days > 0)
            .then(|| (reminder_days * 1440).min(MAX_REMINDER_MINUTES)),
        project_id,
        recurrence: None,
    };
    let id = upsert_event(connection, mirror_id, &mirror)?;
    connection.execute(
        "UPDATE academic_events SET calendar_event_id = ?1 WHERE id = ?2",
        params![id, event_id],
    )?;
    Ok(())
}

/// Una observación con fecha de seguimiento es una tarea de la materia; resolverla la completa.
pub fn sync_observation(connection: &Connection, observation_id: i64) -> AppResult<()> {
    let Some((course_id, student, text, follow_up, resolved, task_id)) = connection
        .query_row(
            "SELECT e.course_id, st.name, o.text, o.follow_up_date, o.resolved,
                    (SELECT t.id FROM tasks t WHERE t.id = o.task_id)
             FROM student_observations o
             JOIN enrollments e ON e.id = o.enrollment_id
             JOIN students st ON st.id = e.student_id
             WHERE o.id = ?1",
            [observation_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(());
    };
    let due = follow_up
        .as_deref()
        .and_then(parse_local)
        .map(|(at, _)| at + 12 * 3600);
    let now = Utc::now().timestamp();
    let Some(due_at) = due else {
        if let Some(task_id) = task_id {
            connection.execute(
                "DELETE FROM tasks WHERE id = ?1 AND status != 'completed'",
                [&task_id],
            )?;
        }
        connection.execute(
            "UPDATE student_observations SET task_id = NULL WHERE id = ?1",
            [observation_id],
        )?;
        return Ok(());
    };
    let status = if resolved { "completed" } else { "pending" };
    let title: String = format!("Seguimiento: {student}");
    let project_id = sync_course_project(connection, course_id)?;
    match task_id {
        Some(task_id) => {
            connection.execute(
                "UPDATE tasks SET title = ?1, description = ?2, due_at = ?3, due_has_time = 0,
                    project_id = ?4, status = ?5,
                    completed_at = CASE WHEN ?5 = 'completed' THEN COALESCE(completed_at, ?6) END,
                    updated_at = ?6
                 WHERE id = ?7",
                params![title, text, due_at, project_id, status, now, task_id],
            )?;
        }
        None => {
            let task_id = Uuid::new_v4().to_string();
            connection.execute(
                "INSERT INTO tasks(id, title, description, status, priority, project_id, due_at,
                    due_has_time, completed_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'medium', ?5, ?6, 0,
                    CASE WHEN ?4 = 'completed' THEN ?7 END, ?7, ?7)",
                params![task_id, title, text, status, project_id, due_at, now],
            )?;
            connection.execute(
                "UPDATE student_observations SET task_id = ?1 WHERE id = ?2",
                params![task_id, observation_id],
            )?;
        }
    }
    Ok(())
}

/// Primer día `weekday` (1 = lunes) igual o posterior a `from`.
pub fn first_weekday(from: NaiveDate, weekday: u32) -> NaiveDate {
    let offset = (7 + weekday as i64 - from.weekday().number_from_monday() as i64) % 7;
    from + chrono::TimeDelta::days(offset)
}

/// La franja del horario es una clase semanal en el calendario, durante sus fechas.
pub fn sync_schedule_slot(connection: &Connection, slot_id: i64) -> AppResult<()> {
    let Some((
        course_id,
        weekday,
        start_time,
        end_time,
        room,
        starts_on,
        ends_on,
        reminder,
        event_id,
        kind,
    )) = connection
        .query_row(
            "SELECT course_id, weekday, start_time, end_time, room, starts_on, ends_on,
                        reminder_minutes, calendar_event_id, kind
                 FROM course_schedule WHERE id = ?1",
            [slot_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(());
    };
    let course = course_info(connection, course_id)?;
    let dates = NaiveDate::parse_from_str(&starts_on, "%Y-%m-%d")
        .ok()
        .zip(NaiveDate::parse_from_str(&ends_on, "%Y-%m-%d").ok());
    let times = parse_time(&start_time).zip(parse_time(&end_time));
    let first = dates.map(|(from, until)| (first_weekday(from, weekday), until));
    let usable = match (first, times, &course) {
        (Some((first, until)), Some((start, end)), Some(course))
            if first <= until && !course.is_archived =>
        {
            Some((first, until, start, end))
        }
        _ => None,
    };
    let Some((first, until, start, end)) = usable else {
        remove_event(connection, event_id)?;
        connection.execute(
            "UPDATE course_schedule SET calendar_event_id = NULL WHERE id = ?1",
            [slot_id],
        )?;
        return Ok(());
    };
    let starts_at = local_timestamp(first.and_time(start)).unwrap_or_default();
    let ends_at = local_timestamp(first.and_time(end)).unwrap_or(starts_at + 3600);
    let until = local_timestamp(until.and_hms_opt(23, 59, 59).unwrap_or_default());
    let rule = RecurrenceRule {
        frequency: Frequency::Weekly,
        interval: 1,
        weekdays: vec![weekday as u8],
        from_completion: false,
        until,
        day_of_month: None,
    };
    let course = course.expect("comprobado arriba");
    let project_id = sync_course_project(connection, course_id)?;
    let mirror = Mirror {
        external: format!("schedule:{slot_id}"),
        title: match kind.as_str() {
            "theory" => format!("{} · Teoría", course.title),
            "lab" => format!("{} · Laboratorio", course.title),
            _ => course.title.clone(),
        },
        description: course_detail(&course),
        starts_at,
        ends_at,
        is_all_day: false,
        location: (!room.trim().is_empty()).then(|| room.trim().to_string()),
        reminder_minutes: reminder,
        project_id,
        recurrence: Some(rule),
    };
    let id = upsert_event(connection, event_id, &mirror)?;
    connection.execute(
        "UPDATE course_schedule SET calendar_event_id = ?1 WHERE id = ?2",
        params![id, slot_id],
    )?;
    Ok(())
}

fn ids(connection: &Connection, sql: &str, course_id: i64) -> rusqlite::Result<Vec<i64>> {
    connection
        .prepare(sql)?
        .query_map([course_id], |row| row.get(0))?
        .collect()
}

/// Vuelve a reflejar todo lo de una materia (tras importar, archivar o renombrar).
pub fn sync_course(connection: &Connection, course_id: i64) -> AppResult<()> {
    sync_course_project(connection, course_id)?;
    for id in ids(
        connection,
        "SELECT id FROM evaluations WHERE course_id = ?1",
        course_id,
    )? {
        sync_evaluation(connection, id)?;
    }
    for id in ids(
        connection,
        "SELECT id FROM academic_events WHERE course_id = ?1",
        course_id,
    )? {
        sync_academic_event(connection, id)?;
    }
    for id in ids(
        connection,
        "SELECT o.id FROM student_observations o JOIN enrollments e ON e.id = o.enrollment_id
         WHERE e.course_id = ?1",
        course_id,
    )? {
        sync_observation(connection, id)?;
    }
    for id in ids(
        connection,
        "SELECT id FROM course_schedule WHERE course_id = ?1",
        course_id,
    )? {
        sync_schedule_slot(connection, id)?;
    }
    Ok(())
}

pub fn sync_all(connection: &Connection) -> AppResult<()> {
    let courses: Vec<i64> = connection
        .prepare("SELECT id FROM courses")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for course_id in courses {
        sync_course(connection, course_id)?;
    }
    Ok(())
}
