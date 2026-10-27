//! Plan del curso: los temas de la materia en orden, cada uno con su semana prevista o la
//! sesión de asistencia en que se da, el avance («tema 7 de 15») y una nota flotante para
//! preparar la clase. Pasar asistencia en una sesión cumple sus temas (disparador de la
//! migración 14).

use super::{
    academic::DaysOff,
    error::{AppError, AppResult},
    models::{CourseTopic, DistributeResult, Syllabus, SyllabusProgress, TopicInput, TopicSession},
    sync::sync_course_project,
};
use crate::{commands::notes, database::Database};
use chrono::{Datelike, Local, NaiveDate};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use tauri::{AppHandle, State};

const MAX_TOPICS: usize = 200;

fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.get(..10)?, "%Y-%m-%d").ok()
}

/// Lunes de la semana de la primera sesión con fecha: la semana 1 del curso.
fn first_monday(connection: &Connection, course_id: i64) -> rusqlite::Result<Option<NaiveDate>> {
    let first: Option<String> = connection.query_row(
        "SELECT MIN(date) FROM class_sessions WHERE course_id = ?1 AND date IS NOT NULL",
        [course_id],
        |row| row.get(0),
    )?;
    Ok(first
        .as_deref()
        .and_then(parse_date)
        .map(|day| day - chrono::TimeDelta::days(day.weekday().num_days_from_monday() as i64)))
}

fn week_of(first_monday: Option<NaiveDate>, date: Option<&str>) -> Option<i64> {
    let day = parse_date(date?)?;
    let monday = first_monday?;
    (day >= monday).then(|| (day - monday).num_days() / 7 + 1)
}

