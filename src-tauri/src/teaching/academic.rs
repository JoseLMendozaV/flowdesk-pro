//! Calendario académico: feriados nacionales de Panamá, el calendario de la UTP y los días
//! que añade el docente. Lo que suspende clases se quita del horario (excepciones de las
//! franjas en el calendario de FlowDesk) y de las sesiones de asistencia que aún no tienen
//! datos; si un día deja de ser libre, sus clases y sesiones vuelven.

use super::{
    error::{AppError, AppResult},
    models::{AcademicDay, AcademicDayInput, CalendarChange},
    schedule, sync,
};
use crate::database::Database;
use chrono::{Datelike, Local, NaiveDate, TimeDelta, Weekday};
use rusqlite::{Connection, OptionalExtension, params};
use tauri::{AppHandle, State};

const KINDS: &[&str] = &["holiday", "break", "exams", "term", "deadline"];

/// Calendario académico 2026-2027 de pregrado de la UTP, modificado por el Consejo
/// Académico el 6 de febrero de 2026: (tipo, desde, hasta, título). Los feriados
/// nacionales que también recoge salen de `panama_holidays`.
const UTP_2026_2027: &[(&str, &str, &str, &str)] = &[
    (
        "term",
        "2026-03-23",
        "2026-07-11",
        "Clases del I semestre 2026",
    ),
    ("break", "2026-04-02", "2026-04-04", "Días Santos"),
    (
        "exams",
        "2026-07-13",
        "2026-07-25",
        "Exámenes finales del I semestre",
    ),
    (
        "deadline",
        "2026-07-20",
        "2026-08-01",
        "Entrega de calificaciones del I semestre",
    ),
    ("break", "2026-08-14", "2026-08-14", "Aniversario de la UTP"),
    (
        "term",
        "2026-08-17",
        "2026-12-05",
        "Clases del II semestre 2026",
    ),
    ("break", "2026-11-02", "2026-11-02", "Día de los Difuntos"),
    (
        "break",
        "2026-11-04",
        "2026-11-04",
        "Día de los Símbolos Patrios",
    ),
    ("break", "2026-11-06", "2026-11-06", "Día compensado"),
    (
        "deadline",
        "2026-11-16",
        "2026-11-16",
        "Últimos retiros de asignatura",
    ),
    (
        "exams",
        "2026-12-07",
        "2026-12-22",
        "Exámenes finales del II semestre",
    ),
    (
        "deadline",
        "2026-12-14",
        "2026-12-29",
        "Entrega de calificaciones del II semestre",
    ),
    ("term", "2027-01-11", "2027-02-27", "Clases del verano 2027"),
    (
        "break",
        "2027-02-06",
        "2027-02-10",
        "Carnavales y Miércoles de Ceniza",
    ),
    (
        "exams",
        "2027-03-01",
        "2027-03-03",
        "Exámenes finales del verano",
    ),
    (
        "deadline",
        "2027-03-04",
        "2027-03-06",
        "Entrega de calificaciones del verano",
    ),
];

/// Domingo de Pascua (algoritmo anónimo gregoriano).
pub fn easter(year: i32) -> NaiveDate {
    let a = year % 19;
    let b = year / 100;
    let c = year % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    NaiveDate::from_ymd_opt(year, month as u32, day as u32).expect("fecha de Pascua válida")
}

/// Feriados nacionales de Panamá (Código de Trabajo, art. 46, y Ley 155 de 2020 para el
/// 20 de diciembre). El que cae en domingo se disfruta el lunes siguiente.
pub fn panama_holidays(year: i32) -> Vec<(NaiveDate, String)> {
    let fixed = [
        (1, 1, "Año Nuevo"),
        (1, 9, "Día de los Mártires"),
        (5, 1, "Día del Trabajo"),
        (11, 3, "Separación de Panamá de Colombia"),
        (11, 5, "Consolidación de la Separación (Colón)"),
        (11, 10, "Primer Grito de Independencia"),
        (11, 28, "Independencia de Panamá de España"),
        (12, 8, "Día de la Madre"),
        (12, 20, "Día de Duelo Nacional"),
        (12, 25, "Navidad"),
    ];
    let easter = easter(year);
    let mut days: Vec<(NaiveDate, String)> = fixed
        .iter()
        .filter_map(|(month, day, title)| {
            NaiveDate::from_ymd_opt(year, *month, *day).map(|date| (date, title.to_string()))
        })
        .chain([
            (
                easter - TimeDelta::days(47),
                "Martes de Carnaval".to_string(),
            ),
            (easter - TimeDelta::days(2), "Viernes Santo".to_string()),
        ])
        .map(|(date, title)| {
            if date.weekday() == Weekday::Sun {
                (date + TimeDelta::days(1), format!("{title} (puente)"))
            } else {
                (date, title)
            }
        })
        .collect();
    days.sort();
    days
}

