//! Horario semanal de las materias y sesiones de asistencia generadas a partir de él.

use super::{
    error::{AppError, AppResult},
    models::{GenerateSessionsResult, ScheduleSlot, ScheduleSlotInput, TimeBlocks},
    sync::{self, first_weekday, parse_time},
};
use crate::database::Database;
use chrono::{NaiveDate, Timelike};
use rusqlite::{Connection, OptionalExtension, params};
use tauri::{AppHandle, State};

const KINDS: &[&str] = &["class", "theory", "lab"];
const BLOCKS_KEY: &str = "teaching_time_blocks";

const SLOT_SELECT: &str = "SELECT s.id, s.course_id, s.kind, c.title, c.group_name,
        COALESCE(p.color, '#6C8CFF'), s.weekday, s.start_time, s.end_time, s.room,
        s.starts_on, s.ends_on, s.reminder_minutes,
        EXISTS(SELECT 1 FROM calendar_events e WHERE e.id = s.calendar_event_id)
     FROM course_schedule s JOIN courses c ON c.id = s.course_id
     LEFT JOIN projects p ON p.id = c.project_id";

fn map_slot(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduleSlot> {
    Ok(ScheduleSlot {
        id: row.get(0)?,
        course_id: row.get(1)?,
        kind: row.get(2)?,
        course_title: row.get(3)?,
        group_name: row.get(4)?,
        color: row.get(5)?,
        weekday: row.get(6)?,
        start_time: row.get(7)?,
        end_time: row.get(8)?,
        room: row.get(9)?,
        starts_on: row.get(10)?,
        ends_on: row.get(11)?,
        reminder_minutes: row.get(12)?,
        in_calendar: row.get(13)?,
    })
}

/// Franjas de las materias no archivadas, ordenadas por día y hora.
pub fn query_schedule(connection: &Connection) -> AppResult<Vec<ScheduleSlot>> {
    Ok(connection
        .prepare(&format!(
            "{SLOT_SELECT} WHERE c.is_archived = 0 ORDER BY s.weekday, s.start_time, c.title"
        ))?
        .query_map([], map_slot)?
        .collect::<Result<_, _>>()?)
}

fn validate(input: &ScheduleSlotInput) -> AppResult<()> {
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Validation("Tipo de clase no válido.".into()));
    }
    if !(1..=7).contains(&input.weekday) {
        return Err(AppError::Validation("Elige el día de la semana.".into()));
    }
    let (Some(start), Some(end)) = (parse_time(&input.start_time), parse_time(&input.end_time))
    else {
        return Err(AppError::Validation(
            "Escribe la hora de inicio y de fin.".into(),
        ));
    };
    if end <= start {
        return Err(AppError::Validation(
            "La clase debe terminar después de empezar.".into(),
        ));
    }
    let from = NaiveDate::parse_from_str(&input.starts_on, "%Y-%m-%d");
    let until = NaiveDate::parse_from_str(&input.ends_on, "%Y-%m-%d");
    match (from, until) {
        (Ok(from), Ok(until)) if until >= from => {}
        _ => {
            return Err(AppError::Validation(
                "Revisa las fechas de inicio y fin del horario.".into(),
            ));
        }
    }
    if input
        .reminder_minutes
        .is_some_and(|minutes| !(0..=1440).contains(&minutes))
    {
        return Err(AppError::Validation("Aviso no válido.".into()));
    }
    Ok(())
}

pub fn save_slot(connection: &mut Connection, input: &ScheduleSlotInput) -> AppResult<i64> {
    validate(input)?;
    let transaction = connection.transaction()?;
    let course_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM courses WHERE id = ?1)",
        [input.course_id],
        |row| row.get(0),
    )?;
    if !course_exists {
        return Err(AppError::Validation("La materia ya no existe.".into()));
    }
    let start = &input.start_time[..5];
    let end = &input.end_time[..5];
    let id = if let Some(id) = input.id {
        transaction.execute(
            "UPDATE course_schedule SET course_id = ?1, weekday = ?2, start_time = ?3,
                end_time = ?4, room = ?5, starts_on = ?6, ends_on = ?7, reminder_minutes = ?8,
                kind = ?10
             WHERE id = ?9",
            params![
                input.course_id,
                input.weekday,
                start,
                end,
                input.room.trim(),
                input.starts_on,
                input.ends_on,
                input.reminder_minutes,
                id,
                input.kind
            ],
        )?;
        id
    } else {
        transaction.execute(
            "INSERT INTO course_schedule(course_id, weekday, start_time, end_time, room, starts_on,
                ends_on, reminder_minutes, kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                input.course_id,
                input.weekday,
                start,
                end,
                input.room.trim(),
                input.starts_on,
                input.ends_on,
                input.reminder_minutes,
                input.kind
            ],
        )?;
        transaction.last_insert_rowid()
    };
    sync::sync_schedule_slot(&transaction, id)?;
    transaction.commit()?;
    Ok(id)
}