fn query_topics(connection: &Connection, course_id: i64) -> AppResult<Vec<CourseTopic>> {
    let monday = first_monday(connection, course_id)?;
    let mut topics: Vec<CourseTopic> = connection
        .prepare(
            "SELECT t.id, t.position, t.title, t.week, t.details, s.id, s.number, s.date, t.done,
                    (SELECT n.id FROM notes n WHERE n.id = t.note_id)
             FROM course_topics t LEFT JOIN class_sessions s ON s.id = t.session_id
             WHERE t.course_id = ?1 ORDER BY t.position, t.id",
        )?
        .query_map([course_id], |row| {
            Ok(CourseTopic {
                id: row.get(0)?,
                position: row.get(1)?,
                title: row.get(2)?,
                week: row.get(3)?,
                details: row.get(4)?,
                session_id: row.get(5)?,
                session_number: row.get(6)?,
                session_date: row.get(7)?,
                session_week: None,
                done: row.get(8)?,
                note_id: row.get(9)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    for topic in &mut topics {
        topic.session_week = week_of(monday, topic.session_date.as_deref());
    }
    Ok(topics)
}

/// Avance del plan: temas dados, el primero pendiente y los atrasados (su sesión ya pasó).
pub fn progress(topics: &[CourseTopic], today: NaiveDate) -> SyllabusProgress {
    let current = topics.iter().position(|topic| !topic.done);
    let current_topic = current.map(|index| &topics[index]);
    SyllabusProgress {
        total: topics.len() as i64,
        done: topics.iter().filter(|topic| topic.done).count() as i64,
        current: current.map(|index| index as i64 + 1),
        current_title: current_topic.map(|topic| topic.title.clone()),
        current_id: current_topic.map(|topic| topic.id),
        current_date: current_topic.and_then(|topic| topic.session_date.clone()),
        behind: topics
            .iter()
            .filter(|topic| {
                !topic.done
                    && topic
                        .session_date
                        .as_deref()
                        .and_then(parse_date)
                        .is_some_and(|day| day < today)
            })
            .count() as i64,
    }
}

pub fn course_progress(
    connection: &Connection,
    course_id: i64,
    today: NaiveDate,
) -> AppResult<SyllabusProgress> {
    Ok(progress(&query_topics(connection, course_id)?, today))
}

pub fn build_syllabus(
    connection: &Connection,
    course_id: i64,
    today: NaiveDate,
) -> AppResult<Syllabus> {
    let topics = query_topics(connection, course_id)?;
    let monday = first_monday(connection, course_id)?;
    let days_off = DaysOff::load(connection)?;
    let sessions = connection
        .prepare(
            "SELECT id, number, date, is_held FROM class_sessions WHERE course_id = ?1
             ORDER BY date IS NULL, date, number",
        )?
        .query_map([course_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, bool>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|(id, number, date, held)| TopicSession {
            id,
            number,
            week: week_of(monday, date.as_deref()),
            day_off: date
                .as_deref()
                .and_then(parse_date)
                .is_some_and(|day| days_off.contains(day)),
            date,
            held,
        })
        .collect();
    Ok(Syllabus {
        progress: progress(&topics, today),
        topics,
        sessions,
    })
}

fn require_course(connection: &Connection, course_id: i64) -> AppResult<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM courses WHERE id = ?1)",
        [course_id],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(AppError::Validation("La materia ya no existe.".into()))
    }
}

/// Cambia la sesión del tema. El tema de la sesión (el que se ve en Asistencia) se rellena
/// con el título si estaba vacío y se vacía al quitarlo si seguía siendo ese título.
fn link_session(
    connection: &Connection,
    topic_id: i64,
    title: &str,
    session_id: Option<i64>,
) -> AppResult<()> {
    let previous: Option<i64> = connection
        .query_row(
            "SELECT session_id FROM course_topics WHERE id = ?1",
            [topic_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    if previous == session_id {
        return Ok(());
    }
    if let Some(previous) = previous {
        connection.execute(
            "UPDATE class_sessions SET topic = '' WHERE id = ?1 AND topic = ?2",
            params![previous, title],
        )?;
    }
    connection.execute(
        "UPDATE course_topics SET session_id = ?1 WHERE id = ?2",
        params![session_id, topic_id],
    )?;
    if let Some(session_id) = session_id {
        connection.execute(
            "UPDATE class_sessions SET topic = ?1 WHERE id = ?2 AND trim(topic) = ''",
            params![title, session_id],
        )?;
    }
    Ok(())
}

pub fn save_topic(connection: &Connection, input: &TopicInput) -> AppResult<i64> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Validation("Escribe el tema.".into()));
    }
    if input.week.is_some_and(|week| !(1..=60).contains(&week)) {
        return Err(AppError::Validation(
            "La semana debe estar entre 1 y 60.".into(),
        ));
    }
    require_course(connection, input.course_id)?;
    if let Some(session_id) = input.session_id {
        let belongs: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM class_sessions WHERE id = ?1 AND course_id = ?2)",
            params![session_id, input.course_id],
            |row| row.get(0),
        )?;
        if !belongs {
            return Err(AppError::Validation(
                "Esa sesión no es de esta materia.".into(),
            ));
        }
    }
    let id = match input.id {
        Some(id) => {
            let old_title: Option<String> = connection
                .query_row(
                    "SELECT title FROM course_topics WHERE id = ?1 AND course_id = ?2",
                    params![id, input.course_id],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(old_title) = old_title else {
                return Err(AppError::Validation("Ese tema ya no existe.".into()));
            };
            // Si el tema de la sesión era el título anterior, sigue al nuevo.
            connection.execute(
                "UPDATE class_sessions SET topic = ?1
                 WHERE id = (SELECT session_id FROM course_topics WHERE id = ?2) AND topic = ?3",
                params![title, id, old_title],
            )?;
            connection.execute(
                "UPDATE course_topics SET title = ?1, week = ?2, details = ?3, done = ?4 WHERE id = ?5",
                params![title, input.week, input.details.trim(), input.done, id],
            )?;
            id
        }
        None => {
            connection.execute(
                "INSERT INTO course_topics(course_id, position, title, week, details, done)
                 VALUES (?1, (SELECT COALESCE(MAX(position), 0) + 1 FROM course_topics
                              WHERE course_id = ?1), ?2, ?3, ?4, ?5)",
                params![
                    input.course_id,
                    title,
                    input.week,
                    input.details.trim(),
                    input.done
                ],
            )?;
            connection.last_insert_rowid()
        }
    };
    link_session(connection, id, title, input.session_id)?;
    Ok(id)
}

const SEPARATORS: [char; 7] = [':', '-', '.', ')', ' ', '–', '—'];

/// «Semana 3: …» → (3, «…»). El prefijo se compara sin mayúsculas y debe ir seguido de un
/// número y de un separador (o del final).
fn strip_numbered<'a>(text: &'a str, prefixes: &[&str]) -> Option<(i64, &'a str)> {
    for prefix in prefixes {
        let Some(head) = text.get(..prefix.len()) else {
            continue;
        };
        if !head.eq_ignore_ascii_case(prefix) {
            continue;
        }
        let rest = text[prefix.len()..].trim_start();
        let digits = rest.chars().take_while(char::is_ascii_digit).count();
        if digits == 0 {
            continue;
        }
        let after = &rest[digits..];
        if !after.is_empty() && !after.starts_with(SEPARATORS) {
            continue;
        }
        let number = rest[..digits].parse().ok()?;
        return Some((number, after.trim_start_matches(SEPARATORS)));
    }
    None
}

