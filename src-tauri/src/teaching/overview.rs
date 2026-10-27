//! Panel de Resumen de una materia: cómo van los estudiantes en notas y asistencia,
//! clase a clase y evaluación a evaluación, con lo que viene en la agenda. Qué paneles
//! se muestran y en qué orden lo elige el usuario (`settings.teaching_overview_layout`).

use super::{
    commands::course,
    error::{AppError, AppResult},
    models::{
        ChartValue, CourseOverview, EvaluationAverage, NextClass, OverviewLayout, OverviewRules,
        OverviewStats, OverviewWidget, SessionAttendance, StudentOverview, UpcomingItem,
    },
    sync::parse_local,
};
use crate::{commands::calendar::occurrences_of, database::Database};
use chrono::Local;
use rusqlite::{Connection, OptionalExtension, params};
use tauri::State;

const LAYOUT_KEY: &str = "teaching_overview_layout";
/// Paneles disponibles, en su orden por defecto.
pub const WIDGETS: &[&str] = &[
    "kpis",
    "attention",
    "agenda",
    "plan",
    "attendance-trend",
    "grade-distribution",
    "evaluations",
    "students",
    "groups",
    "quick-actions",
];
const AGENDA_DAYS: i64 = 21;
const NEXT_CLASSES: usize = 4;

fn rules(connection: &Connection, course_id: i64) -> AppResult<OverviewRules> {
    Ok(connection.query_row(
        "SELECT passing_grade, attendance_minimum, low_grade_alert, low_attendance_alert,
                promotion_requires_attendance
         FROM courses WHERE id = ?1",
        [course_id],
        |row| {
            Ok(OverviewRules {
                passing_grade: row.get(0)?,
                attendance_minimum: row.get(1)?,
                low_grade_alert: row.get(2)?,
                low_attendance_alert: row.get(3)?,
                promotion_requires_attendance: row.get(4)?,
            })
        },
    )?)
}

