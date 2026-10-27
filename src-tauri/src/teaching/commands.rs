//! Comandos de Docencia. Proceden de Control Docente y conservan su lógica; usan la
//! conexión de FlowDesk y se registran con el prefijo `teaching_`.

use rusqlite::{Connection, OptionalExtension, params};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use super::{
    error::{AppError, AppResult},
    legacy,
    models::*,
    notify, sync,
};
use crate::database::Database;

const COURSE_SELECT: &str =
    "SELECT c.id, c.title, c.code, c.group_name, c.period_label, c.professor,
        c.is_archived, p.id, COALESCE(p.color, '#6C8CFF')
     FROM courses c LEFT JOIN projects p ON p.id = c.project_id";

fn map_course(row: &rusqlite::Row<'_>) -> rusqlite::Result<CourseSummary> {
    Ok(CourseSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        code: row.get(2)?,
        group_name: row.get(3)?,
        period_label: row.get(4)?,
        professor: row.get(5)?,
        is_archived: row.get(6)?,
        project_id: row.get(7)?,
        color: row.get(8)?,
    })
}

fn backups_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Validation(error.to_string()))?
        .join("teaching-backups"))
}

fn rubric_grade(scored: &[(f64, f64, f64)], evaluation_max: f64) -> Option<f64> {
    let completed: f64 = scored.iter().map(|item| item.0).sum();
    if completed <= 0.0 {
        return None;
    }
    let weighted: f64 = scored
        .iter()
        .filter(|(_, maximum, _)| *maximum > 0.0)
        .map(|(weight, maximum, score)| (score / maximum) * weight)
        .sum();
    Some(((weighted / completed) * evaluation_max * 100.0).round() / 100.0)
}

