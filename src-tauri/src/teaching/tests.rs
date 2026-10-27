use super::{
    commands::courses,
    legacy,
    models::ScheduleSlotInput,
    schedule::{generate_sessions, query_schedule, save_slot},
    sync,
};
use crate::{
    commands::{
        calendar::{modify_event, query_range, remove_event},
        tasks::change_status,
    },
    database::Database,
    models::{EventInput, EventScope},
};
use chrono::{Datelike, Local, NaiveDate, TimeZone};
use rusqlite::{Connection, params};

fn execute(database: &Database, sql: &str) {
    database
        .with_connection(|connection| connection.execute_batch(sql))
        .expect("sql");
}

fn count(database: &Database, sql: &str) -> i64 {
    database
        .with_connection(|connection| connection.query_row(sql, [], |row| row.get(0)))
        .expect("count")
}

fn text(database: &Database, sql: &str) -> Option<String> {
    database
        .with_connection(|connection| connection.query_row(sql, [], |row| row.get(0)))
        .expect("text")
}

/// Materia con su proyecto, como la crea `teaching_create_course`.
fn course(database: &Database, title: &str, group: &str) -> i64 {
    let connection = database.lock().expect("lock");
    connection
        .execute(
            "INSERT INTO courses(title, group_name, code) VALUES (?1, ?2, '8408')",
            params![title, group],
        )
        .expect("course");
    let id = connection.last_insert_rowid();
    sync::sync_course_project(&connection, id).expect("project");
    id
}

fn slot(course_id: i64, weekday: u32) -> ScheduleSlotInput {
    ScheduleSlotInput {
        id: None,
        course_id,
        kind: "class".to_string(),
        weekday,
        start_time: "19:30".to_string(),
        end_time: "22:00".to_string(),
        room: "Aula 3".to_string(),
        // Del lunes 3 de agosto al viernes 4 de diciembre de 2026.
        starts_on: "2026-08-03".to_string(),
        ends_on: "2026-12-04".to_string(),
        reminder_minutes: Some(10),
    }
}

fn local(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> i64 {
    Local
        .with_ymd_and_hms(year, month, day, hour, minute, 0)
        .earliest()
        .expect("local time")
        .timestamp()
}

#[test]
fn each_course_gets_a_flowdesk_project() {
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software VIII", "2GS131");
    let listed = courses(&database.lock().expect("lock")).expect("courses");
    assert_eq!(listed.len(), 1);
    assert!(listed[0].project_id.is_some());
    assert_eq!(
        text(&database, "SELECT name FROM projects").as_deref(),
        Some("Desarrollo de Software VIII · 2GS131")
    );
    // Renombrar y archivar la materia se refleja en su proyecto.
    execute(
        &database,
        &format!("UPDATE courses SET title = 'DS VIII', is_archived = 1 WHERE id = {course_id}"),
    );
    sync::sync_course(&database.lock().expect("lock"), course_id).expect("sync");
    assert_eq!(
        text(&database, "SELECT name FROM projects").as_deref(),
        Some("DS VIII · 2GS131")
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM projects WHERE archived_at IS NOT NULL"
        ),
        1
    );
    // Si el proyecto se borra, se vuelve a crear.
    execute(&database, "DELETE FROM projects");
    sync::sync_course_project(&database.lock().expect("lock"), course_id).expect("again");
    assert_eq!(count(&database, "SELECT COUNT(*) FROM projects"), 1);
}

#[test]
fn schedule_slots_are_weekly_classes_in_the_calendar() {
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software VIII", "2GS131");
    let id = save_slot(&mut database.lock().expect("lock"), &slot(course_id, 2)).expect("tuesday");
    save_slot(&mut database.lock().expect("lock"), &slot(course_id, 4)).expect("thursday");

    let schedule = query_schedule(&database.lock().expect("lock")).expect("schedule");
    assert_eq!(schedule.len(), 2);
    assert!(schedule.iter().all(|slot| slot.in_calendar));

    // Semana del 5 al 11 de octubre de 2026: martes 6 y jueves 8, de 19:30 a 22:00.
    let week = query_range(
        &database,
        local(2026, 10, 5, 0, 0),
        local(2026, 10, 12, 0, 0),
    )
    .expect("week");
    let classes: Vec<_> = week
        .events
        .iter()
        .map(|event| (event.starts_at, event.ends_at))
        .collect();
    assert_eq!(
        classes,
        [
            (local(2026, 10, 6, 19, 30), local(2026, 10, 6, 22, 0)),
            (local(2026, 10, 8, 19, 30), local(2026, 10, 8, 22, 0)),
        ]
    );
    assert!(week.events.iter().all(|event| event.source == "teaching"));
    assert_eq!(week.events[0].location.as_deref(), Some("Aula 3"));
    assert_eq!(week.events[0].reminder_minutes, Some(10));
    assert!(week.events[0].project_id.is_some());
    // Ninguna clase después del fin del periodo.
    let after = query_range(
        &database,
        local(2026, 12, 5, 0, 0),
        local(2026, 12, 20, 0, 0),
    )
    .expect("after");
    assert!(after.events.is_empty());

    // Cambiar la franja mueve la serie; borrarla la quita del calendario.
    let moved = ScheduleSlotInput {
        id: Some(id),
        start_time: "18:00".to_string(),
        end_time: "19:30".to_string(),
        ..slot(course_id, 2)
    };
    save_slot(&mut database.lock().expect("lock"), &moved).expect("update");
    assert_eq!(count(&database, "SELECT COUNT(*) FROM calendar_events"), 2);
    let tuesday = query_range(
        &database,
        local(2026, 10, 6, 0, 0),
        local(2026, 10, 7, 0, 0),
    )
    .expect("day");
    assert_eq!(tuesday.events[0].starts_at, local(2026, 10, 6, 18, 0));
    // Desde el calendario solo se quita una clase concreta, como un festivo.
    let class = tuesday.events[0].clone();
    remove_event(
        &database,
        &class.id,
        Some(EventScope::This),
        Some(class.starts_at),
    )
    .expect("holiday");
    assert!(remove_event(&database, &class.id, Some(EventScope::All), None).is_err());
    let other = EventInput {
        title: "Otra".to_string(),
        starts_at: 1,
        ends_at: 2,
        ..EventInput::default()
    };
    assert!(modify_event(&database, &class.id, other, None, None).is_err());
    // Guardar de nuevo la franja sin cambiar su inicio conserva el festivo.
    save_slot(&mut database.lock().expect("lock"), &moved).expect("same slot");
    let tuesday = query_range(
        &database,
        local(2026, 10, 6, 0, 0),
        local(2026, 10, 7, 0, 0),
    )
    .expect("day");
    assert!(tuesday.events.is_empty());
    execute(
        &database,
        &format!("DELETE FROM course_schedule WHERE id = {id}"),
    );
    assert_eq!(count(&database, "SELECT COUNT(*) FROM calendar_events"), 1);

    let bad = ScheduleSlotInput {
        end_time: "17:00".to_string(),
        ..slot(course_id, 1)
    };
    assert!(save_slot(&mut database.lock().expect("lock"), &bad).is_err());
}

#[test]
fn sessions_are_generated_from_the_schedule_without_touching_attendance() {
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software V", "2GS221");
    // Una sesión ya registrada el miércoles 19 de agosto, sin hora, con asistencia.
    execute(
        &database,
        &format!(
            "INSERT INTO class_sessions(id, course_id, number, date, is_held) VALUES (50, {course_id}, 1, '2026-08-19', 1);
             INSERT INTO students(id, identification, name) VALUES (1, '8-111', 'Ana');
             INSERT INTO enrollments(id, course_id, student_id) VALUES (1, {course_id}, 1);
             INSERT INTO attendance_records(enrollment_id, session_id, status) VALUES (1, 50, 'P');"
        ),
    );
    let short = ScheduleSlotInput {
        starts_on: "2026-08-17".to_string(),
        ends_on: "2026-08-31".to_string(),
        ..slot(course_id, 3)
    };
    save_slot(&mut database.lock().expect("lock"), &short).expect("wednesday");
    save_slot(
        &mut database.lock().expect("lock"),
        &ScheduleSlotInput {
            weekday: 5,
            ..short
        },
    )
    .expect("friday");

    let result =
        generate_sessions(&mut database.lock().expect("lock"), course_id).expect("generate");
    // Miércoles 19 y 26, viernes 21 y 28: la del 19 ya existía y solo gana la hora.
    assert_eq!((result.created, result.updated), (3, 1));
    let sessions: Vec<(i64, String, String)> = database
        .with_connection(|connection| {
            connection
                .prepare("SELECT number, date, start_time FROM class_sessions ORDER BY number")?
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect()
        })
        .expect("sessions");
    assert_eq!(
        sessions,
        [
            (1, "2026-08-19".to_string(), "19:30".to_string()),
            (2, "2026-08-21".to_string(), "19:30".to_string()),
            (3, "2026-08-26".to_string(), "19:30".to_string()),
            (4, "2026-08-28".to_string(), "19:30".to_string()),
        ]
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM attendance_records WHERE session_id = 50"
        ),
        1
    );
    // Repetirlo no duplica nada.
    let again = generate_sessions(&mut database.lock().expect("lock"), course_id).expect("again");
    assert_eq!((again.created, again.updated), (0, 0));
    let empty = course(&database, "Sin horario", "");
    assert!(generate_sessions(&mut database.lock().expect("lock"), empty).is_err());
}