/// Rangos de fechas (incluidos) sin clases.
#[derive(Debug, Default, Clone)]
pub struct DaysOff(Vec<(NaiveDate, NaiveDate)>);

impl DaysOff {
    pub fn load(connection: &Connection) -> rusqlite::Result<Self> {
        let rows: Vec<(String, String)> = connection
            .prepare("SELECT starts_on, ends_on FROM academic_calendar WHERE cancels_classes = 1")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        Ok(Self(
            rows.iter()
                .filter_map(|(from, until)| Some((parse_date(from)?, parse_date(until)?)))
                .collect(),
        ))
    }

    pub fn contains(&self, day: NaiveDate) -> bool {
        self.0
            .iter()
            .any(|(from, until)| *from <= day && day <= *until)
    }
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.get(..10)?, "%Y-%m-%d").ok()
}

fn map_day(row: &rusqlite::Row<'_>) -> rusqlite::Result<AcademicDay> {
    Ok(AcademicDay {
        id: row.get(0)?,
        title: row.get(1)?,
        kind: row.get(2)?,
        starts_on: row.get(3)?,
        ends_on: row.get(4)?,
        cancels_classes: row.get(5)?,
        source: row.get(6)?,
    })
}

pub fn query_days(connection: &Connection) -> AppResult<Vec<AcademicDay>> {
    Ok(connection
        .prepare(
            "SELECT id, title, kind, starts_on, ends_on, cancels_classes, source
             FROM academic_calendar ORDER BY starts_on, ends_on DESC, title",
        )?
        .query_map([], map_day)?
        .collect::<Result<_, _>>()?)
}

fn validate(input: &AcademicDayInput) -> AppResult<(NaiveDate, NaiveDate)> {
    if input.title.trim().is_empty() {
        return Err(AppError::Validation(
            "Escribe un nombre para el día.".into(),
        ));
    }
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Validation("Tipo de día no válido.".into()));
    }
    match (parse_date(&input.starts_on), parse_date(&input.ends_on)) {
        (Some(from), Some(until)) if until >= from && until - from <= TimeDelta::days(366) => {
            Ok((from, until))
        }
        _ => Err(AppError::Validation(
            "Revisa las fechas: el final no puede ser anterior al inicio.".into(),
        )),
    }
}

/// Guarda el día y devuelve su id y, si existía, las fechas que tenía (para devolver las
/// clases de los días que dejan de ser libres).
pub fn save_day(
    connection: &Connection,
    input: &AcademicDayInput,
) -> AppResult<(i64, Option<(NaiveDate, NaiveDate)>)> {
    let (from, until) = validate(input)?;
    let (from, until) = (
        from.format("%Y-%m-%d").to_string(),
        until.format("%Y-%m-%d").to_string(),
    );
    let Some(id) = input.id else {
        connection.execute(
            "INSERT INTO academic_calendar(title, kind, starts_on, ends_on, cancels_classes, source)
             VALUES (?1, ?2, ?3, ?4, ?5, 'user')",
            params![input.title.trim(), input.kind, from, until, input.cancels_classes],
        )?;
        return Ok((connection.last_insert_rowid(), None));
    };
    let previous = previous_range(connection, id)?;
    connection.execute(
        "UPDATE academic_calendar SET title = ?1, kind = ?2, starts_on = ?3, ends_on = ?4,
            cancels_classes = ?5
         WHERE id = ?6",
        params![
            input.title.trim(),
            input.kind,
            from,
            until,
            input.cancels_classes,
            id
        ],
    )?;
    Ok((id, previous))
}