/// Crea una sesión por cada día de clase del horario que aún no la tenga, numeradas a
/// continuación de las existentes, y pone hora a las sesiones de esos días que no la tenían.
/// No toca la asistencia ya registrada.
pub fn generate_sessions(
    connection: &mut Connection,
    course_id: i64,
) -> AppResult<GenerateSessionsResult> {
    let transaction = connection.transaction()?;
    let slots: Vec<(u32, String, String, String, String)> = transaction
        .prepare(
            "SELECT weekday, start_time, end_time, starts_on, ends_on FROM course_schedule
             WHERE course_id = ?1",
        )?
        .query_map([course_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    if slots.is_empty() {
        return Err(AppError::Validation(
            "Esta materia aún no tiene horario. Añade sus clases en Horario.".into(),
        ));
    }
    let mut days: Vec<(NaiveDate, String, String)> = Vec::new();
    for (weekday, start, end, from, until) in slots {
        let (Ok(from), Ok(until)) = (
            NaiveDate::parse_from_str(&from, "%Y-%m-%d"),
            NaiveDate::parse_from_str(&until, "%Y-%m-%d"),
        ) else {
            continue;
        };
        let mut day = first_weekday(from, weekday);
        while day <= until {
            days.push((day, start.clone(), end.clone()));
            day += chrono::TimeDelta::days(7);
        }
    }
    // Un día con teoría y laboratorio es una sola sesión, de la primera hora a la última.
    days.sort();
    let mut merged: Vec<(NaiveDate, String, String)> = Vec::new();
    for (day, start, end) in days {
        match merged.last_mut() {
            Some(last) if last.0 == day => {
                if end > last.2 {
                    last.2 = end;
                }
            }
            _ => merged.push((day, start, end)),
        }
    }
    let days = merged;
    let mut next: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(number), 0) + 1 FROM class_sessions WHERE course_id = ?1",
        [course_id],
        |row| row.get(0),
    )?;
    let (mut created, mut updated) = (0_i64, 0_i64);
    for (day, start, end) in days {
        let date = day.format("%Y-%m-%d").to_string();
        let existing: Option<(i64, Option<String>)> = transaction
            .query_row(
                "SELECT id, start_time FROM class_sessions WHERE course_id = ?1 AND date = ?2
                 ORDER BY number LIMIT 1",
                params![course_id, date],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        match existing {
            Some((id, time)) if time.as_deref().is_none_or(|value| value.trim().is_empty()) => {
                transaction.execute(
                    "UPDATE class_sessions SET start_time = ?1, end_time = ?2 WHERE id = ?3",
                    params![start, end, id],
                )?;
                updated += 1;
            }
            Some(_) => {}
            None => {
                transaction.execute(
                    "INSERT INTO class_sessions(course_id, number, title, date, start_time, end_time)
                     VALUES (?1, ?2, '', ?3, ?4, ?5)",
                    params![course_id, next, date, start, end],
                )?;
                next += 1;
                created += 1;
            }
        }
    }
    // Las sesiones se muestran por número: se renumeran por fecha para que el orden sea el real.
    let ordered: Vec<i64> = transaction
        .prepare(
            "SELECT id FROM class_sessions WHERE course_id = ?1
             ORDER BY date IS NULL, date, number",
        )?
        .query_map([course_id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    transaction.execute(
        "UPDATE class_sessions SET number = -number WHERE course_id = ?1",
        [course_id],
    )?;
    for (index, id) in ordered.iter().enumerate() {
        transaction.execute(
            "UPDATE class_sessions SET number = ?1 WHERE id = ?2",
            params![index as i64 + 1, id],
        )?;
    }
    transaction.commit()?;
    Ok(GenerateSessionsResult { created, updated })
}

pub fn load_blocks(connection: &Connection) -> AppResult<TimeBlocks> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [BLOCKS_KEY],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

pub fn store_blocks(connection: &Connection, blocks: &TimeBlocks) -> AppResult<()> {
    let first = parse_time(&blocks.first);
    let valid = first.is_some()
        && (5..=240).contains(&blocks.minutes)
        && blocks.gap <= 60
        && (1..=30).contains(&blocks.count);
    let last_end = first.map(|first| {
        first.hour() * 60 + first.minute() + blocks.count * (blocks.minutes + blocks.gap)
            - blocks.gap
    });
    if !valid || last_end.is_some_and(|end| end > 24 * 60) {
        return Err(AppError::Validation(
            "Revisa los bloques: deben caber en el día.".into(),
        ));
    }
    let value =
        serde_json::to_string(blocks).map_err(|error| AppError::Validation(error.to_string()))?;
    connection.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![BLOCKS_KEY, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn teaching_get_time_blocks(database: State<'_, Database>) -> AppResult<TimeBlocks> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    load_blocks(&connection)
}

#[tauri::command]
pub fn teaching_save_time_blocks(
    blocks: TimeBlocks,
    database: State<'_, Database>,
) -> AppResult<TimeBlocks> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    store_blocks(&connection, &blocks)?;
    Ok(blocks)
}

#[tauri::command]
pub fn teaching_get_schedule(database: State<'_, Database>) -> AppResult<Vec<ScheduleSlot>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    query_schedule(&connection)
}

#[tauri::command]
pub fn teaching_save_schedule_slot(
    input: ScheduleSlotInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<i64> {
    let id = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        save_slot(&mut connection, &input)?
    };
    super::notify(&app, &["calendar", "projects", "teaching"]);
    Ok(id)
}

#[tauri::command]
pub fn teaching_delete_schedule_slot(
    slot_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    {
        let connection = database.lock().map_err(|_| AppError::State)?;
        connection.execute("DELETE FROM course_schedule WHERE id = ?1", [slot_id])?;
    }
    super::notify(&app, &["calendar", "teaching"]);
    Ok(())
}

#[tauri::command]
pub fn teaching_generate_sessions(
    course_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<GenerateSessionsResult> {
    let result = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        generate_sessions(&mut connection, course_id)?
    };
    super::notify(&app, &["teaching"]);
    Ok(result)
}