pub fn courses(connection: &Connection) -> AppResult<Vec<CourseSummary>> {
    let mut statement = connection.prepare(&format!(
        "{COURSE_SELECT} ORDER BY c.is_archived, c.updated_at DESC, c.title"
    ))?;
    let rows = statement.query_map([], map_course)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub(super) fn course(connection: &Connection, course_id: i64) -> AppResult<CourseSummary> {
    connection
        .query_row(
            &format!("{COURSE_SELECT} WHERE c.id = ?1"),
            [course_id],
            map_course,
        )
        .optional()?
        .ok_or_else(|| AppError::Validation("El curso seleccionado ya no existe.".into()))
}

#[tauri::command]
pub fn teaching_get_bootstrap(
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<Bootstrap> {
    // Tras importar o crear la primera materia, el calendario oficial se carga solo.
    if super::academic::ensure_official_now(&database)?.is_some() {
        notify(&app, &["calendar"]);
    }
    let connection = database.lock().map_err(|_| AppError::State)?;
    let database_path =
        Database::path(&app).map_err(|error| AppError::Validation(error.to_string()))?;
    Ok(Bootstrap {
        database_path: database_path.to_string_lossy().into_owned(),
        has_legacy_import: legacy::was_imported(&connection)?.is_some(),
        courses: courses(&connection)?,
        desktop_database: app
            .path()
            .home_dir()
            .ok()
            .and_then(|home| legacy::desktop_database(&home))
            .map(|path| path.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub fn teaching_create_course(
    input: CourseInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<i64> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Validation(
            "Escribe el nombre de la asignatura.".into(),
        ));
    }
    let id = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO courses (title, code, group_name, period_label, professor)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                title,
                input.code.trim(),
                input.group_name.trim(),
                input.period_label.trim(),
                input.professor.trim()
            ],
        )?;
        let id = transaction.last_insert_rowid();
        // Cada materia tiene su proyecto en FlowDesk.
        sync::sync_course_project(&transaction, id)?;
        transaction.commit()?;
        id
    };
    notify(&app, &["projects", "teaching"]);
    Ok(id)
}

#[tauri::command]
pub fn teaching_get_students(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<Vec<StudentRow>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let mut statement = connection.prepare(
        r#"
        SELECT e.id, st.id, st.identification, st.name, st.email,
               st.guardian_name, st.guardian_phone, e.status, sg.name
        FROM enrollments e
        JOIN students st ON st.id = e.student_id
        LEFT JOIN group_memberships gm ON gm.enrollment_id = e.id
        LEFT JOIN student_groups sg ON sg.id = gm.group_id
        WHERE e.course_id = ?1
        ORDER BY CASE e.status WHEN 'active' THEN 0 ELSE 1 END, st.name
        "#,
    )?;
    let rows = statement.query_map([course_id], |row| {
        Ok(StudentRow {
            enrollment_id: row.get(0)?,
            student_id: row.get(1)?,
            identification: row.get(2)?,
            name: row.get(3)?,
            email: row.get(4)?,
            guardian_name: row.get(5)?,
            guardian_phone: row.get(6)?,
            status: row.get(7)?,
            group_name: row.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn teaching_add_student(
    course_id: i64,
    input: StudentInput,
    database: State<'_, Database>,
) -> AppResult<i64> {
    let identification = input.identification.trim();
    let name = input.name.trim();
    if identification.is_empty() || name.is_empty() {
        return Err(AppError::Validation(
            "La identificación y el nombre son obligatorios.".into(),
        ));
    }
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    transaction.execute(
        r#"
        INSERT INTO students (
            identification, name, email, guardian_name, guardian_email, guardian_phone
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(identification) DO UPDATE SET
            name = excluded.name,
            email = excluded.email,
            guardian_name = excluded.guardian_name,
            guardian_email = excluded.guardian_email,
            guardian_phone = excluded.guardian_phone
        "#,
        params![
            identification,
            name,
            input.email.trim(),
            input.guardian_name.trim(),
            input.guardian_email.trim(),
            input.guardian_phone.trim()
        ],
    )?;
    let student_id: i64 = transaction.query_row(
        "SELECT id FROM students WHERE identification = ?1",
        [identification],
        |row| row.get(0),
    )?;
    transaction.execute(
        "INSERT INTO enrollments (course_id, student_id) VALUES (?1, ?2)
         ON CONFLICT(course_id, student_id) DO UPDATE SET status = 'active'",
        params![course_id, student_id],
    )?;
    let enrollment_id: i64 = transaction.query_row(
        "SELECT id FROM enrollments WHERE course_id = ?1 AND student_id = ?2",
        params![course_id, student_id],
        |row| row.get(0),
    )?;
    transaction.commit()?;
    Ok(enrollment_id)
}

#[tauri::command]
pub fn teaching_update_student(
    enrollment_id: i64,
    input: StudentInput,
    status: String,
    database: State<'_, Database>,
) -> AppResult<()> {
    let identification = input.identification.trim();
    let name = input.name.trim();
    if identification.is_empty()
        || name.is_empty()
        || !matches!(status.as_str(), "active" | "inactive")
    {
        return Err(AppError::Validation(
            "Verifica la identificación, el nombre y el estado.".into(),
        ));
    }
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    let student_id: i64 = transaction.query_row(
        "SELECT student_id FROM enrollments WHERE id=?1",
        [enrollment_id],
        |row| row.get(0),
    )?;
    transaction.execute("UPDATE students SET identification=?1,name=?2,email=?3,guardian_name=?4,guardian_email=?5,guardian_phone=?6 WHERE id=?7",params![identification,name,input.email.trim(),input.guardian_name.trim(),input.guardian_email.trim(),input.guardian_phone.trim(),student_id])?;
    transaction.execute(
        "UPDATE enrollments SET status=?1 WHERE id=?2",
        params![status, enrollment_id],
    )?;
    transaction.commit()?;
    Ok(())
}

#[tauri::command]
pub fn teaching_get_attendance(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<AttendanceMatrix> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let students = matrix_students(&connection, course_id)?;
    let mut session_statement = connection.prepare(
        "SELECT id, number, title, date, start_time, end_time, topic, is_held FROM class_sessions
         WHERE course_id = ?1 ORDER BY number, date",
    )?;
    let sessions = session_statement
        .query_map([course_id], |row| {
            Ok(SessionColumn {
                id: row.get(0)?,
                number: row.get(1)?,
                title: row.get(2)?,
                date: row.get(3)?,
                start_time: row.get(4)?,
                end_time: row.get(5)?,
                topic: row.get(6)?,
                is_held: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut cell_statement = connection.prepare(
        "SELECT ar.enrollment_id, ar.session_id, ar.status
         FROM attendance_records ar
         JOIN enrollments e ON e.id = ar.enrollment_id
         WHERE e.course_id = ?1",
    )?;
    let cells = cell_statement
        .query_map([course_id], |row| {
            Ok(AttendanceCell {
                enrollment_id: row.get(0)?,
                session_id: row.get(1)?,
                status: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AttendanceMatrix {
        students,
        sessions,
        cells,
    })
}

#[tauri::command]
pub fn teaching_save_attendance(
    updates: Vec<AttendanceUpdate>,
    database: State<'_, Database>,
) -> AppResult<usize> {
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    store_attendance(&mut connection, &updates)
}

/// Guarda la asistencia. Una clase con asistencia registrada se da por realizada: las
/// sesiones creadas desde el horario empiezan como «No realizada» y no contarían en los promedios.
pub fn store_attendance(
    connection: &mut Connection,
    updates: &[AttendanceUpdate],
) -> AppResult<usize> {
    let transaction = connection.transaction()?;
    for update in updates {
        if !["", "P", "A", "J", "T"].contains(&update.status.as_str()) {
            return Err(AppError::Validation(
                "Estado de asistencia inválido.".into(),
            ));
        }
        if update.status.is_empty() {
            transaction.execute(
                "DELETE FROM attendance_records WHERE enrollment_id = ?1 AND session_id = ?2",
                params![update.enrollment_id, update.session_id],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO attendance_records (enrollment_id, session_id, status)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(enrollment_id, session_id) DO UPDATE SET status = excluded.status",
                params![update.enrollment_id, update.session_id, update.status],
            )?;
            transaction.execute(
                "UPDATE class_sessions SET is_held = 1 WHERE id = ?1 AND is_held = 0",
                [update.session_id],
            )?;
        }
    }
    transaction.commit()?;
    Ok(updates.len())
}

fn matrix_students(connection: &Connection, course_id: i64) -> AppResult<Vec<MatrixStudent>> {
    let mut statement = connection.prepare(
        "SELECT e.id, st.name, st.identification FROM enrollments e
         JOIN students st ON st.id = e.student_id
         WHERE e.course_id = ?1 AND e.status = 'active' ORDER BY st.name",
    )?;
    let rows = statement.query_map([course_id], |row| {
        Ok(MatrixStudent {
            enrollment_id: row.get(0)?,
            name: row.get(1)?,
            identification: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn teaching_get_gradebook(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<Gradebook> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let students = matrix_students(&connection, course_id)?;
    let mut evaluation_statement = connection.prepare(
        "SELECT id, name, evaluation_type, grading_mode, weight, max_score
         FROM evaluations WHERE course_id = ?1 AND active = 1 AND grading_mode = 'individual' ORDER BY sort_order, id",
    )?;
    let evaluations = evaluation_statement
        .query_map([course_id], |row| {
            Ok(EvaluationColumn {
                id: row.get(0)?,
                name: row.get(1)?,
                evaluation_type: row.get(2)?,
                grading_mode: row.get(3)?,
                weight: row.get(4)?,
                max_score: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut cell_statement = connection.prepare(
        "SELECT g.enrollment_id, g.evaluation_id, g.score FROM grades g
         JOIN enrollments e ON e.id = g.enrollment_id
         JOIN evaluations ev ON ev.id = g.evaluation_id
         WHERE e.course_id = ?1 AND ev.grading_mode = 'individual' AND ev.active = 1",
    )?;
    let cells = cell_statement
        .query_map([course_id], |row| {
            Ok(GradeCell {
                enrollment_id: row.get(0)?,
                evaluation_id: row.get(1)?,
                score: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Gradebook {
        students,
        evaluations,
        cells,
    })
}

#[tauri::command]
pub fn teaching_save_grades(
    updates: Vec<GradeUpdate>,
    database: State<'_, Database>,
) -> AppResult<usize> {
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    for update in &updates {
        if let Some(score) = update.score {
            let (max_score, grading_mode): (f64, String) = transaction.query_row(
                "SELECT max_score, grading_mode FROM evaluations WHERE id = ?1",
                [update.evaluation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if grading_mode != "individual" {
                return Err(AppError::Validation(
                    "Las evaluaciones grupales se registran por equipo.".into(),
                ));
            }
            if score < 0.0 || score > max_score {
                return Err(AppError::Validation(format!(
                    "La nota debe estar entre 0 y {max_score}."
                )));
            }
            transaction.execute(
                "INSERT INTO grades (enrollment_id, evaluation_id, score, updated_at)
                 VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
                 ON CONFLICT(enrollment_id, evaluation_id) DO UPDATE SET
                    score = excluded.score, updated_at = CURRENT_TIMESTAMP",
                params![update.enrollment_id, update.evaluation_id, score],
            )?;
        } else {
            transaction.execute(
                "DELETE FROM grades WHERE enrollment_id = ?1 AND evaluation_id = ?2",
                params![update.enrollment_id, update.evaluation_id],
            )?;
        }
    }
    transaction.commit()?;
    Ok(updates.len())
}

#[tauri::command]
pub fn teaching_get_group_gradebook(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<GroupGradebook> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let mut group_statement = connection.prepare(
        "SELECT sg.id, sg.name, COUNT(gm.id) FROM student_groups sg
         LEFT JOIN group_memberships gm ON gm.group_id=sg.id
         WHERE sg.course_id=?1 GROUP BY sg.id ORDER BY sg.name",
    )?;
    let groups = group_statement
        .query_map([course_id], |row| {
            Ok(GroupGradeRow {
                group_id: row.get(0)?,
                name: row.get(1)?,
                member_count: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut evaluation_statement = connection.prepare(
        "SELECT id,name,evaluation_type,grading_mode,weight,max_score FROM evaluations
         WHERE course_id=?1 AND active=1 AND grading_mode='group' ORDER BY sort_order,id",
    )?;
    let evaluations = evaluation_statement
        .query_map([course_id], |row| {
            Ok(EvaluationColumn {
                id: row.get(0)?,
                name: row.get(1)?,
                evaluation_type: row.get(2)?,
                grading_mode: row.get(3)?,
                weight: row.get(4)?,
                max_score: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut cell_statement = connection.prepare(
        "SELECT gg.group_id,gg.evaluation_id,gg.score FROM group_grades gg
         JOIN student_groups sg ON sg.id=gg.group_id JOIN evaluations ev ON ev.id=gg.evaluation_id
         WHERE sg.course_id=?1 AND ev.active=1",
    )?;
    let cells = cell_statement
        .query_map([course_id], |row| {
            Ok(GroupGradeCell {
                group_id: row.get(0)?,
                evaluation_id: row.get(1)?,
                score: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(GroupGradebook {
        groups,
        evaluations,
        cells,
    })
}

#[tauri::command]
pub fn teaching_save_group_grades(
    updates: Vec<GroupGradeUpdate>,
    database: State<'_, Database>,
) -> AppResult<usize> {
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    for update in &updates {
        let (max_score, mode, evaluation_course): (f64, String, i64) = transaction.query_row(
            "SELECT max_score,grading_mode,course_id FROM evaluations WHERE id=?1",
            [update.evaluation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let group_course: i64 = transaction.query_row(
            "SELECT course_id FROM student_groups WHERE id=?1",
            [update.group_id],
            |row| row.get(0),
        )?;
        if mode != "group" || group_course != evaluation_course {
            return Err(AppError::Validation(
                "El equipo y la evaluación grupal no coinciden.".into(),
            ));
        }
        transaction.execute(
            "DELETE FROM grades WHERE evaluation_id=?1 AND enrollment_id IN (SELECT enrollment_id FROM group_memberships WHERE group_id=?2)",
            params![update.evaluation_id,update.group_id],
        )?;
        if let Some(score) = update.score {
            if score < 0.0 || score > max_score {
                return Err(AppError::Validation(format!(
                    "La nota debe estar entre 0 y {max_score}."
                )));
            }
            transaction.execute(
                "INSERT INTO group_grades (group_id,evaluation_id,score,updated_at) VALUES (?1,?2,?3,CURRENT_TIMESTAMP)
                 ON CONFLICT(group_id,evaluation_id) DO UPDATE SET score=excluded.score,updated_at=CURRENT_TIMESTAMP",
                params![update.group_id,update.evaluation_id,score],
            )?;
            transaction.execute(
                "INSERT INTO grades (enrollment_id,evaluation_id,score,updated_at)
                 SELECT enrollment_id,?1,?2,CURRENT_TIMESTAMP FROM group_memberships WHERE group_id=?3
                 ON CONFLICT(enrollment_id,evaluation_id) DO UPDATE SET score=excluded.score,updated_at=CURRENT_TIMESTAMP",
                params![update.evaluation_id,score,update.group_id],
            )?;
        } else {
            transaction.execute(
                "DELETE FROM group_grades WHERE group_id=?1 AND evaluation_id=?2",
                params![update.group_id, update.evaluation_id],
            )?;
        }
    }
    transaction.commit()?;
    Ok(updates.len())
}

#[tauri::command]
pub fn teaching_get_groups(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<Vec<GroupRow>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let mut group_statement = connection.prepare(
        r#"
        SELECT sg.id, sg.name, sg.description,
               leader_student.name,
               COUNT(gm.id)
        FROM student_groups sg
        LEFT JOIN group_memberships gm ON gm.group_id = sg.id
        LEFT JOIN group_memberships leader_gm ON leader_gm.id = sg.leader_membership_id
        LEFT JOIN enrollments leader_e ON leader_e.id = leader_gm.enrollment_id
        LEFT JOIN students leader_student ON leader_student.id = leader_e.student_id
        WHERE sg.course_id = ?1
        GROUP BY sg.id, sg.name, sg.description, leader_student.name
        ORDER BY sg.name
        "#,
    )?;
    let groups = group_statement
        .query_map([course_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut result = Vec::with_capacity(groups.len());
    for (id, name, description, leader_name, member_count) in groups {
        let mut member_statement = connection.prepare(
            r#"
            SELECT e.id, st.name, st.identification,
                   CASE WHEN gm.id = sg.leader_membership_id THEN 1 ELSE 0 END
            FROM group_memberships gm
            JOIN student_groups sg ON sg.id = gm.group_id
            JOIN enrollments e ON e.id = gm.enrollment_id
            JOIN students st ON st.id = e.student_id
            WHERE gm.group_id = ?1 ORDER BY st.name
            "#,
        )?;
        let members = member_statement
            .query_map([id], |row| {
                Ok(GroupMember {
                    enrollment_id: row.get(0)?,
                    name: row.get(1)?,
                    identification: row.get(2)?,
                    is_leader: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        result.push(GroupRow {
            id,
            name,
            description,
            leader_name,
            member_count,
            members,
        });
    }
    Ok(result)
}

#[tauri::command]
pub fn teaching_save_group(input: GroupInput, database: State<'_, Database>) -> AppResult<i64> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Escribe el nombre del equipo.".into()));
    }
    if let Some(leader) = input.leader_enrollment_id
        && !input.enrollment_ids.contains(&leader)
    {
        return Err(AppError::Validation(
            "El líder debe estar seleccionado como integrante del equipo.".into(),
        ));
    }
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    let group_id = if let Some(id) = input.id {
        transaction.execute(
            "UPDATE student_groups SET name = ?1, description = ?2 WHERE id = ?3 AND course_id = ?4",
            params![name, input.description.trim(), id, input.course_id],
        )?;
        id
    } else {
        transaction.execute(
            "INSERT INTO student_groups (course_id, name, description) VALUES (?1, ?2, ?3)",
            params![input.course_id, name, input.description.trim()],
        )?;
        transaction.last_insert_rowid()
    };

    transaction.execute(
        "UPDATE student_groups SET leader_membership_id = NULL WHERE id = ?1",
        [group_id],
    )?;
    transaction.execute(
        "DELETE FROM grades WHERE enrollment_id IN
         (SELECT enrollment_id FROM group_memberships WHERE group_id=?1)
         AND evaluation_id IN
         (SELECT id FROM evaluations WHERE course_id=?2 AND grading_mode='group')",
        params![group_id, input.course_id],
    )?;
    transaction.execute(
        "DELETE FROM group_memberships WHERE group_id = ?1",
        [group_id],
    )?;
    for enrollment_id in &input.enrollment_ids {
        let belongs: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM enrollments WHERE id = ?1 AND course_id = ?2)",
            params![enrollment_id, input.course_id],
            |row| row.get(0),
        )?;
        if !belongs {
            return Err(AppError::Validation(
                "Uno de los estudiantes no pertenece al curso activo.".into(),
            ));
        }
        transaction.execute(
            "UPDATE student_groups SET leader_membership_id=NULL WHERE leader_membership_id IN
             (SELECT id FROM group_memberships WHERE enrollment_id=?1)",
            [enrollment_id],
        )?;
        transaction.execute(
            "DELETE FROM grades WHERE enrollment_id=?1 AND evaluation_id IN
             (SELECT id FROM evaluations WHERE course_id=?2 AND grading_mode='group')",
            params![enrollment_id, input.course_id],
        )?;
        transaction.execute(
            "DELETE FROM group_memberships WHERE enrollment_id = ?1",
            [enrollment_id],
        )?;
        transaction.execute(
            "INSERT INTO group_memberships (group_id, enrollment_id) VALUES (?1, ?2)",
            params![group_id, enrollment_id],
        )?;
    }
    if let Some(leader_enrollment_id) = input.leader_enrollment_id {
        let membership_id: i64 = transaction.query_row(
            "SELECT id FROM group_memberships WHERE group_id = ?1 AND enrollment_id = ?2",
            params![group_id, leader_enrollment_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "UPDATE student_groups SET leader_membership_id = ?1 WHERE id = ?2",
            params![membership_id, group_id],
        )?;
    }
    transaction.execute(
        "INSERT INTO grades (enrollment_id,evaluation_id,score,updated_at)
         SELECT gm.enrollment_id,gg.evaluation_id,gg.score,CURRENT_TIMESTAMP
         FROM group_memberships gm JOIN group_grades gg ON gg.group_id=gm.group_id
         WHERE gm.group_id=?1 AND gg.score IS NOT NULL
         ON CONFLICT(enrollment_id,evaluation_id) DO UPDATE SET score=excluded.score,updated_at=CURRENT_TIMESTAMP",
        [group_id],
    )?;
    transaction.commit()?;
    Ok(group_id)
}

#[tauri::command]
pub fn teaching_delete_group(group_id: i64, database: State<'_, Database>) -> AppResult<()> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    connection.execute("DELETE FROM student_groups WHERE id = ?1", [group_id])?;
    Ok(())
}

#[tauri::command]
pub fn teaching_get_evaluations(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<Vec<EvaluationRow>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let mut statement = connection.prepare(
        r#"
        SELECT ev.id, ev.name, ev.evaluation_type, ev.grading_mode, ev.weight,
               ev.max_score, ev.active, ev.sort_order, ev.due_date, COUNT(rc.id)
        FROM evaluations ev
        LEFT JOIN rubric_criteria rc ON rc.evaluation_id = ev.id
        WHERE ev.course_id = ?1
        GROUP BY ev.id ORDER BY ev.sort_order, ev.id
        "#,
    )?;
    let rows = statement.query_map([course_id], |row| {
        Ok(EvaluationRow {
            id: row.get(0)?,
            name: row.get(1)?,
            evaluation_type: row.get(2)?,
            grading_mode: row.get(3)?,
            weight: row.get(4)?,
            max_score: row.get(5)?,
            active: row.get(6)?,
            sort_order: row.get(7)?,
            due_date: row.get(8)?,
            rubric_count: row.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn teaching_save_evaluation(
    input: EvaluationInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<i64> {
    let id = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let id = store_evaluation(&transaction, &input)?;
        // La entrega con fecha aparece en el calendario.
        sync::sync_evaluation(&transaction, id)?;
        transaction.commit()?;
        id
    };
    notify(&app, &["calendar", "teaching"]);
    Ok(id)
}

fn store_evaluation(connection: &Connection, input: &EvaluationInput) -> AppResult<i64> {
    let name = input.name.trim();
    if name.is_empty() || input.weight <= 0.0 || input.weight > 100.0 || input.max_score <= 0.0 {
        return Err(AppError::Validation(
            "Verifica el nombre, el peso y el puntaje máximo de la evaluación.".into(),
        ));
    }
    if !["individual", "group"].contains(&input.grading_mode.as_str()) {
        return Err(AppError::Validation(
            "Modalidad de evaluación inválida.".into(),
        ));
    }
    if let Some(id) = input.id {
        connection.execute(
            r#"UPDATE evaluations SET name=?1, evaluation_type=?2, grading_mode=?3,
               weight=?4, max_score=?5, active=?6, due_date=?7 WHERE id=?8 AND course_id=?9"#,
            params![
                name,
                input.evaluation_type,
                input.grading_mode,
                input.weight,
                input.max_score,
                input.active,
                input.due_date,
                id,
                input.course_id
            ],
        )?;
        Ok(id)
    } else {
        let sort_order: i64 = connection.query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM evaluations WHERE course_id=?1",
            [input.course_id],
            |row| row.get(0),
        )?;
        connection.execute(
            r#"INSERT INTO evaluations (course_id,name,evaluation_type,grading_mode,weight,max_score,active,sort_order,due_date)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"#,
            params![input.course_id, name, input.evaluation_type, input.grading_mode,
                input.weight, input.max_score, input.active, sort_order, input.due_date],
        )?;
        Ok(connection.last_insert_rowid())
    }
}

#[tauri::command]
pub fn teaching_delete_evaluation(
    evaluation_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    {
        let connection = database.lock().map_err(|_| AppError::State)?;
        // El disparador quita también su entrega del calendario.
        connection.execute("DELETE FROM evaluations WHERE id=?1", [evaluation_id])?;
    }
    notify(&app, &["calendar", "teaching"]);
    Ok(())
}

#[tauri::command]
pub fn teaching_save_session(input: SessionInput, database: State<'_, Database>) -> AppResult<i64> {
    if input.number <= 0 {
        return Err(AppError::Validation(
            "El número de clase debe ser mayor que cero.".into(),
        ));
    }
    if let (Some(start), Some(end)) = (&input.start_time, &input.end_time) {
        // Las horas llegan como `HH:MM` (o `HH:MM:SS` en datos importados): se comparan como texto.
        if end.get(..5) <= start.get(..5) {
            return Err(AppError::Validation(
                "La hora de salida debe ser posterior a la hora de inicio.".into(),
            ));
        }
    }
    let connection = database.lock().map_err(|_| AppError::State)?;
    if let Some(id) = input.id {
        connection.execute(
            r#"UPDATE class_sessions SET number=?1,title=?2,date=?3,start_time=?4,end_time=?5,
               topic=?6,is_held=?7 WHERE id=?8 AND course_id=?9"#,
            params![
                input.number,
                input.title.trim(),
                input.date,
                input.start_time,
                input.end_time,
                input.topic.trim(),
                input.is_held,
                id,
                input.course_id
            ],
        )?;
        Ok(id)
    } else {
        connection.execute(
            r#"INSERT INTO class_sessions (course_id,number,title,date,start_time,end_time,topic,is_held)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"#,
            params![input.course_id,input.number,input.title.trim(),input.date,input.start_time,
                input.end_time,input.topic.trim(),input.is_held],
        )?;
        Ok(connection.last_insert_rowid())
    }
}

#[tauri::command]
pub fn teaching_delete_session(session_id: i64, database: State<'_, Database>) -> AppResult<()> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    connection.execute("DELETE FROM class_sessions WHERE id=?1", [session_id])?;
    Ok(())
}

#[tauri::command]
pub fn teaching_get_events(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<Vec<AcademicEventRow>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let mut statement = connection.prepare(
        "SELECT id,title,event_type,starts_at,ends_at,description,reminder_days
         FROM academic_events WHERE course_id=?1 ORDER BY starts_at",
    )?;
    let rows = statement.query_map([course_id], |row| {
        Ok(AcademicEventRow {
            id: row.get(0)?,
            title: row.get(1)?,
            event_type: row.get(2)?,
            starts_at: row.get(3)?,
            ends_at: row.get(4)?,
            description: row.get(5)?,
            reminder_days: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn teaching_save_event(
    input: AcademicEventInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<i64> {
    if input.title.trim().is_empty() || input.starts_at.trim().is_empty() {
        return Err(AppError::Validation(
            "El título y la fecha de inicio son obligatorios.".into(),
        ));
    }
    let id = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let id = store_event(&transaction, &input)?;
        // La planificación aparece en el calendario de FlowDesk.
        sync::sync_academic_event(&transaction, id)?;
        transaction.commit()?;
        id
    };
    notify(&app, &["calendar", "teaching"]);
    Ok(id)
}

fn store_event(connection: &Connection, input: &AcademicEventInput) -> AppResult<i64> {
    if let Some(id) = input.id {
        connection.execute(
            r#"UPDATE academic_events SET title=?1,event_type=?2,starts_at=?3,ends_at=?4,
               description=?5,reminder_days=?6 WHERE id=?7 AND course_id=?8"#,
            params![
                input.title.trim(),
                input.event_type,
                input.starts_at,
                input.ends_at,
                input.description.trim(),
                input.reminder_days,
                id,
                input.course_id
            ],
        )?;
        Ok(id)
    } else {
        connection.execute(
            r#"INSERT INTO academic_events (course_id,title,event_type,starts_at,ends_at,description,reminder_days)
               VALUES (?1,?2,?3,?4,?5,?6,?7)"#,
            params![input.course_id,input.title.trim(),input.event_type,input.starts_at,
                input.ends_at,input.description.trim(),input.reminder_days],
        )?;
        Ok(connection.last_insert_rowid())
    }
}

#[tauri::command]
pub fn teaching_delete_event(
    event_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    {
        let connection = database.lock().map_err(|_| AppError::State)?;
        connection.execute("DELETE FROM academic_events WHERE id=?1", [event_id])?;
    }
    notify(&app, &["calendar", "teaching"]);
    Ok(())
}

struct StudentMetric {
    name: String,
    identification: String,
    grade: Option<f64>,
    attendance: f64,
}

fn student_metrics(connection: &Connection, course_id: i64) -> AppResult<Vec<StudentMetric>> {
    let mut statement = connection.prepare(
        r#"
        SELECT st.name, st.identification,
          CASE WHEN COALESCE((SELECT SUM(ev.weight) FROM evaluations ev JOIN grades g ON g.evaluation_id=ev.id AND g.enrollment_id=e.id WHERE ev.course_id=e.course_id AND ev.active=1 AND g.score IS NOT NULL),0) = 0 THEN NULL ELSE
            (SELECT SUM((g.score/ev.max_score)*ev.weight) FROM evaluations ev JOIN grades g ON g.evaluation_id=ev.id AND g.enrollment_id=e.id WHERE ev.course_id=e.course_id AND ev.active=1 AND g.score IS NOT NULL) /
            (SELECT SUM(ev.weight) FROM evaluations ev JOIN grades g ON g.evaluation_id=ev.id AND g.enrollment_id=e.id WHERE ev.course_id=e.course_id AND ev.active=1 AND g.score IS NOT NULL) * 100 END,
          CASE WHEN (SELECT COUNT(*) FROM class_sessions s WHERE s.course_id=e.course_id AND s.is_held=1)=0 THEN 0 ELSE
            100.0*(SELECT COUNT(*) FROM attendance_records ar JOIN class_sessions s ON s.id=ar.session_id WHERE ar.enrollment_id=e.id AND s.is_held=1 AND ar.status IN ('P','J','T')) /
            (SELECT COUNT(*) FROM class_sessions s WHERE s.course_id=e.course_id AND s.is_held=1) END
        FROM enrollments e JOIN students st ON st.id=e.student_id
        WHERE e.course_id=?1 AND e.status='active' ORDER BY st.name
        "#,
    )?;
    let rows = statement.query_map([course_id], |row| {
        Ok(StudentMetric {
            name: row.get(0)?,
            identification: row.get(1)?,
            grade: row.get(2)?,
            attendance: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn teaching_get_analytics(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<Analytics> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let metrics = student_metrics(&connection, course_id)?;
    let (passing, attendance_minimum, requires_attendance): (f64, f64, bool) = connection.query_row(
        "SELECT passing_grade,attendance_minimum,promotion_requires_attendance FROM courses WHERE id=?1",
        [course_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
    )?;
    let mut approved = 0;
    let mut at_risk = 0;
    let mut ungraded = 0;
    let mut performance = [0_f64; 4];
    let mut attendance_bands = [0_f64; 3];
    let mut risks = Vec::new();
    for item in &metrics {
        match item.grade {
            None => {
                ungraded += 1;
                performance[0] += 1.0;
            }
            Some(grade) if grade < 60.0 => performance[0] += 1.0,
            Some(grade) if grade < passing => performance[1] += 1.0,
            Some(grade) if grade < 90.0 => performance[2] += 1.0,
            Some(_) => performance[3] += 1.0,
        }
        if item.attendance < attendance_minimum {
            attendance_bands[0] += 1.0;
        } else if item.attendance < 90.0 {
            attendance_bands[1] += 1.0;
        } else {
            attendance_bands[2] += 1.0;
        }
        let grade_ok = item.grade.is_some_and(|grade| grade >= passing);
        let attendance_ok = !requires_attendance || item.attendance >= attendance_minimum;
        if grade_ok && attendance_ok {
            approved += 1;
        }
        let mut reasons = Vec::new();
        if item.grade.is_some_and(|grade| grade < passing) {
            reasons.push("nota baja");
        }
        if item.attendance < attendance_minimum {
            reasons.push("asistencia baja");
        }
        if !reasons.is_empty() {
            at_risk += 1;
            risks.push(RiskStudent {
                name: item.name.clone(),
                identification: item.identification.clone(),
                grade: item.grade,
                attendance: item.attendance,
                reason: reasons.join(" y "),
            });
        }
    }
    let graded: Vec<f64> = metrics.iter().filter_map(|item| item.grade).collect();
    let grade_average =
        (!graded.is_empty()).then(|| graded.iter().sum::<f64>() / graded.len() as f64);
    let attendance_average = if metrics.is_empty() {
        0.0
    } else {
        metrics.iter().map(|m| m.attendance).sum::<f64>() / metrics.len() as f64
    };

    let mut group_statement = connection.prepare(
        r#"SELECT sg.name, AVG(CASE WHEN ev.max_score>0 THEN g.score/ev.max_score*100 END)
            FROM student_groups sg JOIN group_memberships gm ON gm.group_id=sg.id
            JOIN grades g ON g.enrollment_id=gm.enrollment_id JOIN evaluations ev ON ev.id=g.evaluation_id AND ev.active=1
            WHERE sg.course_id=?1 AND g.score IS NOT NULL GROUP BY sg.id ORDER BY sg.name"#,
    )?;
    let group_performance = group_statement
        .query_map([course_id], |row| {
            Ok(ChartValue {
                label: row.get(0)?,
                value: row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Analytics {
        total_students: metrics.len() as i64,
        approved,
        at_risk,
        ungraded,
        attendance_average,
        grade_average,
        performance_bands: vec![
            ChartValue {
                label: "Crítico".into(),
                value: performance[0],
            },
            ChartValue {
                label: "En riesgo".into(),
                value: performance[1],
            },
            ChartValue {
                label: "Satisfactorio".into(),
                value: performance[2],
            },
            ChartValue {
                label: "Excelente".into(),
                value: performance[3],
            },
        ],
        attendance_bands: vec![
            ChartValue {
                label: "Baja".into(),
                value: attendance_bands[0],
            },
            ChartValue {
                label: "Media".into(),
                value: attendance_bands[1],
            },
            ChartValue {
                label: "Alta".into(),
                value: attendance_bands[2],
            },
        ],
        group_performance,
        risks,
    })
}

#[tauri::command]
pub fn teaching_get_report_summary(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<ReportSummary> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let selected_course = course(&connection, course_id)?;
    let metrics = student_metrics(&connection, course_id)?;
    let grades: Vec<f64> = metrics.iter().filter_map(|item| item.grade).collect();
    let grade_average =
        (!grades.is_empty()).then(|| grades.iter().sum::<f64>() / grades.len() as f64);
    let attendance_average = if metrics.is_empty() {
        0.0
    } else {
        metrics.iter().map(|m| m.attendance).sum::<f64>() / metrics.len() as f64
    };
    let count = |table: &str| -> AppResult<i64> {
        Ok(connection.query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE course_id=?1"),
            [course_id],
            |row| row.get(0),
        )?)
    };
    Ok(ReportSummary {
        course: selected_course,
        generated_at: chrono::Local::now().to_rfc3339(),
        total_students: connection.query_row(
            "SELECT COUNT(*) FROM enrollments WHERE course_id=?1",
            [course_id],
            |row| row.get(0),
        )?,
        active_students: metrics.len() as i64,
        sessions: count("class_sessions")?,
        evaluations: count("evaluations")?,
        groups: count("student_groups")?,
        grade_average,
        attendance_average,
    })
}

fn csv_cell(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[tauri::command]
pub fn teaching_export_course_csv(
    course_id: i64,
    path: String,
    database: State<'_, Database>,
) -> AppResult<()> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let metrics = student_metrics(&connection, course_id)?;
    let mut csv = String::from("Identificación,Estudiante,Calificación,Asistencia\n");
    for item in metrics {
        csv.push_str(&format!(
            "{},{},{},{:.2}\n",
            csv_cell(&item.identification),
            csv_cell(&item.name),
            item.grade.map(|v| format!("{v:.2}")).unwrap_or_default(),
            item.attendance
        ));
    }
    std::fs::write(path, csv)?;
    Ok(())
}

#[tauri::command]
pub fn teaching_export_course_excel(
    course_id: i64,
    path: String,
    database: State<'_, Database>,
) -> AppResult<()> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    export_course_excel_file(&connection, course_id, &path)
}

fn export_course_excel_file(connection: &Connection, course_id: i64, path: &str) -> AppResult<()> {
    use rust_xlsxwriter::{Color, Format, Workbook};

    let selected_course = course(connection, course_id)?;
    let header = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x6655DB));
    let subheader = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0xEDE9FE));
    let mut workbook = Workbook::new();

    {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Resumen")?;
        sheet.set_column_width(0, 26)?;
        sheet.set_column_width(1, 35)?;
        sheet.write_string_with_format(0, 0, "FLOWDESK · DOCENCIA", &header)?;
        sheet.write_string_with_format(2, 0, "Asignatura", &subheader)?;
        sheet.write_string(2, 1, &selected_course.title)?;
        sheet.write_string_with_format(3, 0, "Código", &subheader)?;
        sheet.write_string(3, 1, &selected_course.code)?;
        sheet.write_string_with_format(4, 0, "Grupo", &subheader)?;
        sheet.write_string(4, 1, &selected_course.group_name)?;
        sheet.write_string_with_format(5, 0, "Periodo", &subheader)?;
        sheet.write_string(5, 1, &selected_course.period_label)?;
        sheet.write_string_with_format(6, 0, "Docente", &subheader)?;
        sheet.write_string(6, 1, &selected_course.professor)?;
        sheet.write_string_with_format(8, 0, "Generado", &subheader)?;
        sheet.write_string(
            8,
            1,
            chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
        )?;
    }

    let students = {
        let mut statement = connection.prepare(
            "SELECT e.id,st.identification,st.name,st.email,e.status,COALESCE(sg.name,'')
             FROM enrollments e JOIN students st ON st.id=e.student_id
             LEFT JOIN group_memberships gm ON gm.enrollment_id=e.id
             LEFT JOIN student_groups sg ON sg.id=gm.group_id
             WHERE e.course_id=?1 ORDER BY st.name",
        )?;
        statement
            .query_map([course_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Estudiantes")?;
        for (column, title) in ["Identificación", "Estudiante", "Correo", "Estado", "Equipo"]
            .iter()
            .enumerate()
        {
            sheet.write_string_with_format(0, column as u16, *title, &header)?;
        }
        for (row, (_, identification, name, email, status, group)) in students.iter().enumerate() {
            let r = (row + 1) as u32;
            sheet.write_string(r, 0, identification)?;
            sheet.write_string(r, 1, name)?;
            sheet.write_string(r, 2, email)?;
            sheet.write_string(r, 3, status)?;
            sheet.write_string(r, 4, group)?;
        }
        sheet.set_column_width(0, 18)?;
        sheet.set_column_width(1, 30)?;
        sheet.set_column_width(2, 28)?;
        sheet.set_column_width(3, 12)?;
        sheet.set_column_width(4, 22)?;
        sheet.set_freeze_panes(1, 0)?;
    }

    let sessions = {
        let mut statement=connection.prepare("SELECT id,number,COALESCE(date,'') FROM class_sessions WHERE course_id=?1 ORDER BY number")?;
        statement
            .query_map([course_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Asistencia")?;
        sheet.write_string_with_format(0, 0, "Identificación", &header)?;
        sheet.write_string_with_format(0, 1, "Estudiante", &header)?;
        for (index, (_, number, date)) in sessions.iter().enumerate() {
            sheet.write_string_with_format(
                0,
                (index + 2) as u16,
                format!("Clase {number}\n{date}"),
                &header,
            )?;
            sheet.set_column_width((index + 2) as u16, 13)?;
        }
        for (row, (enrollment_id, identification, name, _, _, _)) in students.iter().enumerate() {
            let r = (row + 1) as u32;
            sheet.write_string(r, 0, identification)?;
            sheet.write_string(r, 1, name)?;
            for (index, (session_id, _, _)) in sessions.iter().enumerate() {
                let status:Option<String>=connection.query_row("SELECT status FROM attendance_records WHERE enrollment_id=?1 AND session_id=?2",params![enrollment_id,session_id],|row|row.get(0)).optional()?;
                sheet.write_string(r, (index + 2) as u16, status.unwrap_or_default())?;
            }
        }
        sheet.set_column_width(0, 18)?;
        sheet.set_column_width(1, 30)?;
        sheet.set_freeze_panes(1, 2)?;
    }

    let evaluations = {
        let mut statement=connection.prepare("SELECT id,name,max_score,weight FROM evaluations WHERE course_id=?1 AND active=1 ORDER BY sort_order,id")?;
        statement
            .query_map([course_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, f64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Calificaciones")?;
        sheet.write_string_with_format(0, 0, "Identificación", &header)?;
        sheet.write_string_with_format(0, 1, "Estudiante", &header)?;
        for (index, (_, name, max, weight)) in evaluations.iter().enumerate() {
            sheet.write_string_with_format(
                0,
                (index + 2) as u16,
                format!("{name}\n{weight}% / {max}"),
                &header,
            )?;
            sheet.set_column_width((index + 2) as u16, 18)?;
        }
        for (row, (enrollment_id, identification, name, _, _, _)) in students.iter().enumerate() {
            let r = (row + 1) as u32;
            sheet.write_string(r, 0, identification)?;
            sheet.write_string(r, 1, name)?;
            for (index, (evaluation_id, _, _, _)) in evaluations.iter().enumerate() {
                let score: Option<f64> = connection
                    .query_row(
                        "SELECT score FROM grades WHERE enrollment_id=?1 AND evaluation_id=?2",
                        params![enrollment_id, evaluation_id],
                        |row| row.get(0),
                    )
                    .optional()?
                    .flatten();
                if let Some(value) = score {
                    sheet.write_number(r, (index + 2) as u16, value)?;
                }
            }
        }
        sheet.set_column_width(0, 18)?;
        sheet.set_column_width(1, 30)?;
        sheet.set_freeze_panes(1, 2)?;
    }

    {
        let sheet = workbook.add_worksheet();
        sheet.set_name("Equipos")?;
        for (column, title) in [
            "Equipo",
            "Descripción",
            "Integrante",
            "Identificación",
            "Líder",
        ]
        .iter()
        .enumerate()
        {
            sheet.write_string_with_format(0, column as u16, *title, &header)?;
        }
        let mut statement=connection.prepare("SELECT sg.name,sg.description,st.name,st.identification,CASE WHEN gm.id=sg.leader_membership_id THEN 'Sí' ELSE '' END FROM student_groups sg LEFT JOIN group_memberships gm ON gm.group_id=sg.id LEFT JOIN enrollments e ON e.id=gm.enrollment_id LEFT JOIN students st ON st.id=e.student_id WHERE sg.course_id=?1 ORDER BY sg.name,st.name")?;
        let rows = statement
            .query_map([course_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (row, (group, description, name, identification, leader)) in rows.iter().enumerate() {
            let r = (row + 1) as u32;
            sheet.write_string(r, 0, group)?;
            sheet.write_string(r, 1, description)?;
            sheet.write_string(r, 2, name)?;
            sheet.write_string(r, 3, identification)?;
            sheet.write_string(r, 4, leader)?;
        }
        for (column, width) in [24.0, 30.0, 30.0, 18.0, 10.0].iter().enumerate() {
            sheet.set_column_width(column as u16, *width)?;
        }
        sheet.set_freeze_panes(1, 0)?;
    }
    workbook.save(path)?;
    Ok(())
}

#[tauri::command]
pub fn teaching_get_periods(database: State<'_, Database>) -> AppResult<Vec<AcademicPeriodRow>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let mut statement=connection.prepare("SELECT p.id,p.name,p.start_date,p.end_date,p.is_active,p.is_closed,COUNT(c.id) FROM academic_periods p LEFT JOIN courses c ON c.academic_period_id=p.id GROUP BY p.id ORDER BY p.start_date DESC,p.name")?;
    let rows = statement.query_map([], |row| {
        Ok(AcademicPeriodRow {
            id: row.get(0)?,
            name: row.get(1)?,
            start_date: row.get(2)?,
            end_date: row.get(3)?,
            is_active: row.get(4)?,
            is_closed: row.get(5)?,
            course_count: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn teaching_save_period(
    input: AcademicPeriodInput,
    database: State<'_, Database>,
) -> AppResult<i64> {
    if input.name.trim().is_empty()
        || input.start_date.is_empty()
        || input.end_date.is_empty()
        || input.end_date < input.start_date
    {
        return Err(AppError::Validation(
            "Verifica el nombre y las fechas del periodo.".into(),
        ));
    }
    let connection = database.lock().map_err(|_| AppError::State)?;
    if let Some(id) = input.id {
        connection.execute("UPDATE academic_periods SET name=?1,start_date=?2,end_date=?3,is_active=?4,is_closed=?5 WHERE id=?6",params![input.name.trim(),input.start_date,input.end_date,input.is_active,input.is_closed,id])?;
        Ok(id)
    } else {
        connection.execute("INSERT INTO academic_periods(name,start_date,end_date,is_active,is_closed)VALUES(?1,?2,?3,?4,?5)",params![input.name.trim(),input.start_date,input.end_date,input.is_active,input.is_closed])?;
        Ok(connection.last_insert_rowid())
    }
}

#[tauri::command]
pub fn teaching_delete_period(period_id: i64, database: State<'_, Database>) -> AppResult<()> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    connection.execute("DELETE FROM academic_periods WHERE id=?1", [period_id])?;
    Ok(())
}

#[tauri::command]
pub fn teaching_get_course_settings(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<CourseSettings> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    Ok(connection.query_row("SELECT id,title,code,group_name,period_label,academic_period_id,professor,passing_grade,attendance_minimum,low_grade_alert,low_attendance_alert,promotion_requires_attendance,is_archived FROM courses WHERE id=?1",[course_id],|row|Ok(CourseSettings{id:row.get(0)?,title:row.get(1)?,code:row.get(2)?,group_name:row.get(3)?,period_label:row.get(4)?,academic_period_id:row.get(5)?,professor:row.get(6)?,passing_grade:row.get(7)?,attendance_minimum:row.get(8)?,low_grade_alert:row.get(9)?,low_attendance_alert:row.get(10)?,promotion_requires_attendance:row.get(11)?,is_archived:row.get(12)?}))?)
}

#[tauri::command]
pub fn teaching_save_course_settings(
    input: CourseSettingsInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    if input.title.trim().is_empty()
        || [
            input.passing_grade,
            input.attendance_minimum,
            input.low_grade_alert,
            input.low_attendance_alert,
        ]
        .iter()
        .any(|v| *v < 0.0 || *v > 100.0)
    {
        return Err(AppError::Validation(
            "Verifica el nombre y los porcentajes del curso.".into(),
        ));
    }
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    transaction.execute("UPDATE courses SET title=?1,code=?2,group_name=?3,period_label=?4,academic_period_id=?5,professor=?6,passing_grade=?7,attendance_minimum=?8,low_grade_alert=?9,low_attendance_alert=?10,promotion_requires_attendance=?11,is_archived=?12,updated_at=CURRENT_TIMESTAMP WHERE id=?13",params![input.title.trim(),input.code.trim(),input.group_name.trim(),input.period_label.trim(),input.academic_period_id,input.professor.trim(),input.passing_grade,input.attendance_minimum,input.low_grade_alert,input.low_attendance_alert,input.promotion_requires_attendance,input.is_archived,input.id])?;
    // El proyecto toma el nuevo nombre; archivar la materia la quita del calendario.
    sync::sync_course(&transaction, input.id)?;
    transaction.commit()?;
    drop(connection);
    notify(&app, &["projects", "calendar", "tasks", "teaching"]);
    Ok(())
}

#[tauri::command]
pub fn teaching_get_rubric(
    evaluation_id: i64,
    database: State<'_, Database>,
) -> AppResult<Vec<RubricCriterionRow>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let mut statement=connection.prepare("SELECT id,evaluation_id,name,description,weight,max_score,sort_order FROM rubric_criteria WHERE evaluation_id=?1 ORDER BY sort_order,id")?;
    let rows = statement.query_map([evaluation_id], |row| {
        Ok(RubricCriterionRow {
            id: row.get(0)?,
            evaluation_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            weight: row.get(4)?,
            max_score: row.get(5)?,
            sort_order: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn teaching_save_rubric_criterion(
    input: RubricCriterionInput,
    database: State<'_, Database>,
) -> AppResult<i64> {
    if input.name.trim().is_empty()
        || input.weight <= 0.0
        || input.weight > 100.0
        || input.max_score <= 0.0
    {
        return Err(AppError::Validation(
            "Verifica el criterio, peso y puntaje máximo.".into(),
        ));
    }
    let connection = database.lock().map_err(|_| AppError::State)?;
    if let Some(id) = input.id {
        connection.execute("UPDATE rubric_criteria SET name=?1,description=?2,weight=?3,max_score=?4 WHERE id=?5 AND evaluation_id=?6",params![input.name.trim(),input.description.trim(),input.weight,input.max_score,id,input.evaluation_id])?;
        Ok(id)
    } else {
        let order: i64 = connection.query_row(
            "SELECT COALESCE(MAX(sort_order),0)+1 FROM rubric_criteria WHERE evaluation_id=?1",
            [input.evaluation_id],
            |row| row.get(0),
        )?;
        connection.execute("INSERT INTO rubric_criteria(evaluation_id,name,description,weight,max_score,sort_order)VALUES(?1,?2,?3,?4,?5,?6)",params![input.evaluation_id,input.name.trim(),input.description.trim(),input.weight,input.max_score,order])?;
        Ok(connection.last_insert_rowid())
    }
}

#[tauri::command]
pub fn teaching_delete_rubric_criterion(
    criterion_id: i64,
    database: State<'_, Database>,
) -> AppResult<()> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    connection.execute("DELETE FROM rubric_criteria WHERE id=?1", [criterion_id])?;
    Ok(())
}

#[tauri::command]
pub fn teaching_get_rubric_matrix(
    evaluation_id: i64,
    database: State<'_, Database>,
) -> AppResult<RubricMatrix> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let course_id: i64 = connection.query_row(
        "SELECT course_id FROM evaluations WHERE id=?1",
        [evaluation_id],
        |row| row.get(0),
    )?;
    let mut statement=connection.prepare("SELECT e.id,st.name,st.identification FROM enrollments e JOIN students st ON st.id=e.student_id WHERE e.course_id=?1 AND e.status='active' ORDER BY st.name")?;
    let students = statement
        .query_map([course_id], |row| {
            Ok(MatrixStudent {
                enrollment_id: row.get(0)?,
                name: row.get(1)?,
                identification: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement=connection.prepare("SELECT id,evaluation_id,name,description,weight,max_score,sort_order FROM rubric_criteria WHERE evaluation_id=?1 ORDER BY sort_order,id")?;
    let criteria = statement
        .query_map([evaluation_id], |row| {
            Ok(RubricCriterionRow {
                id: row.get(0)?,
                evaluation_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                weight: row.get(4)?,
                max_score: row.get(5)?,
                sort_order: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement=connection.prepare("SELECT rs.enrollment_id,rs.criterion_id,rs.score FROM rubric_scores rs JOIN rubric_criteria rc ON rc.id=rs.criterion_id WHERE rc.evaluation_id=?1")?;
    let cells = statement
        .query_map([evaluation_id], |row| {
            Ok(RubricScoreCell {
                enrollment_id: row.get(0)?,
                criterion_id: row.get(1)?,
                score: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(RubricMatrix {
        students,
        criteria,
        cells,
    })
}

#[tauri::command]
pub fn teaching_save_rubric_scores(
    evaluation_id: i64,
    updates: Vec<RubricScoreInput>,
    database: State<'_, Database>,
) -> AppResult<usize> {
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    let (course_id, evaluation_max): (i64, f64) = transaction.query_row(
        "SELECT course_id,max_score FROM evaluations WHERE id=?1 AND grading_mode='individual'",
        [evaluation_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let criteria = {
        let mut statement = transaction
            .prepare("SELECT id,weight,max_score FROM rubric_criteria WHERE evaluation_id=?1")?;
        statement
            .query_map([evaluation_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, f64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    for update in &updates {
        let Some((_, _, maximum)) = criteria.iter().find(|item| item.0 == update.criterion_id)
        else {
            return Err(AppError::Validation(
                "El criterio no pertenece a esta evaluación.".into(),
            ));
        };
        if let Some(score) = update.score {
            let safe = score.clamp(0.0, *maximum);
            transaction.execute("INSERT INTO rubric_scores(enrollment_id,criterion_id,score)VALUES(?1,?2,?3) ON CONFLICT(enrollment_id,criterion_id)DO UPDATE SET score=excluded.score",params![update.enrollment_id,update.criterion_id,safe])?;
        } else {
            transaction.execute(
                "DELETE FROM rubric_scores WHERE enrollment_id=?1 AND criterion_id=?2",
                params![update.enrollment_id, update.criterion_id],
            )?;
        }
    }
    let enrollment_ids = {
        let mut statement = transaction
            .prepare("SELECT id FROM enrollments WHERE course_id=?1 AND status='active'")?;
        statement
            .query_map([course_id], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    for enrollment_id in enrollment_ids {
        let scored = {
            let mut statement=transaction.prepare("SELECT rc.weight,rc.max_score,rs.score FROM rubric_criteria rc JOIN rubric_scores rs ON rs.criterion_id=rc.id AND rs.enrollment_id=?1 WHERE rc.evaluation_id=?2")?;
            statement
                .query_map(params![enrollment_id, evaluation_id], |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, f64>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if let Some(final_score) = rubric_grade(&scored, evaluation_max) {
            transaction.execute("INSERT INTO grades(enrollment_id,evaluation_id,score,updated_at)VALUES(?1,?2,?3,CURRENT_TIMESTAMP)ON CONFLICT(enrollment_id,evaluation_id)DO UPDATE SET score=excluded.score,updated_at=CURRENT_TIMESTAMP",params![enrollment_id,evaluation_id,final_score])?;
        } else {
            transaction.execute(
                "DELETE FROM grades WHERE enrollment_id=?1 AND evaluation_id=?2",
                params![enrollment_id, evaluation_id],
            )?;
        }
    }
    transaction.commit()?;
    Ok(updates.len())
}

#[tauri::command]
pub fn teaching_get_student_profile(
    enrollment_id: i64,
    database: State<'_, Database>,
) -> AppResult<StudentProfile> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let (name,identification,email,guardian_name,guardian_email,guardian_phone,status,course_id):(String,String,String,String,String,String,String,i64)=connection.query_row("SELECT st.name,st.identification,st.email,st.guardian_name,st.guardian_email,st.guardian_phone,e.status,e.course_id FROM enrollments e JOIN students st ON st.id=e.student_id WHERE e.id=?1",[enrollment_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?)))?;
    let metric = student_metrics(&connection, course_id)?
        .into_iter()
        .find(|item| item.identification == identification);
    let (mut grade, mut attendance) = (None, 0.0);
    if let Some(item) = metric {
        grade = item.grade;
        attendance = item.attendance;
    }
    let mut statement=connection.prepare("SELECT id,category,text,follow_up_date,resolved,private,created_at FROM student_observations WHERE enrollment_id=?1 ORDER BY resolved,created_at DESC")?;
    let observations = statement
        .query_map([enrollment_id], |row| {
            Ok(ObservationRow {
                id: row.get(0)?,
                category: row.get(1)?,
                text: row.get(2)?,
                follow_up_date: row.get(3)?,
                resolved: row.get(4)?,
                private: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement=connection.prepare("SELECT ev.id,ev.name,g.score,ev.max_score,ev.weight FROM evaluations ev LEFT JOIN grades g ON g.evaluation_id=ev.id AND g.enrollment_id=?1 WHERE ev.course_id=?2 AND ev.active=1 ORDER BY ev.sort_order,ev.id")?;
    let grades = statement
        .query_map(params![enrollment_id, course_id], |row| {
            Ok(StudentGradeRow {
                evaluation_id: row.get(0)?,
                evaluation_name: row.get(1)?,
                score: row.get(2)?,
                max_score: row.get(3)?,
                weight: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement=connection.prepare("SELECT r.id,r.evaluation_id,ev.name,r.original_score,r.recovery_score,r.applied_score,r.notes,r.created_at FROM recovery_grades r JOIN evaluations ev ON ev.id=r.evaluation_id WHERE r.enrollment_id=?1 ORDER BY r.created_at DESC")?;
    let recoveries = statement
        .query_map([enrollment_id], |row| {
            Ok(RecoveryRow {
                id: row.get(0)?,
                evaluation_id: row.get(1)?,
                evaluation_name: row.get(2)?,
                original_score: row.get(3)?,
                recovery_score: row.get(4)?,
                applied_score: row.get(5)?,
                notes: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(StudentProfile {
        enrollment_id,
        name,
        identification,
        email,
        guardian_name,
        guardian_email,
        guardian_phone,
        status,
        grade,
        attendance,
        observations,
        grades,
        recoveries,
    })
}

#[tauri::command]
pub fn teaching_save_observation(
    input: ObservationInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<i64> {
    if input.text.trim().is_empty() {
        return Err(AppError::Validation(
            "Escribe la observación o compromiso.".into(),
        ));
    }
    let id = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        let id = store_observation(&transaction, &input)?;
        // Con fecha de seguimiento, es una tarea de la materia.
        sync::sync_observation(&transaction, id)?;
        transaction.commit()?;
        id
    };
    notify(&app, &["tasks", "teaching"]);
    Ok(id)
}

fn store_observation(connection: &Connection, input: &ObservationInput) -> AppResult<i64> {
    if let Some(id) = input.id {
        connection.execute("UPDATE student_observations SET category=?1,text=?2,follow_up_date=?3,resolved=?4,private=?5 WHERE id=?6 AND enrollment_id=?7",params![input.category,input.text.trim(),input.follow_up_date,input.resolved,input.private,id,input.enrollment_id])?;
        Ok(id)
    } else {
        connection.execute("INSERT INTO student_observations(enrollment_id,category,text,follow_up_date,resolved,private)VALUES(?1,?2,?3,?4,?5,?6)",params![input.enrollment_id,input.category,input.text.trim(),input.follow_up_date,input.resolved,input.private])?;
        Ok(connection.last_insert_rowid())
    }
}

#[tauri::command]
pub fn teaching_toggle_observation(
    observation_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE student_observations SET resolved=NOT resolved WHERE id=?1",
            [observation_id],
        )?;
        sync::sync_observation(&transaction, observation_id)?;
        transaction.commit()?;
    }
    notify(&app, &["tasks", "teaching"]);
    Ok(())
}

#[tauri::command]
pub fn teaching_apply_recovery(
    input: RecoveryInput,
    database: State<'_, Database>,
) -> AppResult<i64> {
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    let max_score: f64 = transaction.query_row(
        "SELECT max_score FROM evaluations WHERE id=?1",
        [input.evaluation_id],
        |row| row.get(0),
    )?;
    let recovery = input.recovery_score.clamp(0.0, max_score);
    let original: Option<f64> = transaction
        .query_row(
            "SELECT score FROM grades WHERE enrollment_id=?1 AND evaluation_id=?2",
            params![input.enrollment_id, input.evaluation_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let applied = original.map_or(recovery, |score| score.max(recovery));
    transaction.execute("INSERT INTO recovery_grades(enrollment_id,evaluation_id,original_score,recovery_score,applied_score,notes)VALUES(?1,?2,?3,?4,?5,?6)",params![input.enrollment_id,input.evaluation_id,original,recovery,applied,input.notes.trim()])?;
    let id = transaction.last_insert_rowid();
    transaction.execute("INSERT INTO grades(enrollment_id,evaluation_id,score,updated_at)VALUES(?1,?2,?3,CURRENT_TIMESTAMP)ON CONFLICT(enrollment_id,evaluation_id)DO UPDATE SET score=excluded.score,updated_at=CURRENT_TIMESTAMP",params![input.enrollment_id,input.evaluation_id,applied])?;
    transaction.commit()?;
    Ok(id)
}

#[tauri::command]
pub fn teaching_get_announcements(
    course_id: i64,
    database: State<'_, Database>,
) -> AppResult<Vec<AnnouncementRow>> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let mut statement=connection.prepare("SELECT id,title,body,attachment,published,created_at FROM announcements WHERE course_id=?1 ORDER BY created_at DESC")?;
    let rows = statement.query_map([course_id], |row| {
        Ok(AnnouncementRow {
            id: row.get(0)?,
            title: row.get(1)?,
            body: row.get(2)?,
            attachment: row.get(3)?,
            published: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn teaching_save_announcement(
    input: AnnouncementInput,
    database: State<'_, Database>,
) -> AppResult<i64> {
    if input.title.trim().is_empty() || input.body.trim().is_empty() {
        return Err(AppError::Validation(
            "El título y el mensaje son obligatorios.".into(),
        ));
    }
    let connection = database.lock().map_err(|_| AppError::State)?;
    if let Some(id) = input.id {
        connection.execute(
            "UPDATE announcements SET title=?1,body=?2,published=?3 WHERE id=?4 AND course_id=?5",
            params![
                input.title.trim(),
                input.body.trim(),
                input.published,
                id,
                input.course_id
            ],
        )?;
        Ok(id)
    } else {
        connection.execute(
            "INSERT INTO announcements(course_id,title,body,published)VALUES(?1,?2,?3,?4)",
            params![
                input.course_id,
                input.title.trim(),
                input.body.trim(),
                input.published
            ],
        )?;
        Ok(connection.last_insert_rowid())
    }
}

#[tauri::command]
pub fn teaching_delete_announcement(
    announcement_id: i64,
    database: State<'_, Database>,
) -> AppResult<()> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    connection.execute("DELETE FROM announcements WHERE id=?1", [announcement_id])?;
    Ok(())
}

#[tauri::command]
pub fn teaching_import_students_excel(
    course_id: i64,
    path: String,
    database: State<'_, Database>,
) -> AppResult<ImportStudentsResult> {
    use calamine::{Data, Reader, open_workbook_auto};
    let mut workbook = open_workbook_auto(path)?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| AppError::Validation("El libro no contiene hojas.".into()))?;
    let range = workbook.worksheet_range(&sheet_name)?;
    let cell_string = |cell: Option<&Data>| -> String {
        cell.map(|value| match value {
            Data::String(text) => text.trim().to_string(),
            Data::Int(number) => number.to_string(),
            Data::Float(number) => {
                if number.fract() == 0.0 {
                    format!("{number:.0}")
                } else {
                    number.to_string()
                }
            }
            Data::Bool(value) => value.to_string(),
            _ => String::new(),
        })
        .unwrap_or_default()
    };
    let mut connection = database.lock().map_err(|_| AppError::State)?;
    let transaction = connection.transaction()?;
    let (mut created, mut updated, mut skipped) = (0_i64, 0_i64, 0_i64);
    for row in range.rows().skip(1) {
        let (identification, name, email) = if row.len() >= 4 {
            (
                cell_string(row.get(1)),
                cell_string(row.get(2)),
                cell_string(row.get(3)),
            )
        } else {
            (
                cell_string(row.first()),
                cell_string(row.get(1)),
                cell_string(row.get(2)),
            )
        };
        if identification.is_empty() || name.is_empty() {
            skipped += 1;
            continue;
        }
        transaction.execute("INSERT INTO students(identification,name,email)VALUES(?1,?2,?3)ON CONFLICT(identification)DO UPDATE SET name=excluded.name,email=excluded.email",params![identification,name,email])?;
        let student_id: i64 = transaction.query_row(
            "SELECT id FROM students WHERE identification=?1",
            [identification],
            |row| row.get(0),
        )?;
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM enrollments WHERE course_id=?1 AND student_id=?2)",
            params![course_id, student_id],
            |row| row.get(0),
        )?;
        transaction.execute("INSERT INTO enrollments(course_id,student_id,status)VALUES(?1,?2,'active')ON CONFLICT(course_id,student_id)DO UPDATE SET status='active'",params![course_id,student_id])?;
        if exists { updated += 1 } else { created += 1 }
    }
    transaction.commit()?;
    Ok(ImportStudentsResult {
        created,
        updated,
        skipped,
    })
}

#[tauri::command]
pub fn teaching_import_desktop(
    path: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<ImportResult> {
    let backups = backups_dir(&app)?;
    let result = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        legacy::import_desktop(&mut connection, &PathBuf::from(path), &backups)?
    };
    notify(&app, &["projects", "calendar", "tasks", "teaching"]);
    Ok(result)
}

#[tauri::command]
pub fn teaching_import_django(
    path: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<ImportResult> {
    let backups = backups_dir(&app)?;
    let result = {
        let mut connection = database.lock().map_err(|_| AppError::State)?;
        legacy::import_django(&mut connection, &PathBuf::from(path), &backups)?
    };
    notify(&app, &["projects", "calendar", "tasks", "teaching"]);
    Ok(result)
}

#[tauri::command]
pub fn teaching_backup_database(
    path: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<()> {
    let database_path =
        Database::path(&app).map_err(|error| AppError::Validation(error.to_string()))?;
    let connection = database.lock().map_err(|_| AppError::State)?;
    legacy::backup(&connection, &database_path, &PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rubric_score_uses_only_completed_criteria_and_scales_to_evaluation() {
        let score = rubric_grade(&[(40.0, 20.0, 18.0), (60.0, 30.0, 24.0)], 50.0).expect("score");
        assert_eq!(score, 42.0);
        assert_eq!(rubric_grade(&[], 100.0), None);
    }
}