#[test]
fn deliveries_and_planning_appear_in_the_calendar() {
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software VIII", "2GS131");
    execute(
        &database,
        &format!(
            "INSERT INTO evaluations(id, course_id, name, weight, due_date) VALUES (1, {course_id}, 'Parcial 1', 20, '2026-10-08T19:30');
             INSERT INTO evaluations(id, course_id, name, weight, due_date) VALUES (2, {course_id}, 'Proyecto', 30, '2026-10-20');
             INSERT INTO evaluations(id, course_id, name, weight) VALUES (3, {course_id}, 'Sin fecha', 10);
             INSERT INTO academic_events(id, course_id, title, event_type, starts_at, reminder_days)
                VALUES (1, {course_id}, 'Reunión de padres', 'meeting', '2026-10-09T18:00', 2);"
        ),
    );
    {
        let connection = database.lock().expect("lock");
        for id in 1..=3 {
            sync::sync_evaluation(&connection, id).expect("evaluation");
        }
        sync::sync_academic_event(&connection, 1).expect("planning");
    }
    let range = query_range(
        &database,
        local(2026, 10, 1, 0, 0),
        local(2026, 10, 31, 0, 0),
    )
    .expect("month");
    let titles: Vec<_> = range
        .events
        .iter()
        .map(|event| event.title.as_str())
        .collect();
    assert_eq!(
        titles,
        [
            "Entrega: Proyecto",
            "Entrega: Parcial 1",
            "Reunión de padres"
        ]
    );
    assert!(range.events[0].is_all_day);
    assert_eq!(range.events[1].starts_at, local(2026, 10, 8, 19, 30));
    assert_eq!(range.events[2].reminder_minutes, Some(2 * 1440));
    assert!(
        range.events[2]
            .description
            .starts_with("Reunión · Desarrollo de Software VIII")
    );

    // Quitar la fecha o desactivar la evaluación la saca del calendario; borrarla también.
    execute(
        &database,
        "UPDATE evaluations SET due_date = NULL WHERE id = 2",
    );
    sync::sync_evaluation(&database.lock().expect("lock"), 2).expect("no date");
    execute(&database, "DELETE FROM evaluations WHERE id = 1");
    execute(&database, "DELETE FROM academic_events WHERE id = 1");
    assert_eq!(count(&database, "SELECT COUNT(*) FROM calendar_events"), 0);
}

#[test]
fn follow_ups_are_tasks_and_completing_them_resolves_the_observation() {
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software V", "2GS221");
    execute(
        &database,
        &format!(
            "INSERT INTO students(id, identification, name) VALUES (1, '8-111', 'Ana Pérez');
             INSERT INTO enrollments(id, course_id, student_id) VALUES (1, {course_id}, 1);
             INSERT INTO student_observations(id, enrollment_id, text, follow_up_date)
                VALUES (1, 1, 'Entregar el taller pendiente', '2026-10-30');
             INSERT INTO student_observations(id, enrollment_id, text) VALUES (2, 1, 'Sin fecha');"
        ),
    );
    {
        let connection = database.lock().expect("lock");
        sync::sync_observation(&connection, 1).expect("follow up");
        sync::sync_observation(&connection, 2).expect("no follow up");
    }
    assert_eq!(count(&database, "SELECT COUNT(*) FROM tasks"), 1);
    let task_id = text(&database, "SELECT id FROM tasks").expect("task");
    assert_eq!(
        text(&database, "SELECT title FROM tasks").as_deref(),
        Some("Seguimiento: Ana Pérez")
    );
    assert_eq!(
        count(&database, "SELECT due_has_time FROM tasks"),
        0,
        "solo la fecha"
    );

    // Completarla en FlowDesk resuelve la observación, y reabrirla la reabre.
    change_status(&database, &task_id, "completed").expect("complete");
    assert_eq!(
        count(
            &database,
            "SELECT resolved FROM student_observations WHERE id = 1"
        ),
        1
    );
    change_status(&database, &task_id, "pending").expect("reopen");
    assert_eq!(
        count(
            &database,
            "SELECT resolved FROM student_observations WHERE id = 1"
        ),
        0
    );

    // Resolverla en Docencia completa la tarea.
    execute(
        &database,
        "UPDATE student_observations SET resolved = 1 WHERE id = 1",
    );
    sync::sync_observation(&database.lock().expect("lock"), 1).expect("resolved");
    assert_eq!(
        text(&database, "SELECT status FROM tasks").as_deref(),
        Some("completed")
    );
}

/// Base de la app de escritorio de Control Docente, con las columnas que se importan.
fn desktop_source(path: &std::path::Path) {
    let connection = Connection::open(path).expect("source");
    connection
        .execute_batch(
            "CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE academic_periods(id, name, start_date, end_date, is_active, is_closed);
             CREATE TABLE courses(id, title, code, group_name, period_label, academic_period_id,
                professor, passing_grade, attendance_minimum, low_grade_alert, low_attendance_alert,
                promotion_requires_attendance, is_archived, created_at, updated_at);
             CREATE TABLE students(id, identification, name, email, guardian_name, guardian_email,
                guardian_phone, created_at);
             CREATE TABLE enrollments(id, course_id, student_id, status, enrolled_at);
             CREATE TABLE student_groups(id, course_id, name, description, leader_membership_id, created_at);
             CREATE TABLE group_memberships(id, group_id, enrollment_id, joined_at);
             CREATE TABLE class_sessions(id, course_id, number, title, date, start_time, end_time,
                topic, attendance_token, is_held);
             CREATE TABLE attendance_records(id, enrollment_id, session_id, status, arrival_time,
                departure_time, notes, checked_in_at);
             CREATE TABLE evaluations(id, course_id, name, evaluation_type, grading_mode, weight,
                max_score, active, sort_order, due_date, published);
             CREATE TABLE grades(id, enrollment_id, evaluation_id, score, feedback, published, updated_at);
             CREATE TABLE group_grades(id, group_id, evaluation_id, score, updated_at);
             CREATE TABLE rubric_criteria(id, evaluation_id, name, description, weight, max_score, sort_order);
             CREATE TABLE rubric_scores(id, enrollment_id, criterion_id, score, feedback);
             CREATE TABLE recovery_grades(id, enrollment_id, evaluation_id, original_score,
                recovery_score, applied_score, notes, created_at);
             CREATE TABLE student_observations(id, enrollment_id, category, text, follow_up_date,
                resolved, private, created_at);
             CREATE TABLE academic_events(id, course_id, title, event_type, starts_at, ends_at,
                description, reminder_days);
             CREATE TABLE announcements(id, course_id, title, body, attachment, published, send_email, created_at);
             CREATE TABLE audit_logs(id, course_id, action, description, created_at);
             PRAGMA journal_mode = WAL;
             INSERT INTO courses VALUES (7, 'Desarrollo de Software VIII', '8408', '2GS131',
                'Segundo semestre', NULL, 'José Mendoza', 71, 80, 71, 80, 1, 0, '2026-08-01', '2026-08-01');
             INSERT INTO students VALUES (3, '8-111', 'Ana Pérez', '', '', '', '', '2026-08-01');
             INSERT INTO enrollments VALUES (11, 7, 3, 'active', '2026-08-01');
             INSERT INTO class_sessions VALUES (21, 7, 1, '', '2026-08-18', NULL, NULL, '', '', 1);
             INSERT INTO attendance_records VALUES (31, 11, 21, 'P', NULL, NULL, '', NULL);
             INSERT INTO evaluations VALUES (41, 7, 'Parcial 1', 'exam', 'individual', 20, 100, 1, 1,
                '2026-10-08T19:30', 1);
             INSERT INTO grades VALUES (51, 11, 41, 88, '', 1, '2026-10-09');",
        )
        .expect("source data");
}

