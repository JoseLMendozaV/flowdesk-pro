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