/// Nota ponderada sobre lo evaluado (0–100), asistencia (P, J y T cuentan) sobre las
/// clases realizadas, ausencias y equipo de cada estudiante activo.
fn students(
    connection: &Connection,
    course_id: i64,
    rules: &OverviewRules,
) -> AppResult<Vec<StudentOverview>> {
    let held: i64 = connection.query_row(
        "SELECT COUNT(*) FROM class_sessions WHERE course_id = ?1 AND is_held = 1",
        [course_id],
        |row| row.get(0),
    )?;
    let rows = connection
        .prepare(
            "SELECT e.id, st.name, st.identification, sg.name,
                (SELECT SUM((g.score / ev.max_score) * ev.weight) FROM evaluations ev
                 JOIN grades g ON g.evaluation_id = ev.id AND g.enrollment_id = e.id
                 WHERE ev.course_id = e.course_id AND ev.active = 1 AND g.score IS NOT NULL),
                (SELECT SUM(ev.weight) FROM evaluations ev
                 JOIN grades g ON g.evaluation_id = ev.id AND g.enrollment_id = e.id
                 WHERE ev.course_id = e.course_id AND ev.active = 1 AND g.score IS NOT NULL),
                (SELECT COUNT(*) FROM attendance_records ar JOIN class_sessions s ON s.id = ar.session_id
                 WHERE ar.enrollment_id = e.id AND s.is_held = 1 AND ar.status IN ('P', 'J', 'T')),
                (SELECT COUNT(*) FROM attendance_records ar JOIN class_sessions s ON s.id = ar.session_id
                 WHERE ar.enrollment_id = e.id AND s.is_held = 1 AND ar.status = 'A')
             FROM enrollments e
             JOIN students st ON st.id = e.student_id
             LEFT JOIN group_memberships gm ON gm.enrollment_id = e.id
             LEFT JOIN student_groups sg ON sg.id = gm.group_id
             WHERE e.course_id = ?1 AND e.status = 'active'
             ORDER BY st.name",
        )?
        .query_map([course_id], |row| {
            let points: Option<f64> = row.get(4)?;
            let weight: Option<f64> = row.get(5)?;
            let attended: i64 = row.get(6)?;
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                match (points, weight) {
                    (Some(points), Some(weight)) if weight > 0.0 => Some(points / weight * 100.0),
                    _ => None,
                },
                if held == 0 { 0.0 } else { attended as f64 / held as f64 * 100.0 },
                row.get::<_, i64>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(
            |(enrollment_id, name, identification, group_name, grade, attendance, absences)| {
                let mut reasons = Vec::new();
                if grade.is_some_and(|grade| grade < rules.low_grade_alert) {
                    reasons.push("nota baja".to_string());
                }
                if held > 0 && attendance < rules.low_attendance_alert {
                    reasons.push("asistencia baja".to_string());
                }
                let grade_ok = grade.is_some_and(|grade| grade >= rules.passing_grade);
                let attendance_ok = !rules.promotion_requires_attendance
                    || held == 0
                    || attendance >= rules.attendance_minimum;
                let status = if !reasons.is_empty() {
                    "at_risk"
                } else if grade.is_none() {
                    "ungraded"
                } else if grade_ok && attendance_ok {
                    "approved"
                } else {
                    "at_risk"
                };
                StudentOverview {
                    enrollment_id,
                    name,
                    identification,
                    group_name,
                    grade,
                    attendance,
                    absences,
                    status: status.to_string(),
                    reasons,
                }
            },
        )
        .collect())
}

fn sessions(connection: &Connection, course_id: i64) -> AppResult<Vec<SessionAttendance>> {
    Ok(connection
        .prepare(
            "SELECT s.id, s.number, s.date,
                SUM(ar.status = 'P'), SUM(ar.status = 'T'), SUM(ar.status = 'J'), SUM(ar.status = 'A'),
                (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id AND e.status = 'active')
             FROM class_sessions s
             LEFT JOIN attendance_records ar ON ar.session_id = s.id
                AND ar.enrollment_id IN (SELECT id FROM enrollments WHERE course_id = s.course_id AND status = 'active')
             WHERE s.course_id = ?1 AND s.is_held = 1
             GROUP BY s.id ORDER BY s.date IS NULL, s.date, s.number",
        )?
        .query_map([course_id], |row| {
            let present = row.get::<_, Option<i64>>(3)?.unwrap_or(0);
            let late = row.get::<_, Option<i64>>(4)?.unwrap_or(0);
            let excused = row.get::<_, Option<i64>>(5)?.unwrap_or(0);
            let absent = row.get::<_, Option<i64>>(6)?.unwrap_or(0);
            let enrolled: i64 = row.get(7)?;
            Ok(SessionAttendance {
                session_id: row.get(0)?,
                number: row.get(1)?,
                date: row.get(2)?,
                present,
                late,
                excused,
                absent,
                unmarked: (enrolled - present - late - excused - absent).max(0),
                rate: if enrolled == 0 {
                    0.0
                } else {
                    (present + late + excused) as f64 / enrolled as f64 * 100.0
                },
            })
        })?
        .collect::<Result<_, _>>()?)
}

fn evaluations(connection: &Connection, course_id: i64) -> AppResult<Vec<EvaluationAverage>> {
    Ok(connection
        .prepare(
            "SELECT ev.id, ev.name, ev.weight, ev.max_score, ev.due_date,
                AVG(CASE WHEN g.score IS NOT NULL THEN g.score / ev.max_score * 100 END),
                COUNT(g.score),
                (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = ev.course_id AND e.status = 'active')
             FROM evaluations ev
             LEFT JOIN grades g ON g.evaluation_id = ev.id
                AND g.enrollment_id IN (SELECT id FROM enrollments WHERE course_id = ev.course_id AND status = 'active')
             WHERE ev.course_id = ?1 AND ev.active = 1
             GROUP BY ev.id ORDER BY ev.sort_order, ev.id",
        )?
        .query_map([course_id], |row| {
            Ok(EvaluationAverage {
                id: row.get(0)?,
                name: row.get(1)?,
                weight: row.get(2)?,
                max_score: row.get(3)?,
                due_date: row.get(4)?,
                average: row.get(5)?,
                graded: row.get(6)?,
                total: row.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?)
}

fn groups(connection: &Connection, course_id: i64) -> AppResult<Vec<ChartValue>> {
    Ok(connection
        .prepare(
            "SELECT sg.name, AVG(CASE WHEN ev.max_score > 0 THEN g.score / ev.max_score * 100 END)
             FROM student_groups sg
             JOIN group_memberships gm ON gm.group_id = sg.id
             JOIN grades g ON g.enrollment_id = gm.enrollment_id
             JOIN evaluations ev ON ev.id = g.evaluation_id AND ev.active = 1
             WHERE sg.course_id = ?1 AND g.score IS NOT NULL
             GROUP BY sg.id ORDER BY sg.name",
        )?
        .query_map([course_id], |row| {
            Ok(ChartValue {
                label: row.get(0)?,
                value: row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
            })
        })?
        .collect::<Result<_, _>>()?)
}

/// Entregas y planificación de los próximos días, ordenadas por fecha.
fn agenda(connection: &Connection, course_id: i64, now: i64) -> AppResult<Vec<UpcomingItem>> {
    let until = now + AGENDA_DAYS * 86_400;
    let mut items: Vec<(i64, UpcomingItem)> = Vec::new();
    let deliveries: Vec<(String, String)> = connection
        .prepare(
            "SELECT name, due_date FROM evaluations
             WHERE course_id = ?1 AND active = 1 AND due_date IS NOT NULL",
        )?
        .query_map([course_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (name, due) in deliveries {
        if let Some((at, has_time)) = parse_local(&due)
            && at + if has_time { 0 } else { 86_400 } > now
            && at < until
        {
            items.push((
                at,
                UpcomingItem {
                    title: name,
                    kind: "delivery".to_string(),
                    starts_at: due,
                },
            ));
        }
    }
    let events: Vec<(String, String, String)> = connection
        .prepare("SELECT title, event_type, starts_at FROM academic_events WHERE course_id = ?1")?
        .query_map([course_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<Result<_, _>>()?;
    for (title, kind, starts) in events {
        if let Some((at, has_time)) = parse_local(&starts)
            && at + if has_time { 0 } else { 86_400 } > now
            && at < until
        {
            items.push((
                at,
                UpcomingItem {
                    title,
                    kind,
                    starts_at: starts,
                },
            ));
        }
    }
    items.sort_by_key(|(at, _)| *at);
    Ok(items.into_iter().map(|(_, item)| item).collect())
}

/// Próximas clases según el horario (sin las quitadas a mano, como los festivos).
fn next_classes(connection: &Connection, course_id: i64, now: i64) -> AppResult<Vec<NextClass>> {
    let slots: Vec<(String, String, String)> = connection
        .prepare(
            "SELECT calendar_event_id, kind, room FROM course_schedule
             WHERE course_id = ?1 AND calendar_event_id IS NOT NULL",
        )?
        .query_map([course_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<Result<_, _>>()?;
    let ids: Vec<String> = slots.iter().map(|slot| slot.0.clone()).collect();
    let mut classes: Vec<NextClass> = occurrences_of(connection, &ids, now, now + 15 * 86_400)?
        .into_iter()
        .filter(|event| event.ends_at > now)
        .filter_map(|event| {
            let (_, kind, room) = slots.iter().find(|slot| slot.0 == event.id)?;
            Some(NextClass {
                starts_at: event.starts_at,
                ends_at: event.ends_at,
                kind: kind.clone(),
                room: room.clone(),
            })
        })
        .collect();
    classes.sort_by_key(|item| item.starts_at);
    classes.truncate(NEXT_CLASSES);
    Ok(classes)
}

pub fn build_overview(
    connection: &Connection,
    course_id: i64,
    now: i64,
) -> AppResult<CourseOverview> {
    let course = course(connection, course_id)?;
    let rules = rules(connection, course_id)?;
    let students = students(connection, course_id, &rules)?;
    let count = |sql: &str| -> AppResult<i64> {
        Ok(connection.query_row(sql, [course_id], |row| row.get(0))?)
    };
    let graded: Vec<f64> = students
        .iter()
        .filter_map(|student| student.grade)
        .collect();
    let mut bands = [0_f64; 4];
    for grade in &graded {
        let band = if *grade < 60.0 {
            0
        } else if *grade < rules.passing_grade {
            1
        } else if *grade < 90.0 {
            2
        } else {
            3
        };
        bands[band] += 1.0;
    }
    let stats = OverviewStats {
        active_students: students.len() as i64,
        attendance_average: if students.is_empty() {
            0.0
        } else {
            students
                .iter()
                .map(|student| student.attendance)
                .sum::<f64>()
                / students.len() as f64
        },
        grade_average: (!graded.is_empty())
            .then(|| graded.iter().sum::<f64>() / graded.len() as f64),
        configured_weight: connection.query_row(
            "SELECT COALESCE(SUM(weight), 0) FROM evaluations WHERE course_id = ?1 AND active = 1",
            [course_id],
            |row| row.get(0),
        )?,
        held_sessions: count(
            "SELECT COUNT(*) FROM class_sessions WHERE course_id = ?1 AND is_held = 1",
        )?,
        total_sessions: count("SELECT COUNT(*) FROM class_sessions WHERE course_id = ?1")?,
        active_evaluations: count(
            "SELECT COUNT(*) FROM evaluations WHERE course_id = ?1 AND active = 1",
        )?,
        student_groups: count("SELECT COUNT(*) FROM student_groups WHERE course_id = ?1")?,
        approved: students
            .iter()
            .filter(|student| student.status == "approved")
            .count() as i64,
        at_risk: students
            .iter()
            .filter(|student| student.status == "at_risk")
            .count() as i64,
        ungraded: students
            .iter()
            .filter(|student| student.status == "ungraded")
            .count() as i64,
    };
    Ok(CourseOverview {
        course,
        stats,
        grade_bands: [
            "Crítico (menos de 60)",
            "En riesgo",
            "Satisfactorio",
            "Excelente (90 o más)",
        ]
        .iter()
        .zip(bands)
        .map(|(label, value)| ChartValue {
            label: label.to_string(),
            value,
        })
        .collect(),
        sessions: sessions(connection, course_id)?,
        evaluations: evaluations(connection, course_id)?,
        groups: groups(connection, course_id)?,
        agenda: agenda(connection, course_id, now)?,
        next_classes: next_classes(connection, course_id, now)?,
        syllabus: super::syllabus::course_progress(
            connection,
            course_id,
            chrono::DateTime::from_timestamp(now, 0)
                .map(|moment| moment.with_timezone(&Local).date_naive())
                .unwrap_or_else(|| Local::now().date_naive()),
        )?,
        students,
        rules,
    })
}

/// Paneles guardados, completados con los que falten (nuevos) al final y visibles.
pub fn load_layout(connection: &Connection) -> AppResult<OverviewLayout> {
    let stored: Option<OverviewLayout> = connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [LAYOUT_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|value| serde_json::from_str(&value).ok());
    let mut widgets: Vec<OverviewWidget> = stored
        .map(|layout| layout.widgets)
        .unwrap_or_default()
        .into_iter()
        .filter(|widget| WIDGETS.contains(&widget.id.as_str()))
        .collect();
    for id in WIDGETS {
        if !widgets.iter().any(|widget| widget.id == *id) {
            widgets.push(OverviewWidget {
                id: id.to_string(),
                visible: true,
            });
        }
    }
    Ok(OverviewLayout { widgets })
}

pub fn store_layout(connection: &Connection, layout: &OverviewLayout) -> AppResult<OverviewLayout> {
    let mut seen = Vec::new();
    for widget in &layout.widgets {
        if !WIDGETS.contains(&widget.id.as_str()) || seen.contains(&widget.id) {
            return Err(AppError::Validation("Panel del resumen no válido.".into()));
        }
        seen.push(widget.id.clone());
    }
    let value =
        serde_json::to_string(layout).map_err(|error| AppError::Validation(error.to_string()))?;
    connection.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![LAYOUT_KEY, value],
    )?;
    load_layout(connection)
}

#[tauri::command]
pub fn teaching_get_overview(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<CourseOverview> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    build_overview(&connection, course_id, Local::now().timestamp())
}

#[tauri::command]
pub fn teaching_get_overview_layout(database: State<'_, Database>) -> AppResult<OverviewLayout> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    load_layout(&connection)
}

#[tauri::command]
pub fn teaching_save_overview_layout(
    layout: OverviewLayout,
    database: State<'_, Database>,
) -> AppResult<OverviewLayout> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    store_layout(&connection, &layout)
}