#[test]
fn imports_control_docente_without_modifying_it() {
    let folder = std::env::temp_dir().join(format!("flowdesk-teaching-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).expect("folder");
    let source = folder.join("control-docente.sqlite3");
    desktop_source(&source);
    let before = std::fs::read(&source).expect("source bytes");

    let database = Database::in_memory();
    let result = legacy::import_desktop(
        &mut database.lock().expect("lock"),
        &source,
        &folder.join("backups"),
    )
    .expect("import");
    assert_eq!(
        (result.courses, result.students, result.enrollments),
        (1, 1, 1)
    );
    // Identificadores, notas y asistencia se conservan; la materia tiene proyecto y su entrega
    // está en el calendario.
    assert_eq!(
        count(
            &database,
            "SELECT CAST(score AS INTEGER) FROM grades WHERE id = 51"
        ),
        88
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM attendance_records WHERE session_id = 21"
        ),
        1
    );
    assert_eq!(count(&database, "SELECT COUNT(*) FROM projects"), 1);
    assert_eq!(
        text(&database, "SELECT title FROM calendar_events").as_deref(),
        Some("Entrega: Parcial 1")
    );
    assert!(
        legacy::was_imported(&database.lock().expect("lock"))
            .expect("marker")
            .is_some()
    );
    assert_eq!(
        std::fs::read(&source).expect("source after"),
        before,
        "el original no cambia"
    );
    assert_eq!(
        std::fs::read_dir(folder.join("backups"))
            .expect("backups")
            .count(),
        1
    );

    // Solo sobre Docencia vacía.
    assert!(
        legacy::import_desktop(
            &mut database.lock().expect("lock"),
            &source,
            &folder.join("backups")
        )
        .is_err()
    );
    std::fs::remove_dir_all(&folder).expect("cleanup");
}

#[test]
fn local_dates_and_weekdays() {
    assert_eq!(
        sync::parse_local("2026-10-08T19:30"),
        Some((local(2026, 10, 8, 19, 30), true))
    );
    assert_eq!(
        sync::parse_local("2026-10-08 19:30:00"),
        Some((local(2026, 10, 8, 19, 30), true))
    );
    assert_eq!(
        sync::parse_local("2026-10-08"),
        Some((local(2026, 10, 8, 0, 0), false))
    );
    assert_eq!(sync::parse_local("mañana"), None);
    let monday = NaiveDate::from_ymd_opt(2026, 8, 3).expect("date");
    assert_eq!(sync::first_weekday(monday, 1), monday);
    assert_eq!(
        sync::first_weekday(monday, 4)
            .weekday()
            .number_from_monday(),
        4
    );
    assert_eq!(sync::first_weekday(monday, 7).day(), 9);
}

/// Importa una base real de Control Docente indicada en `FLOWDESK_TEACHING_SOURCE`
/// (`cargo test real_control_docente -- --ignored`). Comprueba que llegan todas las filas.
#[test]
#[ignore]
fn imports_a_real_control_docente_database() {
    let Ok(source) = std::env::var("FLOWDESK_TEACHING_SOURCE") else {
        return;
    };
    let source = std::path::PathBuf::from(source);
    let original = Connection::open_with_flags(&source, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("source");
    let expected: Vec<(String, i64)> = [
        "courses",
        "students",
        "enrollments",
        "class_sessions",
        "attendance_records",
        "evaluations",
        "grades",
        "student_groups",
        "group_memberships",
        "rubric_criteria",
        "rubric_scores",
        "student_observations",
        "academic_events",
    ]
    .iter()
    .map(|table| {
        let rows: i64 = original
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count");
        (table.to_string(), rows)
    })
    .collect();
    drop(original);

    let folder = std::env::temp_dir().join(format!("flowdesk-real-{}", uuid::Uuid::new_v4()));
    let database = Database::in_memory();
    legacy::import_desktop(&mut database.lock().expect("lock"), &source, &folder).expect("import");
    for (table, rows) in &expected {
        assert_eq!(
            count(&database, &format!("SELECT COUNT(*) FROM {table}")),
            *rows,
            "{table}"
        );
        println!("{table}: {rows}");
    }
    let courses = count(&database, "SELECT COUNT(*) FROM courses");
    assert_eq!(count(&database, "SELECT COUNT(*) FROM projects"), courses);
    println!(
        "proyectos: {courses}, eventos reflejados: {}, tareas de seguimiento: {}",
        count(
            &database,
            "SELECT COUNT(*) FROM calendar_events WHERE source = 'teaching'"
        ),
        count(&database, "SELECT COUNT(*) FROM tasks")
    );
    let _ = std::fs::remove_dir_all(&folder);
}

/// Importa una base Django real indicada en `FLOWDESK_TEACHING_DJANGO`
/// (`cargo test real_django -- --ignored`).
#[test]
#[ignore]
fn imports_a_real_django_database() {
    let Ok(source) = std::env::var("FLOWDESK_TEACHING_DJANGO") else {
        return;
    };
    let folder = std::env::temp_dir().join(format!("flowdesk-django-{}", uuid::Uuid::new_v4()));
    let database = Database::in_memory();
    let result = legacy::import_django(
        &mut database.lock().expect("lock"),
        std::path::Path::new(&source),
        &folder,
    )
    .expect("import");
    println!(
        "materias: {}, estudiantes: {}, matrículas: {}, sesiones: {}, notas: {}, eventos reflejados: {}",
        result.courses,
        result.students,
        result.enrollments,
        count(&database, "SELECT COUNT(*) FROM class_sessions"),
        count(&database, "SELECT COUNT(*) FROM grades"),
        count(
            &database,
            "SELECT COUNT(*) FROM calendar_events WHERE source = 'teaching'"
        )
    );
    assert!(result.courses > 0);
    let _ = std::fs::remove_dir_all(&folder);
}

#[test]
fn theory_and_lab_on_the_same_day_are_one_attendance_session() {
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software VIII", "2GS131");
    // El horario de la UTP: martes teoría 2:30–3:15 y laboratorio 3:20–4:55; jueves teoría.
    let week = |weekday, kind: &str, start: &str, end: &str| ScheduleSlotInput {
        kind: kind.to_string(),
        start_time: start.to_string(),
        end_time: end.to_string(),
        room: "2D3".to_string(),
        starts_on: "2026-08-03".to_string(),
        ends_on: "2026-08-16".to_string(),
        ..slot(course_id, weekday)
    };
    for input in [
        week(2, "theory", "14:30", "15:15"),
        week(2, "lab", "15:20", "16:55"),
        week(4, "theory", "12:50", "14:25"),
    ] {
        save_slot(&mut database.lock().expect("lock"), &input).expect("slot");
    }
    let tuesday =
        query_range(&database, local(2026, 8, 4, 0, 0), local(2026, 8, 5, 0, 0)).expect("tuesday");
    let titles: Vec<_> = tuesday
        .events
        .iter()
        .map(|event| event.title.as_str())
        .collect();
    assert_eq!(
        titles,
        [
            "Desarrollo de Software VIII · Teoría",
            "Desarrollo de Software VIII · Laboratorio"
        ]
    );

    generate_sessions(&mut database.lock().expect("lock"), course_id).expect("sessions");
    let sessions: Vec<(String, String, String)> = database
        .with_connection(|connection| {
            connection
                .prepare("SELECT date, start_time, end_time FROM class_sessions ORDER BY number")?
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect()
        })
        .expect("sessions");
    let row =
        |date: &str, start: &str, end: &str| (date.to_string(), start.to_string(), end.to_string());
    assert_eq!(
        sessions,
        [
            row("2026-08-04", "14:30", "16:55"),
            row("2026-08-06", "12:50", "14:25"),
            row("2026-08-11", "14:30", "16:55"),
            row("2026-08-13", "12:50", "14:25"),
        ]
    );
    let bad_kind = ScheduleSlotInput {
        kind: "seminar".to_string(),
        ..slot(course_id, 1)
    };
    assert!(save_slot(&mut database.lock().expect("lock"), &bad_kind).is_err());
}

#[test]
fn institutional_time_blocks_default_to_the_utp_day() {
    use super::{
        models::TimeBlocks,
        schedule::{load_blocks, store_blocks},
    };
    let database = Database::in_memory();
    let connection = database.lock().expect("lock");
    let blocks = load_blocks(&connection).expect("default");
    assert_eq!(blocks, TimeBlocks::default());
    assert_eq!(
        (
            blocks.first.as_str(),
            blocks.minutes,
            blocks.gap,
            blocks.count
        ),
        ("07:00", 45, 5, 19)
    );
    let custom = TimeBlocks {
        first: "07:30".to_string(),
        minutes: 60,
        gap: 10,
        count: 10,
    };
    store_blocks(&connection, &custom).expect("store");
    assert_eq!(load_blocks(&connection).expect("load"), custom);
    // Veinte bloques de dos horas no caben en el día.
    let too_long = TimeBlocks {
        minutes: 120,
        count: 20,
        ..custom
    };
    assert!(store_blocks(&connection, &too_long).is_err());
}

#[test]
fn recording_attendance_marks_the_class_as_held() {
    use super::{commands::store_attendance, models::AttendanceUpdate};
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software V", "2GS221");
    execute(
        &database,
        &format!(
            "INSERT INTO class_sessions(id, course_id, number, date) VALUES (1, {course_id}, 1, '2026-08-05');
             INSERT INTO class_sessions(id, course_id, number, date) VALUES (2, {course_id}, 2, '2026-08-07');
             INSERT INTO students(id, identification, name) VALUES (1, '8-111', 'Ana'), (2, '8-222', 'Bruno');
             INSERT INTO enrollments(id, course_id, student_id) VALUES (1, {course_id}, 1), (2, {course_id}, 2);"
        ),
    );
    // Toda la clase 1 presente de una vez; en la clase 2 solo se quita una marca inexistente.
    let updates = [
        AttendanceUpdate {
            enrollment_id: 1,
            session_id: 1,
            status: "P".to_string(),
        },
        AttendanceUpdate {
            enrollment_id: 2,
            session_id: 1,
            status: "P".to_string(),
        },
        AttendanceUpdate {
            enrollment_id: 1,
            session_id: 2,
            status: String::new(),
        },
    ];
    assert_eq!(
        store_attendance(&mut database.lock().expect("lock"), &updates).expect("save"),
        3
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM attendance_records WHERE session_id = 1 AND status = 'P'"
        ),
        2
    );
    assert_eq!(
        count(&database, "SELECT is_held FROM class_sessions WHERE id = 1"),
        1
    );
    assert_eq!(
        count(&database, "SELECT is_held FROM class_sessions WHERE id = 2"),
        0
    );
    let invalid = [AttendanceUpdate {
        enrollment_id: 1,
        session_id: 2,
        status: "X".to_string(),
    }];
    assert!(store_attendance(&mut database.lock().expect("lock"), &invalid).is_err());
}

#[test]
fn the_overview_summarises_grades_attendance_and_the_agenda() {
    use super::overview::{WIDGETS, build_overview, load_layout, store_layout};
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software V", "2GS221");
    execute(
        &database,
        &format!(
            "INSERT INTO students(id, identification, name) VALUES (1, '1', 'Ana'), (2, '2', 'Bruno'), (3, '3', 'Carla');
             INSERT INTO enrollments(id, course_id, student_id) VALUES (1, {course_id}, 1), (2, {course_id}, 2), (3, {course_id}, 3);
             INSERT INTO class_sessions(id, course_id, number, date, is_held) VALUES
                (1, {course_id}, 1, '2026-08-05', 1), (2, {course_id}, 2, '2026-08-07', 1), (3, {course_id}, 3, '2026-08-12', 0);
             INSERT INTO attendance_records(enrollment_id, session_id, status) VALUES
                (1, 1, 'P'), (2, 1, 'A'), (3, 1, 'T'), (1, 2, 'P'), (2, 2, 'A'), (3, 2, 'J');
             INSERT INTO evaluations(id, course_id, name, weight, max_score, due_date) VALUES
                (1, {course_id}, 'Taller', 40, 100, NULL), (2, {course_id}, 'Parcial', 60, 50, '2099-01-10T19:30');
             INSERT INTO grades(enrollment_id, evaluation_id, score) VALUES (1, 1, 95), (1, 2, 46), (2, 1, 40);"
        ),
    );
    let now = local(2026, 8, 20, 12, 0);
    let overview =
        build_overview(&database.lock().expect("lock"), course_id, now).expect("overview");

    // Ana: (0.95·40 + 0.92·60) / 100 = 93,2 y asistencia 100 %; Bruno: 40 y 0 %; Carla sin notas.
    let ana = &overview.students[0];
    assert_eq!(ana.name, "Ana");
    assert!((ana.grade.expect("grade") - 93.2).abs() < 1e-9);
    assert_eq!((ana.attendance, ana.status.as_str()), (100.0, "approved"));
    let bruno = &overview.students[1];
    assert_eq!(
        (bruno.grade, bruno.attendance, bruno.absences),
        (Some(40.0), 0.0, 2)
    );
    assert_eq!(bruno.status, "at_risk");
    assert_eq!(bruno.reasons, ["nota baja", "asistencia baja"]);
    assert_eq!(
        (
            overview.students[2].status.as_str(),
            overview.students[2].grade
        ),
        ("ungraded", None)
    );

    assert_eq!(
        (
            overview.stats.approved,
            overview.stats.at_risk,
            overview.stats.ungraded
        ),
        (1, 1, 1)
    );
    assert_eq!(
        (overview.stats.held_sessions, overview.stats.total_sessions),
        (2, 3)
    );
    // Solo las clases realizadas, con P, T y J contando como asistencia.
    let rates: Vec<_> = overview
        .sessions
        .iter()
        .map(|session| session.rate.round() as i64)
        .collect();
    assert_eq!(rates, [67, 67]);
    assert_eq!(overview.sessions[0].late, 1);
    let bands: Vec<_> = overview
        .grade_bands
        .iter()
        .map(|band| band.value as i64)
        .collect();
    assert_eq!(bands, [1, 0, 0, 1]);
    // Promedio del parcial: 46/50 = 92 %, calificado 1 de 3.
    let parcial = &overview.evaluations[1];
    assert_eq!(
        (parcial.average, parcial.graded, parcial.total),
        (Some(92.0), 1, 3)
    );
    // La entrega de 2099 queda fuera de las próximas tres semanas.
    assert!(overview.agenda.is_empty());

    // Los paneles: todos por defecto; se guardan el orden y la visibilidad, y se rechazan los desconocidos.
    let connection = database.lock().expect("lock");
    let mut layout = load_layout(&connection).expect("layout");
    assert_eq!(layout.widgets.len(), WIDGETS.len());
    layout.widgets.reverse();
    layout.widgets[0].visible = false;
    let saved = store_layout(&connection, &layout).expect("store");
    assert_eq!(saved.widgets[0].id, "quick-actions");
    assert!(!saved.widgets[0].visible);
    layout.widgets[0].id = "otro".to_string();
    assert!(store_layout(&connection, &layout).is_err());
}

/// Resumen de cada materia sobre una copia real de la base de FlowDesk indicada en
/// `FLOWDESK_DB` (`cargo test real_flowdesk_database -- --ignored --nocapture`).
#[test]
#[ignore]
fn computes_the_overview_for_a_real_flowdesk_database() {
    let Ok(path) = std::env::var("FLOWDESK_DB") else {
        return;
    };
    let connection = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("copy");
    let ids: Vec<i64> = connection
        .prepare("SELECT id FROM courses ORDER BY id")
        .expect("courses")
        .query_map([], |row| row.get(0))
        .expect("rows")
        .collect::<Result<_, _>>()
        .expect("ids");
    for id in ids {
        let overview =
            super::overview::build_overview(&connection, id, chrono::Local::now().timestamp())
                .expect("overview");
        println!(
            "{}: {} estudiantes, asistencia {:.1} %, promedio {:?}, aprobando {}, en riesgo {}, sin notas {}, clases realizadas {}/{}, evaluaciones {}, próximas clases {}, agenda {}",
            overview.course.title,
            overview.stats.active_students,
            overview.stats.attendance_average,
            overview
                .stats
                .grade_average
                .map(|value| (value * 10.0).round() / 10.0),
            overview.stats.approved,
            overview.stats.at_risk,
            overview.stats.ungraded,
            overview.stats.held_sessions,
            overview.stats.total_sessions,
            overview.evaluations.len(),
            overview.next_classes.len(),
            overview.agenda.len(),
        );
    }
}

fn ymd(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).expect("fecha")
}