/// Una línea de un temario pegado: quita viñetas y numeración («1.», «Tema 3:»), y lee
/// «Semana 3:» (o «S3 -») como la semana prevista.
pub fn parse_topic_line(line: &str) -> Option<(String, Option<i64>)> {
    let mut text = line
        .trim()
        .trim_start_matches(['-', '•', '*', '·', '–', '—'])
        .trim_start();
    let mut week = None;
    if let Some((number, rest)) = strip_numbered(text, &["semana", "sem.", "sem", "s"]) {
        week = (1..=60).contains(&number).then_some(number);
        text = rest;
    }
    if let Some((_, rest)) = strip_numbered(text, &["tema", ""]) {
        // Un número suelto solo es numeración si le sigue un separador distinto del espacio.
        let numbered = text.to_ascii_lowercase().starts_with("tema")
            || text
                .trim_start_matches(|c: char| c.is_ascii_digit())
                .starts_with(['.', ')', '-', ':']);
        if numbered {
            text = rest;
        }
    }
    let text = text.trim();
    (!text.is_empty()).then(|| (text.chars().take(200).collect(), week))
}

pub fn add_topics(connection: &Connection, course_id: i64, text: &str) -> AppResult<i64> {
    require_course(connection, course_id)?;
    let lines: Vec<(String, Option<i64>)> = text.lines().filter_map(parse_topic_line).collect();
    if lines.is_empty() {
        return Err(AppError::Validation(
            "Escribe al menos un tema, uno por línea.".into(),
        ));
    }
    let existing: i64 = connection.query_row(
        "SELECT COUNT(*) FROM course_topics WHERE course_id = ?1",
        [course_id],
        |row| row.get(0),
    )?;
    if existing as usize + lines.len() > MAX_TOPICS {
        return Err(AppError::Validation(format!(
            "El plan admite hasta {MAX_TOPICS} temas."
        )));
    }
    for (title, week) in &lines {
        connection.execute(
            "INSERT INTO course_topics(course_id, position, title, week)
             VALUES (?1, (SELECT COALESCE(MAX(position), 0) + 1 FROM course_topics
                          WHERE course_id = ?1), ?2, ?3)",
            params![course_id, title, week],
        )?;
    }
    Ok(lines.len() as i64)
}