/// Fechas del día si suspendía clases.
pub fn previous_range(
    connection: &Connection,
    id: i64,
) -> AppResult<Option<(NaiveDate, NaiveDate)>> {
    let stored: Option<(String, String, bool)> = connection
        .query_row(
            "SELECT starts_on, ends_on, cancels_classes FROM academic_calendar WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((from, until, cancels)) = stored else {
        return Err(AppError::Validation("Ese día ya no existe.".into()));
    };
    Ok(cancels
        .then(|| parse_date(&from).zip(parse_date(&until)))
        .flatten())
}

/// Añade los feriados nacionales de `years` y el calendario de la UTP. Lo que ya estaba
/// (mismo origen, fecha y nombre) no se duplica. Devuelve cuántos días se añadieron.
pub fn load_official(connection: &Connection, years: &[i32]) -> AppResult<i64> {
    let mut added = 0;
    let mut insert = connection.prepare(
        "INSERT OR IGNORE INTO academic_calendar(title, kind, starts_on, ends_on, cancels_classes, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for year in years {
        for (date, title) in panama_holidays(*year) {
            let date = date.format("%Y-%m-%d").to_string();
            added += insert.execute(params![title, "holiday", date, date, true, "panama"])? as i64;
        }
    }
    for (kind, from, until, title) in UTP_2026_2027 {
        let cancels = matches!(*kind, "holiday" | "break" | "exams");
        added += insert.execute(params![title, kind, from, until, cancels, "utp"])? as i64;
    }
    Ok(added)
}

/// Lleva el calendario académico al resto de Docencia: los días al calendario de FlowDesk,
/// las excepciones de las franjas del horario y las sesiones de asistencia. `freed`: fechas
/// que dejaron de ser libres, donde se vuelven a crear las sesiones del horario.
pub fn apply(
    connection: &Connection,
    freed: Option<(NaiveDate, NaiveDate)>,
) -> AppResult<CalendarChange> {
    let mut change = CalendarChange::default();
    let days: Vec<i64> = connection
        .prepare("SELECT id FROM academic_calendar")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for id in days {
        sync::sync_academic_day(connection, id)?;
    }
    let slots: Vec<i64> = connection
        .prepare("SELECT id FROM course_schedule")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for id in slots {
        sync::sync_schedule_slot(connection, id)?;
    }
    let days_off = DaysOff::load(connection)?;
    let courses: Vec<i64> = connection
        .prepare("SELECT id FROM courses")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for course_id in courses {
        let (removed, kept) =
            schedule::remove_sessions_on_days_off(connection, course_id, &days_off)?;
        change.removed_sessions += removed;
        change.kept_sessions += kept;
        if let Some(window) = freed {
            change.restored_sessions += schedule::restore_sessions(connection, course_id, window)?;
        }
        if removed > 0 {
            schedule::renumber_sessions(connection, course_id)?;
        }
    }
    Ok(change)
}

fn current_years() -> Vec<i32> {
    let year = Local::now().year();
    vec![year, year + 1]
}

#[tauri::command]
pub fn teaching_get_academic_calendar(
    database: State<'_, Database>,
) -> AppResult<Vec<AcademicDay>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    query_days(&connection)
}

#[tauri::command]
pub fn teaching_save_academic_day(
    input: AcademicDayInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<CalendarChange> {
    let change = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let (_, previous) = save_day(&transaction, &input)?;
        let change = apply(&transaction, previous)?;
        transaction.commit()?;
        change
    };
    super::notify(&app, &["calendar", "teaching"]);
    Ok(change)
}

#[tauri::command]
pub fn teaching_delete_academic_day(
    day_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<CalendarChange> {
    let change = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let previous = previous_range(&transaction, day_id)?;
        transaction.execute("DELETE FROM academic_calendar WHERE id = ?1", [day_id])?;
        let change = apply(&transaction, previous)?;
        transaction.commit()?;
        change
    };
    super::notify(&app, &["calendar", "teaching"]);
    Ok(change)
}

#[tauri::command]
pub fn teaching_load_official_calendar(
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<CalendarChange> {
    let change = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let added = load_official(&transaction, &current_years())?;
        let mut change = apply(&transaction, None)?;
        change.added = added;
        transaction.commit()?;
        change
    };
    super::notify(&app, &["calendar", "teaching"]);
    Ok(change)
}