#[test]
fn panama_holidays_match_the_official_2026_list() {
    use super::academic::{easter, panama_holidays};
    let days: Vec<NaiveDate> = panama_holidays(2026)
        .into_iter()
        .map(|(day, _)| day)
        .collect();
    assert_eq!(
        days,
        [
            ymd(2026, 1, 1),
            ymd(2026, 1, 9),
            ymd(2026, 2, 17),
            ymd(2026, 4, 3),
            ymd(2026, 5, 1),
            ymd(2026, 11, 3),
            ymd(2026, 11, 5),
            ymd(2026, 11, 10),
            ymd(2026, 11, 28),
            ymd(2026, 12, 8),
            // El 20 de diciembre de 2026 es domingo: se libra el lunes.
            ymd(2026, 12, 21),
            ymd(2026, 12, 25),
        ]
    );
    assert!(panama_holidays(2026)[10].1.contains("puente"));
    assert_eq!(easter(2027), ymd(2027, 3, 28));
    // Martes de Carnaval de 2027, como en el calendario de la UTP.
    assert!(
        panama_holidays(2027)
            .iter()
            .any(|(day, _)| *day == ymd(2027, 2, 9))
    );
}

/// Clases de la franja en un intervalo, sin los días del calendario académico.
fn classes_between(database: &Database, start: i64, end: i64) -> Vec<i64> {
    query_range(database, start, end)
        .expect("range")
        .events
        .into_iter()
        .filter(|event| !event.is_all_day)
        .map(|event| event.starts_at)
        .collect()
}