pub fn reorder_topics(connection: &Connection, course_id: i64, ids: &[i64]) -> AppResult<()> {
    let current: Vec<i64> = connection
        .prepare("SELECT id FROM course_topics WHERE course_id = ?1 ORDER BY id")?
        .query_map([course_id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let mut sorted = ids.to_vec();
    sorted.sort_unstable();
    if sorted != current {
        return Err(AppError::Validation(
            "El orden no coincide con los temas.".into(),
        ));
    }
    for (index, id) in ids.iter().enumerate() {
        connection.execute(
            "UPDATE course_topics SET position = ?1 WHERE id = ?2",
            params![index as i64 + 1, id],
        )?;
    }
    Ok(())
}

/// Reparte los temas pendientes sin sesión, en orden, entre las sesiones que siguen a la
/// última ya asignada (sin contar las de días libres): uno por sesión, o en la primera
/// sesión de su semana prevista. Con `reset`, antes quita la sesión de todos los temas pendientes.
pub fn distribute(
    connection: &Connection,
    course_id: i64,
    reset: bool,
) -> AppResult<DistributeResult> {
    require_course(connection, course_id)?;
    if reset {
        let pending: Vec<(i64, String)> = connection
            .prepare(
                "SELECT id, title FROM course_topics
                 WHERE course_id = ?1 AND done = 0 AND session_id IS NOT NULL",
            )?
            .query_map([course_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (id, title) in pending {
            link_session(connection, id, &title, None)?;
        }
    }
    let monday = first_monday(connection, course_id)?;
    let days_off = DaysOff::load(connection)?;
    let last_linked: Option<String> = connection.query_row(
        "SELECT MAX(s.date) FROM course_topics t JOIN class_sessions s ON s.id = t.session_id
         WHERE t.course_id = ?1",
        [course_id],
        |row| row.get(0),
    )?;
    let mut free: Vec<(i64, Option<i64>)> = connection
        .prepare(
            "SELECT s.id, s.date FROM class_sessions s
             WHERE s.course_id = ?1 AND s.date IS NOT NULL AND s.is_held = 0
               AND (?2 IS NULL OR s.date > ?2)
               AND NOT EXISTS(SELECT 1 FROM course_topics t WHERE t.session_id = s.id)
             ORDER BY s.date, s.number",
        )?
        .query_map(params![course_id, last_linked], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|(_, date)| parse_date(date).is_none_or(|day| !days_off.contains(day)))
        .map(|(id, date)| (id, week_of(monday, Some(&date))))
        .collect();
    let topics: Vec<(i64, String, Option<i64>)> = connection
        .prepare(
            "SELECT id, title, week FROM course_topics
             WHERE course_id = ?1 AND done = 0 AND session_id IS NULL ORDER BY position, id",
        )?
        .query_map([course_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<Result<_, _>>()?;
    let mut result = DistributeResult::default();
    for (id, title, week) in topics {
        // Con semana prevista, la primera sesión libre de esa semana o posterior.
        let index = match week {
            Some(week) => free
                .iter()
                .position(|(_, session_week)| session_week.is_none_or(|value| value >= week)),
            None => (!free.is_empty()).then_some(0),
        };
        match index {
            Some(index) => {
                // El plan avanza en orden: las sesiones que se saltan quedan sin tema.
                let (session_id, _) = free.drain(..=index).next_back().expect("índice válido");
                link_session(connection, id, &title, Some(session_id))?;
                result.linked += 1;
            }
            None => result.left += 1,
        }
    }
    Ok(result)
}

fn text(value: &str) -> Value {
    json!({ "type": "text", "text": value })
}

fn heading(value: &str) -> Value {
    json!({ "type": "heading", "attrs": { "level": 3 }, "content": [text(value)] })
}

fn paragraph(value: &str) -> Value {
    if value.is_empty() {
        json!({ "type": "paragraph" })
    } else {
        json!({ "type": "paragraph", "content": [text(value)] })
    }
}

/// Guion de la nota para preparar la clase.
pub fn preparation_document(subtitle: &str, details: &str) -> String {
    let empty_item = json!({ "type": "listItem", "content": [{ "type": "paragraph" }] });
    let empty_task = json!({ "type": "taskItem", "attrs": { "checked": false }, "content": [{ "type": "paragraph" }] });
    let mut content = vec![paragraph(subtitle)];
    if !details.trim().is_empty() {
        content.extend(details.lines().map(|line| paragraph(line.trim())));
    }
    content.extend([
        heading("Objetivos"),
        json!({ "type": "bulletList", "content": [empty_item.clone()] }),
        heading("Actividades"),
        json!({ "type": "taskList", "content": [empty_task] }),
        heading("Materiales"),
        json!({ "type": "bulletList", "content": [empty_item] }),
        heading("Después de la clase"),
        paragraph(""),
    ]);
    json!({ "type": "doc", "content": content }).to_string()
}

fn short_date(value: &str) -> String {
    const DAYS: [&str; 7] = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
    const MONTHS: [&str; 12] = [
        "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic",
    ];
    parse_date(value)
        .map(|day| {
            format!(
                "{} {} {}",
                DAYS[day.weekday().num_days_from_monday() as usize],
                day.day(),
                MONTHS[day.month0() as usize]
            )
        })
        .unwrap_or_default()
}

/// Nota de preparación del tema: la existente (si no se borró) o una nueva con el guion,
/// en el proyecto de la materia. Devuelve su id; la ventana se abre fuera del bloqueo.
pub fn prepare_note(connection: &Connection, topic_id: i64) -> AppResult<String> {
    struct Topic {
        course_id: i64,
        title: String,
        details: String,
        week: Option<i64>,
        number: Option<i64>,
        date: Option<String>,
        note_id: Option<String>,
        course_title: String,
    }
    let topic = connection
        .query_row(
            "SELECT t.course_id, t.title, t.details, t.week, s.number, s.date,
                    (SELECT n.id FROM notes n WHERE n.id = t.note_id), c.title
             FROM course_topics t JOIN courses c ON c.id = t.course_id
             LEFT JOIN class_sessions s ON s.id = t.session_id WHERE t.id = ?1",
            [topic_id],
            |row| {
                Ok(Topic {
                    course_id: row.get(0)?,
                    title: row.get(1)?,
                    details: row.get(2)?,
                    week: row.get(3)?,
                    number: row.get(4)?,
                    date: row.get(5)?,
                    note_id: row.get(6)?,
                    course_title: row.get(7)?,
                })
            },
        )
        .optional()?;
    let Some(Topic {
        course_id,
        title,
        details,
        week,
        number,
        date,
        note_id,
        course_title,
    }) = topic
    else {
        return Err(AppError::Validation("Ese tema ya no existe.".into()));
    };
    if let Some(note_id) = note_id {
        return Ok(note_id);
    }
    let position: i64 = connection.query_row(
        "SELECT COUNT(*) FROM course_topics t, course_topics me
         WHERE me.id = ?1 AND t.course_id = me.course_id
           AND (t.position < me.position OR (t.position = me.position AND t.id <= me.id))",
        [topic_id],
        |row| row.get(0),
    )?;
    let when = match (number, date.as_deref(), week) {
        (Some(number), Some(date), _) => format!("Clase {number} · {}", short_date(date)),
        (Some(number), None, _) => format!("Clase {number}"),
        (None, _, Some(week)) => format!("Semana {week}"),
        _ => "Sin sesión asignada".to_string(),
    };
    let subtitle = format!("{course_title} · Tema {position} · {when}");
    let project_id = sync_course_project(connection, course_id)?;
    let note_id = notes::insert_prepared_note(
        connection,
        &format!("Preparar: {title}"),
        &preparation_document(&subtitle, &details),
        project_id.as_deref(),
    )?;
    connection.execute(
        "UPDATE course_topics SET note_id = ?1 WHERE id = ?2",
        params![note_id, topic_id],
    )?;
    Ok(note_id)
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

#[tauri::command]
pub fn teaching_get_syllabus(course_id: i64, database: State<'_, Database>) -> AppResult<Syllabus> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    build_syllabus(&connection, course_id, today())
}

#[tauri::command]
pub fn teaching_save_topic(
    input: TopicInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<i64> {
    let id = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let id = save_topic(&transaction, &input)?;
        transaction.commit()?;
        id
    };
    super::notify(&app, &["teaching"]);
    Ok(id)
}

#[tauri::command]
pub fn teaching_delete_topic(
    topic_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let title: Option<String> = transaction
            .query_row(
                "SELECT title FROM course_topics WHERE id = ?1",
                [topic_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(title) = title {
            link_session(&transaction, topic_id, &title, None)?;
            transaction.execute("DELETE FROM course_topics WHERE id = ?1", [topic_id])?;
        }
        transaction.commit()?;
    }
    super::notify(&app, &["teaching"]);
    Ok(())
}

#[tauri::command]
pub fn teaching_set_topic_done(
    topic_id: i64,
    done: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    {
        let connection = database.lock().map_err(|_| AppError::State)?;
        connection.execute(
            "UPDATE course_topics SET done = ?1 WHERE id = ?2",
            params![done, topic_id],
        )?;
    }
    super::notify(&app, &["teaching"]);
    Ok(())
}

#[tauri::command]
pub fn teaching_add_topics(
    course_id: i64,
    text: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<i64> {
    let added = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let added = add_topics(&transaction, course_id, &text)?;
        transaction.commit()?;
        added
    };
    super::notify(&app, &["teaching"]);
    Ok(added)
}

#[tauri::command]
pub fn teaching_reorder_topics(
    course_id: i64,
    ids: Vec<i64>,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        reorder_topics(&transaction, course_id, &ids)?;
        transaction.commit()?;
    }
    super::notify(&app, &["teaching"]);
    Ok(())
}

#[tauri::command]
pub fn teaching_distribute_topics(
    course_id: i64,
    reset: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<DistributeResult> {
    let result = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let result = distribute(&transaction, course_id, reset)?;
        transaction.commit()?;
        result
    };
    super::notify(&app, &["teaching"]);
    Ok(result)
}

/// Abre la nota flotante para preparar la clase del tema (la crea la primera vez).
#[tauri::command]
pub fn teaching_prepare_topic(
    topic_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<String> {
    let note_id = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let note_id = prepare_note(&transaction, topic_id)?;
        transaction.commit()?;
        note_id
    };
    notes::present_note(&app, &note_id)?;
    super::notify(&app, &["teaching", "projects"]);
    Ok(note_id)
}