#[test]
fn days_off_remove_classes_and_empty_sessions_and_give_them_back() {
    use super::academic::{apply, load_official, previous_range};
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software VIII", "2GS131");
    // Martes, del 3 de agosto al 4 de diciembre de 2026.
    save_slot(&mut database.lock().expect("lock"), &slot(course_id, 2)).expect("slot");
    generate_sessions(&mut database.lock().expect("lock"), course_id).expect("sessions");
    assert_eq!(count(&database, "SELECT COUNT(*) FROM class_sessions"), 18);
    // El 3 de noviembre ya tiene asistencia; el 24 se quitó a mano en el calendario.
    execute(
        &database,
        &format!(
            "INSERT INTO students(id, identification, name) VALUES (1, '8-111', 'Ana');
             INSERT INTO enrollments(id, course_id, student_id) VALUES (1, {course_id}, 1);
             INSERT INTO attendance_records(enrollment_id, session_id, status)
             SELECT 1, id, 'P' FROM class_sessions WHERE date = '2026-11-03';"
        ),
    );
    let event_id = text(&database, "SELECT calendar_event_id FROM course_schedule").expect("event");
    remove_event(
        &database,
        &event_id,
        Some(EventScope::This),
        Some(local(2026, 11, 24, 19, 30)),
    )
    .expect("a mano");

    let change = {
        let mut connection = database.lock().expect("lock");
        let transaction = connection.transaction().expect("tx");
        let added = load_official(&transaction, &[2026]).expect("load");
        assert!(added > 20);
        assert_eq!(load_official(&transaction, &[2026]).expect("again"), 0);
        let change = apply(&transaction, None).expect("apply");
        transaction.commit().expect("commit");
        change
    };
    // Martes libres en el periodo: 3 de noviembre (con datos, se queda) y 10 (vacía, se va).
    assert_eq!((change.removed_sessions, change.kept_sessions), (1, 1));
    assert_eq!(count(&database, "SELECT COUNT(*) FROM class_sessions"), 17);
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM class_sessions WHERE date = '2026-11-10'"
        ),
        0
    );
    assert_eq!(
        count(&database, "SELECT MAX(number) FROM class_sessions"),
        17
    );
    // En el calendario desaparecen las clases de los feriados y sigue la quitada a mano.
    let november = classes_between(
        &database,
        local(2026, 11, 1, 0, 0),
        local(2026, 12, 1, 0, 0),
    );
    assert_eq!(november, [local(2026, 11, 17, 19, 30)]);
    // Los días libres aparecen como eventos de todo el día; los periodos de clases, no.
    assert!(
        count(
            &database,
            "SELECT COUNT(*) FROM calendar_events WHERE external_id LIKE 'academic-day:%' AND is_all_day = 1"
        ) > 10
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM academic_calendar WHERE kind = 'term' AND calendar_event_id IS NOT NULL"
        ),
        0
    );
    // Generar de nuevo no recrea las sesiones de días libres.
    let again = generate_sessions(&mut database.lock().expect("lock"), course_id).expect("again");
    assert_eq!((again.created, again.skipped), (0, 2));

    // Si el 10 de noviembre deja de ser libre, su clase y su sesión vuelven.
    let change = {
        let mut connection = database.lock().expect("lock");
        let transaction = connection.transaction().expect("tx");
        let day_id: i64 = transaction
            .query_row(
                "SELECT id FROM academic_calendar WHERE starts_on = '2026-11-10'",
                [],
                |row| row.get(0),
            )
            .expect("day");
        let previous = previous_range(&transaction, day_id).expect("range");
        transaction
            .execute("DELETE FROM academic_calendar WHERE id = ?1", [day_id])
            .expect("delete");
        let change = apply(&transaction, previous).expect("apply");
        transaction.commit().expect("commit");
        change
    };
    assert_eq!(change.restored_sessions, 1);
    assert_eq!(
        count(
            &database,
            "SELECT number FROM class_sessions WHERE date = '2026-11-10'"
        ),
        15
    );
    let november = classes_between(
        &database,
        local(2026, 11, 1, 0, 0),
        local(2026, 12, 1, 0, 0),
    );
    assert_eq!(
        november,
        [local(2026, 11, 10, 19, 30), local(2026, 11, 17, 19, 30)]
    );
    // Su evento del calendario se borra con él.
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM calendar_events WHERE title = 'Primer Grito de Independencia'"
        ),
        0
    );
}

#[test]
fn academic_days_are_validated() {
    use super::{academic::save_day, models::AcademicDayInput};
    let database = Database::in_memory();
    let connection = database.lock().expect("lock");
    let day = |title: &str, kind: &str, from: &str, until: &str| AcademicDayInput {
        id: None,
        title: title.to_string(),
        kind: kind.to_string(),
        starts_on: from.to_string(),
        ends_on: until.to_string(),
        cancels_classes: true,
    };
    assert!(save_day(&connection, &day("", "holiday", "2026-11-03", "2026-11-03")).is_err());
    assert!(save_day(&connection, &day("X", "fiesta", "2026-11-03", "2026-11-03")).is_err());
    assert!(save_day(&connection, &day("X", "break", "2026-11-05", "2026-11-03")).is_err());
    let (id, previous) = save_day(
        &connection,
        &day("Semana de receso", "break", "2026-09-28", "2026-10-02"),
    )
    .expect("save");
    assert!(previous.is_none());
    let (_, previous) = save_day(
        &connection,
        &AcademicDayInput {
            id: Some(id),
            ..day("Receso", "break", "2026-09-29", "2026-10-02")
        },
    )
    .expect("update");
    assert_eq!(previous, Some((ymd(2026, 9, 28), ymd(2026, 10, 2))));
}

#[test]
fn the_course_plan_tracks_progress_and_links_sessions() {
    use super::{
        commands::store_attendance,
        models::{AttendanceUpdate, TopicInput},
        syllabus::{
            add_topics, build_syllabus, distribute, parse_topic_line, prepare_note, save_topic,
        },
    };
    assert_eq!(
        parse_topic_line("  - Semana 3: Árboles binarios"),
        Some(("Árboles binarios".to_string(), Some(3)))
    );
    assert_eq!(
        parse_topic_line("S4 - Grafos"),
        Some(("Grafos".to_string(), Some(4)))
    );
    assert_eq!(
        parse_topic_line("Tema 2. Pilas"),
        Some(("Pilas".to_string(), None))
    );
    assert_eq!(
        parse_topic_line("1) Introducción"),
        Some(("Introducción".to_string(), None))
    );
    assert_eq!(
        parse_topic_line("Sistemas operativos"),
        Some(("Sistemas operativos".to_string(), None))
    );
    assert_eq!(
        parse_topic_line("3 en raya"),
        Some(("3 en raya".to_string(), None))
    );
    assert_eq!(parse_topic_line("   •  "), None);

    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software V", "2GS221");
    // Miércoles y viernes, del 19 al 28 de agosto: 4 sesiones.
    let short = ScheduleSlotInput {
        starts_on: "2026-08-17".to_string(),
        ends_on: "2026-08-28".to_string(),
        ..slot(course_id, 3)
    };
    save_slot(&mut database.lock().expect("lock"), &short).expect("wednesday");
    save_slot(
        &mut database.lock().expect("lock"),
        &ScheduleSlotInput {
            weekday: 5,
            ..short
        },
    )
    .expect("friday");
    generate_sessions(&mut database.lock().expect("lock"), course_id).expect("sessions");

    let connection = database.lock().expect("lock");
    assert_eq!(
        add_topics(
            &connection,
            course_id,
            "Introducción\nSemana 2: Pilas\nColas\n\nListas\nÁrboles"
        )
        .expect("add"),
        5
    );
    let result = distribute(&connection, course_id, false).expect("distribute");
    // Introducción el 19; Pilas espera a la semana 2 (miércoles 26); Colas el viernes 28;
    // Listas y Árboles se quedan sin sesión.
    assert_eq!((result.linked, result.left), (3, 2));
    let plan = build_syllabus(&connection, course_id, ymd(2026, 8, 27)).expect("plan");
    let dates: Vec<Option<&str>> = plan
        .topics
        .iter()
        .map(|topic| topic.session_date.as_deref())
        .collect();
    assert_eq!(
        dates,
        [
            Some("2026-08-19"),
            Some("2026-08-26"),
            Some("2026-08-28"),
            None,
            None
        ]
    );
    assert_eq!(plan.topics[1].session_week, Some(2));
    // El tema de la sesión (el que se ve en Asistencia) se rellena con el del plan.
    let session_topic: String = connection
        .query_row(
            "SELECT topic FROM class_sessions WHERE date = '2026-08-19'",
            [],
            |row| row.get(0),
        )
        .expect("topic");
    assert_eq!(session_topic, "Introducción");
    // A 27 de agosto, «Introducción» y «Pilas» ya debían haberse dado.
    assert_eq!(plan.progress.total, 5);
    assert_eq!(plan.progress.current, Some(1));
    assert_eq!(plan.progress.behind, 2);

    // Pasar asistencia en la sesión cumple su tema.
    let first_session: i64 = connection
        .query_row(
            "SELECT id FROM class_sessions WHERE date = '2026-08-19'",
            [],
            |row| row.get(0),
        )
        .expect("session");
    drop(connection);
    execute(
        &database,
        &format!(
            "INSERT INTO students(id, identification, name) VALUES (1, '8-111', 'Ana');
             INSERT INTO enrollments(id, course_id, student_id) VALUES (1, {course_id}, 1);"
        ),
    );
    store_attendance(
        &mut database.lock().expect("lock"),
        &[AttendanceUpdate {
            enrollment_id: 1,
            session_id: first_session,
            status: "P".to_string(),
        }],
    )
    .expect("attendance");
    let connection = database.lock().expect("lock");
    let plan = build_syllabus(&connection, course_id, ymd(2026, 8, 27)).expect("plan");
    assert!(plan.topics[0].done);
    assert_eq!(
        (
            plan.progress.done,
            plan.progress.current,
            plan.progress.behind
        ),
        (1, Some(2), 1)
    );
    assert_eq!(plan.progress.current_title.as_deref(), Some("Pilas"));

    // Cambiar el título sigue en la sesión; quitar la sesión la deja libre.
    let pilas = &plan.topics[1];
    save_topic(
        &connection,
        &TopicInput {
            id: Some(pilas.id),
            course_id,
            title: "Pilas y colas".to_string(),
            week: Some(2),
            details: String::new(),
            session_id: None,
            done: false,
        },
    )
    .expect("edit");
    let topic: String = connection
        .query_row(
            "SELECT topic FROM class_sessions WHERE date = '2026-08-26'",
            [],
            |row| row.get(0),
        )
        .expect("topic");
    assert_eq!(topic, "");
    // Con `reset`, los pendientes se reparten de nuevo tras el último tema dado: «Pilas y
    // colas» vuelve al 26 (semana 2) y «Colas» al 28.
    let result = distribute(&connection, course_id, true).expect("again");
    assert_eq!((result.linked, result.left), (2, 2));

    // La nota de preparación se crea una vez, en el proyecto de la materia.
    let note_id = prepare_note(&connection, pilas.id).expect("note");
    assert_eq!(prepare_note(&connection, pilas.id).expect("same"), note_id);
    let (title, project): (String, Option<String>) = connection
        .query_row(
            "SELECT title, project_id FROM notes WHERE id = ?1",
            [&note_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("note row");
    assert_eq!(title, "Preparar: Pilas y colas");
    assert!(project.is_some());
    let content: String = connection
        .query_row(
            "SELECT content FROM notes WHERE id = ?1",
            [&note_id],
            |row| row.get(0),
        )
        .expect("content");
    assert!(content.contains("Objetivos") && content.contains("Tema 2"));
    // Borrar la nota libera el tema para crear otra.
    connection
        .execute("DELETE FROM notes WHERE id = ?1", [&note_id])
        .expect("delete");
    assert_ne!(prepare_note(&connection, pilas.id).expect("new"), note_id);
}

/// Con `FLOWDESK_DB` apuntando a una COPIA de la base real: la migra, carga el calendario
/// oficial y cuenta qué sesiones quita. `cargo test academic_calendar_to_a_real -- --ignored --nocapture`.
#[test]
#[ignore]
fn applies_the_academic_calendar_to_a_real_flowdesk_database_copy() {
    let Ok(path) = std::env::var("FLOWDESK_DB") else {
        return;
    };
    let mut connection = Connection::open(&path).expect("copy");
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("fk");
    let current: i64 = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("version");
    for (version, sql) in crate::database::migrations() {
        if *version > current {
            let transaction = connection.transaction().expect("tx");
            transaction.execute_batch(sql).expect("migration");
            transaction
                .execute(
                    "INSERT INTO schema_migrations(version) VALUES (?1)",
                    [version],
                )
                .expect("record");
            transaction.commit().expect("commit");
        }
    }
    let before: Vec<(String, String)> = connection
        .prepare("SELECT c.title, s.date FROM class_sessions s JOIN courses c ON c.id = s.course_id ORDER BY c.title, s.date")
        .expect("sessions")
        .query_map([], |row| Ok((row.get(0)?, row.get::<_, Option<String>>(1)?.unwrap_or_default())))
        .expect("rows")
        .collect::<Result<_, _>>()
        .expect("before");
    let transaction = connection.transaction().expect("tx");
    let added = super::academic::load_official(&transaction, &[2026, 2027]).expect("load");
    let change = super::academic::apply(&transaction, None).expect("apply");
    transaction.commit().expect("commit");
    let after: Vec<(String, String)> = connection
        .prepare("SELECT c.title, s.date FROM class_sessions s JOIN courses c ON c.id = s.course_id ORDER BY c.title, s.date")
        .expect("sessions")
        .query_map([], |row| Ok((row.get(0)?, row.get::<_, Option<String>>(1)?.unwrap_or_default())))
        .expect("rows")
        .collect::<Result<_, _>>()
        .expect("after");
    println!(
        "días añadidos {added}; sesiones quitadas {}, conservadas con datos {}",
        change.removed_sessions, change.kept_sessions
    );
    for removed in before.iter().filter(|session| !after.contains(session)) {
        println!("  quitada: {} · {}", removed.0, removed.1);
    }
    let days_off = super::academic::DaysOff::load(&connection).expect("days");
    for (title, date) in &after {
        if let Ok(day) = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            && days_off.contains(day)
        {
            println!("  conservada (tiene asistencia): {title} · {date}");
        }
    }
    let skipped: Vec<(String, String)> = connection
        .prepare("SELECT c.title || ' · ' || s.kind, s.skipped_occurrences FROM course_schedule s JOIN courses c ON c.id = s.course_id")
        .expect("slots")
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("rows")
        .collect::<Result<_, _>>()
        .expect("skipped");
    for (slot, occurrences) in skipped {
        let days: Vec<String> = crate::recurrence::parse_exceptions(&occurrences)
            .into_iter()
            .filter_map(|at| Local.timestamp_opt(at, 0).single())
            .map(|moment| moment.format("%d/%m").to_string())
            .collect();
        println!(
            "  clases quitadas del calendario: {slot}: {}",
            days.join(", ")
        );
    }
}

/// Plantilla mínima con las etiquetas del formulario de la UTP: «Introducción», una hoja
/// «GRUPO 1» con valores y una «GRUPO 2» que los copia con fórmulas y va una fila más abajo.
fn utp_template() -> Vec<u8> {
    use rust_xlsxwriter::{Format, Workbook};
    let mut workbook = Workbook::new();
    let plain = Format::new();
    let intro = workbook.add_worksheet();
    intro.set_name("Introducción").unwrap();
    for (row, label) in [
        "Nombre del Docente: ",
        "Grupo:",
        "Carrera: ",
        "Asignatura: ",
        "Código de Asignatura: ",
        "Código de Horario: ",
    ]
    .iter()
    .enumerate()
    {
        intro
            .merge_range(5 + row as u32, 2, 5 + row as u32, 3, label, &plain)
            .unwrap();
    }
    intro
        .write_string(
            11,
            2,
            "Marque con una X el(los) motivo(s) por los que reemplaza el Examen Semestral",
        )
        .unwrap();
    intro
        .write_string(
            12,
            3,
            "Que los alumnos alcancen o logren de manera práctica los objetivos.",
        )
        .unwrap();
    intro
        .write_string(
            13,
            3,
            "Que los alumnos pongan en práctica las etapas de un proyecto.",
        )
        .unwrap();
    intro.write_string(14, 3, "Otros (Explique) ").unwrap();
    for (sheet_name, offset) in [("GRUPO 1", 0_u32), ("GRUPO 2", 1)] {
        let sheet = workbook.add_worksheet();
        sheet.set_name(sheet_name).unwrap();
        let labels = [
            (4, 1, "CÓDIGO DE MATERIA:", 2),
            (5, 1, "MATERIA:", 2),
            (7, 1, "CÓDIGO DE HORA:", 2),
            (7, 3, "AÑO:", 4),
            (7, 5, "PERÍODO:", 6),
            (8, 1, "GRUPO:", 2),
            (10, 1, "DOCENTE:", 2),
            (11, 1, "CEDULA:", 2),
        ];
        for (row, column, label, value_column) in labels {
            sheet.write_string(row + offset, column, label).unwrap();
            if offset > 0 {
                let source = xlsx_ref(value_column, row);
                sheet
                    .write_formula(
                        row + offset,
                        value_column,
                        format!("='GRUPO 1'!{source}").as_str(),
                    )
                    .unwrap();
            }
        }
        for (column, label) in ["NOMBRE", "CEDULA", "NOTA", "OBSERVACIONES"]
            .iter()
            .enumerate()
        {
            sheet
                .write_string(14 + offset, 1 + column as u16, *label)
                .unwrap();
        }
        for number in 1..=3 {
            sheet
                .write_number(14 + offset + number, 0, number as f64)
                .unwrap();
        }
        sheet
            .write_string(19 + offset, 1, "OBSERVACIONES AL TRABAJO")
            .unwrap();
    }
    workbook.save_to_buffer().expect("plantilla")
}

fn xlsx_ref(column: u16, row: u32) -> String {
    super::xlsx_template::make_ref(column as u32 + 1, row + 1)
}

#[test]
fn the_utp_final_sheet_fills_the_template_by_team() {
    use super::{
        final_sheet::{fill, load_settings, round_grade, store_settings},
        xlsx_template::Template,
    };
    assert_eq!(round_grade(85.5, 0), 86.0);
    assert_eq!(round_grade(42.75 / 50.0 * 100.0, 0), 86.0);
    assert_eq!(round_grade(84.449, 1), 84.4);
    assert_eq!(round_grade(84.45, 1), 84.5);

    let dir = std::env::temp_dir().join(format!("flowdesk-hoja-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let template_path = dir.join("formato.xlsx");
    std::fs::write(&template_path, utp_template()).unwrap();

    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software VIII", "2GS131");
    execute(
        &database,
        &format!(
            "UPDATE courses SET professor = 'Prof. Demo' WHERE id = {course_id};
             INSERT INTO students(id, identification, name) VALUES
               (1, '4-111-1', 'Ana Castillo'), (2, '4-222-2', 'Bruno Díaz'), (3, '', 'Carla Pérez'),
               (4, '4-444-4', 'Diego Ruiz'), (5, '4-555-5', 'Elena Sin Equipo');
             INSERT INTO enrollments(id, course_id, student_id) VALUES
               (1, {course_id}, 1), (2, {course_id}, 2), (3, {course_id}, 3), (4, {course_id}, 4), (5, {course_id}, 5);
             INSERT INTO student_groups(id, course_id, name) VALUES (1, {course_id}, 'Equipo 2'), (2, {course_id}, 'Equipo 1');
             INSERT INTO group_memberships(group_id, enrollment_id) VALUES (2, 1), (2, 2), (2, 3), (1, 4);
             INSERT INTO evaluations(id, course_id, name, grading_mode, weight, max_score) VALUES
               (1, {course_id}, 'Parcial', 'individual', 40, 100),
               (2, {course_id}, 'Proyecto final', 'group', 60, 50);
             INSERT INTO grades(enrollment_id, evaluation_id, score) VALUES
               (1, 2, 42.75), (2, 2, 40), (4, 2, 30), (1, 1, 90);"
        ),
    );
    let connection = database.lock().expect("lock");
    let mut settings = load_settings(&connection, course_id).expect("settings");
    // Por defecto: la evaluación por equipos del proyecto y los datos de la materia.
    assert_eq!(settings.evaluation_id, Some(2));
    assert_eq!(settings.subject, "Desarrollo de Software VIII");
    assert_eq!(settings.group_name, "2GS131");
    assert_eq!(settings.teacher_name, "Prof. Demo");
    settings.teacher_identification = "4-700-100".into();
    settings.career = "Lic. en Desarrollo de Software".into();
    settings.schedule_code = "1234".into();
    settings.reasons = vec![0, 2];
    settings.other_reason = "Proyecto con una empresa".into();
    settings
        .team_notes
        .insert("2".into(), "Buen trabajo en equipo".into());
    store_settings(&connection, course_id, &settings).expect("store");
    // La cédula y la carrera se proponen en la siguiente materia.
    let other = {
        connection
            .execute("INSERT INTO courses(title, code) VALUES ('Otra', '1')", [])
            .unwrap();
        connection.last_insert_rowid()
    };
    let suggested = load_settings(&connection, other).expect("other");
    assert_eq!(suggested.teacher_identification, "4-700-100");
    assert_eq!(suggested.evaluation_id, None);

    let preview = super::final_sheet::prepare_for_tests(&connection, course_id, &template_path);
    let teams: Vec<(&str, Option<&str>, usize)> = preview
        .teams
        .iter()
        .map(|team| {
            (
                team.name.as_str(),
                team.sheet.as_deref(),
                team.members.len(),
            )
        })
        .collect();
    assert_eq!(
        teams,
        [
            ("Equipo 1", Some("GRUPO 1"), 3),
            ("Equipo 2", Some("GRUPO 2"), 1)
        ]
    );
    let values: Vec<Option<f64>> = preview.teams[0]
        .members
        .iter()
        .map(|member| member.value)
        .collect();
    assert_eq!(values, [Some(86.0), Some(80.0), None]);
    assert!(preview.can_export);
    let messages: Vec<&str> = preview
        .issues
        .iter()
        .map(|issue| issue.message.as_str())
        .collect();
    assert!(
        messages
            .iter()
            .any(|message| message.contains("Elena Sin Equipo")),
        "{messages:?}"
    );
    assert!(
        messages
            .iter()
            .any(|message| message.starts_with("Sin nota") && message.contains("Carla Pérez"))
    );
    assert!(
        messages
            .iter()
            .any(|message| message.starts_with("Sin cédula") && message.contains("Carla Pérez"))
    );
    let template = preview.template.as_ref().expect("plantilla");
    assert_eq!(
        (
            template.groups,
            template.rows_per_group,
            template.reasons.len()
        ),
        (2, 3, 3)
    );

    let mut filled = Template::open(&template_path).expect("abrir");
    fill(&mut filled, &preview.settings, &preview.teams).expect("rellenar");
    let mut output = Template::from_bytes(filled.to_bytes().expect("bytes")).expect("salida");
    let value = |template: &mut Template, sheet: &str, cell: &str| {
        let (column, row) = super::xlsx_template::parse_ref(cell).unwrap();
        template
            .cells(sheet)
            .unwrap()
            .into_iter()
            .find(|found| found.column == column && found.row == row)
            .map(|found| found.text)
    };
    assert_eq!(
        value(&mut output, "Introducción", "E6").as_deref(),
        Some("Prof. Demo")
    );
    assert_eq!(
        value(&mut output, "Introducción", "E11").as_deref(),
        Some("1234")
    );
    assert_eq!(
        value(&mut output, "Introducción", "C13").as_deref(),
        Some("X")
    );
    assert_eq!(value(&mut output, "Introducción", "C14"), None);
    assert_eq!(
        value(&mut output, "Introducción", "C15").as_deref(),
        Some("X")
    );
    assert_eq!(
        value(&mut output, "Introducción", "D16").as_deref(),
        Some("Proyecto con una empresa")
    );
    assert_eq!(value(&mut output, "GRUPO 1", "C5").as_deref(), Some("8408"));
    assert_eq!(
        value(&mut output, "GRUPO 1", "E8").as_deref(),
        Some(preview.settings.year.as_str())
    );
    assert_eq!(
        value(&mut output, "GRUPO 1", "B16").as_deref(),
        Some("Ana Castillo")
    );
    assert_eq!(
        value(&mut output, "GRUPO 1", "C16").as_deref(),
        Some("4-111-1")
    );
    assert_eq!(value(&mut output, "GRUPO 1", "D16").as_deref(), Some("86"));
    assert_eq!(value(&mut output, "GRUPO 1", "D18"), None);
    // «Equipo 1» (id 2) va en GRUPO 1 con su observación; GRUPO 2 no tiene.
    assert_eq!(
        value(&mut output, "GRUPO 1", "B21").as_deref(),
        Some("Buen trabajo en equipo")
    );
    assert_eq!(value(&mut output, "GRUPO 2", "B22"), None);
    // GRUPO 2 conserva sus fórmulas y guarda su valor calculado.
    assert_eq!(value(&mut output, "GRUPO 2", "C6").as_deref(), Some("8408"));
    assert_eq!(
        value(&mut output, "GRUPO 2", "B17").as_deref(),
        Some("Diego Ruiz")
    );
    assert_eq!(value(&mut output, "GRUPO 2", "D17").as_deref(), Some("60"));

    // Un tercer equipo no cabe en una plantilla de dos hojas.
    connection
        .execute_batch(&format!(
            "INSERT INTO student_groups(id, course_id, name) VALUES (3, {course_id}, 'Equipo 10');
             INSERT INTO group_memberships(group_id, enrollment_id) VALUES (3, 5);"
        ))
        .unwrap();
    let preview = super::final_sheet::prepare_for_tests(&connection, course_id, &template_path);
    assert!(!preview.can_export);
    assert_eq!(
        preview.teams.last().map(|team| team.name.as_str()),
        Some("Equipo 10")
    );
    assert!(
        preview
            .issues
            .iter()
            .any(|issue| issue.level == "error" && issue.message.contains("3 equipos"))
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// Con `FLOWDESK_UTP_TEMPLATE` apuntando a una copia del formulario oficial, comprueba que
/// al rellenarlo no cambia nada más que los valores. `FLOWDESK_UTP_OUT` guarda el resultado.
#[test]
#[ignore]
fn fills_the_real_utp_template_without_changing_its_format() {
    use super::{final_sheet::fill, xlsx_template::Template};
    use std::io::Read;
    let Ok(path) = std::env::var("FLOWDESK_UTP_TEMPLATE") else {
        return;
    };
    let path = std::path::PathBuf::from(path);
    let database = Database::in_memory();
    let course_id = course(&database, "Desarrollo de Software VIII", "2GS131");
    let mut members = String::new();
    for index in 1..=12 {
        members.push_str(&format!(
            "INSERT INTO students(id, identification, name) VALUES ({index}, '4-{index}00-{index}', 'Estudiante {index:02}');
             INSERT INTO enrollments(id, course_id, student_id) VALUES ({index}, {course_id}, {index});
             INSERT INTO group_memberships(group_id, enrollment_id) VALUES ({}, {index});
             INSERT INTO grades(enrollment_id, evaluation_id, score) VALUES ({index}, 1, {});",
            if index <= 6 { 1 } else { 2 },
            70.0 + index as f64 * 2.25
        ));
    }
    execute(
        &database,
        &format!(
            "UPDATE courses SET professor = 'Prof. Demo' WHERE id = {course_id};
             INSERT INTO evaluations(id, course_id, name, grading_mode, weight, max_score) VALUES (1, {course_id}, 'Proyecto final', 'group', 30, 100);
             INSERT INTO student_groups(id, course_id, name) VALUES (1, {course_id}, 'Equipo A'), (2, {course_id}, 'Equipo B');
             {members}"
        ),
    );
    let connection = database.lock().expect("lock");
    let mut settings = super::final_sheet::load_settings(&connection, course_id).expect("settings");
    settings.reasons = vec![0, 5];
    settings.schedule_code = "1234".into();
    super::final_sheet::store_settings(&connection, course_id, &settings).expect("store");
    let preview = super::final_sheet::prepare_for_tests(&connection, course_id, &path);
    let info = preview.template.as_ref().expect("plantilla");
    println!(
        "hojas de grupo {}, filas {}, motivos {:?}",
        info.groups, info.rows_per_group, info.reasons
    );
    assert_eq!(
        (info.groups, info.rows_per_group, info.reasons.len()),
        (8, 10, 7)
    );
    for issue in &preview.issues {
        println!("{}: {}", issue.level, issue.message);
    }
    let mut template = Template::open(&path).expect("abrir");
    fill(&mut template, &preview.settings, &preview.teams).expect("rellenar");
    let bytes = template.to_bytes().expect("bytes");
    if let Ok(out) = std::env::var("FLOWDESK_UTP_OUT") {
        std::fs::write(out, &bytes).unwrap();
    }

    // Todo lo que no es una hoja ni el libro sigue idéntico; en las hojas, cada celda
    // conserva su estilo y lo de fuera de los datos (combinadas, márgenes…) no cambia.
    let read_all = |data: &[u8]| {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).unwrap();
        (0..archive.len())
            .map(|index| {
                let mut file = archive.by_index(index).unwrap();
                let mut content = Vec::new();
                file.read_to_end(&mut content).unwrap();
                (file.name().unwrap().to_string(), content)
            })
            .collect::<Vec<_>>()
    };
    let original = read_all(&std::fs::read(&path).unwrap());
    let filled = read_all(&bytes);
    assert_eq!(
        original.iter().map(|(name, _)| name).collect::<Vec<_>>(),
        filled.iter().map(|(name, _)| name).collect::<Vec<_>>()
    );
    let styles = |xml: &str| {
        let mut found = Vec::new();
        let mut rest = xml;
        while let Some(start) = rest.find("<c r=\"") {
            let tag_end = rest[start..].find('>').unwrap() + start;
            let tag = &rest[start..tag_end];
            let reference = tag[6..].split('"').next().unwrap().to_string();
            let style = tag
                .split(" s=\"")
                .nth(1)
                .map(|value| value.split('"').next().unwrap().to_string());
            found.push((reference, style));
            rest = &rest[tag_end..];
        }
        found
    };
    let outside = |xml: &str| {
        let start = xml.find("<sheetData").unwrap();
        let end = xml.find("</sheetData>").unwrap();
        format!("{}{}", &xml[..start], &xml[end..])
    };
    let mut changed = 0;
    for ((name, before), (_, after)) in original.iter().zip(&filled) {
        if before == after {
            continue;
        }
        changed += 1;
        let (before, after) = (
            String::from_utf8_lossy(before),
            String::from_utf8_lossy(after),
        );
        if name == "xl/workbook.xml" {
            assert_eq!(after.replace(" fullCalcOnLoad=\"1\"", ""), before, "{name}");
            continue;
        }
        assert!(name.starts_with("xl/worksheets/sheet"), "{name} cambió");
        assert_eq!(styles(&before), styles(&after), "estilos de {name}");
        assert_eq!(
            outside(&before),
            outside(&after),
            "fuera de los datos en {name}"
        );
    }
    println!("partes cambiadas: {changed}");

    let mut output = Template::from_bytes(bytes).unwrap();
    let cells = output.cells("GRUPO 1").unwrap();
    let at = |cells: &[super::xlsx_template::CellText], column: u32, row: u32| {
        cells
            .iter()
            .find(|cell| cell.column == column && cell.row == row)
            .map(|cell| cell.text.clone())
    };
    assert_eq!(at(&cells, 2, 16).as_deref(), Some("Estudiante 01"));
    assert_eq!(at(&cells, 4, 16).as_deref(), Some("72"));
    assert_eq!(at(&cells, 3, 5).as_deref(), Some("8408"));
    let second = output.cells("GRUPO 2").unwrap();
    assert_eq!(at(&second, 2, 17).as_deref(), Some("Estudiante 07"));
    assert_eq!(at(&second, 3, 6).as_deref(), Some("8408"));
    let intro = output.cells("Introducción").unwrap();
    assert_eq!(at(&intro, 5, 6).as_deref(), Some("Prof. Demo"));
    assert_eq!(at(&intro, 3, 13).as_deref(), Some("X"));
    assert_eq!(at(&intro, 3, 18).as_deref(), Some("X"));
    assert_eq!(at(&intro, 3, 14), None);
}

/// Con `FLOWDESK_DB` (una COPIA de la base real) y `FLOWDESK_UTP_TEMPLATE`, muestra la
/// revisión de cada materia y guarda la hoja rellenada en `FLOWDESK_UTP_OUT` (carpeta).
#[test]
#[ignore]
fn prepares_the_utp_sheet_for_a_real_flowdesk_database_copy() {
    let (Ok(db), Ok(template)) = (
        std::env::var("FLOWDESK_DB"),
        std::env::var("FLOWDESK_UTP_TEMPLATE"),
    ) else {
        return;
    };
    let template = std::path::PathBuf::from(template);
    let connection = Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("copia");
    let courses: Vec<(i64, String)> = connection
        .prepare("SELECT id, title FROM courses ORDER BY id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    for (id, title) in courses {
        let preview = super::final_sheet::prepare_for_tests(&connection, id, &template);
        let evaluation = preview
            .evaluations
            .iter()
            .find(|evaluation| Some(evaluation.id) == preview.settings.evaluation_id)
            .map_or("nota final del curso".to_string(), |evaluation| {
                evaluation.name.clone()
            });
        println!(
            "{title}: nota de «{evaluation}», {} equipos, sin equipo {}",
            preview.teams.len(),
            preview.unassigned.len()
        );
        for team in &preview.teams {
            let values: Vec<String> = team
                .members
                .iter()
                .map(|member| member.value.map_or("—".into(), |value| value.to_string()))
                .collect();
            println!(
                "  {} → {}: {}",
                team.name,
                team.sheet.as_deref().unwrap_or("no cabe"),
                values.join(", ")
            );
        }
        for issue in &preview.issues {
            println!(
                "  [{}] {}",
                issue.level,
                issue.message.chars().take(110).collect::<String>()
            );
        }
        if let Ok(out) = std::env::var("FLOWDESK_UTP_OUT") {
            let mut filled = super::xlsx_template::Template::open(&template).unwrap();
            super::final_sheet::fill(&mut filled, &preview.settings, &preview.teams).unwrap();
            filled
                .save(&std::path::Path::new(&out).join(format!("curso-{id}.xlsx")))
                .unwrap();
        }
    }
}
