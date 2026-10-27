-- Docencia: el modelo de Control Docente integrado en FlowDesk. Las tablas conservan sus
-- nombres e identificadores enteros para que la importación desde Control Docente (y desde
-- la versión Django) copie las filas tal cual.

CREATE TABLE IF NOT EXISTS academic_periods (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_closed INTEGER NOT NULL DEFAULT 0,
    UNIQUE(name)
);

-- `project_id`: el proyecto de FlowDesk de la materia (tareas, notas, tiempo y agenda).
CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    group_name TEXT NOT NULL DEFAULT '',
    period_label TEXT NOT NULL DEFAULT '',
    academic_period_id INTEGER REFERENCES academic_periods(id) ON DELETE SET NULL,
    professor TEXT NOT NULL DEFAULT '',
    passing_grade REAL NOT NULL DEFAULT 71,
    attendance_minimum REAL NOT NULL DEFAULT 80,
    low_grade_alert REAL NOT NULL DEFAULT 71,
    low_attendance_alert REAL NOT NULL DEFAULT 80,
    promotion_requires_attendance INTEGER NOT NULL DEFAULT 1,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY,
    identification TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    guardian_name TEXT NOT NULL DEFAULT '',
    guardian_email TEXT NOT NULL DEFAULT '',
    guardian_phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, student_id)
);

CREATE TABLE IF NOT EXISTS student_groups (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    leader_membership_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, name)
);

CREATE TABLE IF NOT EXISTS group_memberships (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
    enrollment_id INTEGER NOT NULL UNIQUE REFERENCES enrollments(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS class_sessions (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    date TEXT,
    start_time TEXT,
    end_time TEXT,
    topic TEXT NOT NULL DEFAULT '',
    attendance_token TEXT NOT NULL DEFAULT '',
    is_held INTEGER NOT NULL DEFAULT 0,
    UNIQUE(course_id, number)
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT '' CHECK(status IN ('', 'P', 'A', 'J', 'T')),
    arrival_time TEXT,
    departure_time TEXT,
    notes TEXT NOT NULL DEFAULT '',
    checked_in_at TEXT,
    UNIQUE(enrollment_id, session_id)
);

-- `calendar_event_id`: la entrega en el calendario de FlowDesk, si tiene fecha.
CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    evaluation_type TEXT NOT NULL DEFAULT 'task',
    grading_mode TEXT NOT NULL DEFAULT 'individual' CHECK(grading_mode IN ('individual', 'group')),
    weight REAL NOT NULL CHECK(weight > 0 AND weight <= 100),
    max_score REAL NOT NULL DEFAULT 100 CHECK(max_score > 0),
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 1,
    due_date TEXT,
    published INTEGER NOT NULL DEFAULT 1,
    calendar_event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS grades (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    score REAL,
    feedback TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(enrollment_id, evaluation_id)
);

CREATE TABLE IF NOT EXISTS group_grades (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    score REAL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, evaluation_id)
);

CREATE TABLE IF NOT EXISTS rubric_criteria (
    id INTEGER PRIMARY KEY,
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    weight REAL NOT NULL,
    max_score REAL NOT NULL DEFAULT 100,
    sort_order INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rubric_scores (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    criterion_id INTEGER NOT NULL REFERENCES rubric_criteria(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    feedback TEXT NOT NULL DEFAULT '',
    UNIQUE(enrollment_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS recovery_grades (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    original_score REAL,
    recovery_score REAL NOT NULL,
    applied_score REAL NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- `task_id`: la tarea de seguimiento en FlowDesk cuando hay fecha de seguimiento.
CREATE TABLE IF NOT EXISTS student_observations (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'academic',
    text TEXT NOT NULL,
    follow_up_date TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    private INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS academic_events (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'other',
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    description TEXT NOT NULL DEFAULT '',
    reminder_days INTEGER NOT NULL DEFAULT 1,
    calendar_event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    attachment TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 1,
    send_email INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Horario semanal: cada franja es un evento que se repite en el calendario de FlowDesk
-- entre `starts_on` y `ends_on` (normalmente el periodo académico). `kind`: clase, teoría
-- o laboratorio (un mismo día puede tener una franja de cada).
CREATE TABLE IF NOT EXISTS course_schedule (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'class' CHECK (kind IN ('class', 'theory', 'lab')),
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    room TEXT NOT NULL DEFAULT '',
    starts_on TEXT NOT NULL,
    ends_on TEXT NOT NULL,
    reminder_minutes INTEGER CHECK (reminder_minutes IS NULL OR reminder_minutes BETWEEN 0 AND 1440),
    calendar_event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
    CHECK (end_time > start_time),
    CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON class_sessions(course_id, number);
CREATE INDEX IF NOT EXISTS idx_evaluations_course ON evaluations(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_attendance_enrollment ON attendance_records(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_grades_enrollment ON grades(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_events_course_date ON academic_events(course_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_schedule_course ON course_schedule(course_id, weekday);
CREATE INDEX IF NOT EXISTS idx_courses_project ON courses(project_id);

-- Lo reflejado en la agenda desaparece con su origen, también en los borrados en cascada.
CREATE TRIGGER IF NOT EXISTS trg_evaluations_delete_mirror AFTER DELETE ON evaluations
WHEN old.calendar_event_id IS NOT NULL BEGIN
    DELETE FROM calendar_events WHERE id = old.calendar_event_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_academic_events_delete_mirror AFTER DELETE ON academic_events
WHEN old.calendar_event_id IS NOT NULL BEGIN
    DELETE FROM calendar_events WHERE id = old.calendar_event_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_schedule_delete_mirror AFTER DELETE ON course_schedule
WHEN old.calendar_event_id IS NOT NULL BEGIN
    DELETE FROM calendar_events WHERE id = old.calendar_event_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_observations_delete_mirror AFTER DELETE ON student_observations
WHEN old.task_id IS NOT NULL BEGIN
    DELETE FROM tasks WHERE id = old.task_id AND status != 'completed';
END;

-- Completar o reabrir en FlowDesk la tarea de seguimiento resuelve o reabre la observación.
CREATE TRIGGER IF NOT EXISTS trg_tasks_resolve_observation AFTER UPDATE OF status ON tasks
WHEN (new.status = 'completed') != (old.status = 'completed') BEGIN
    UPDATE student_observations SET resolved = (new.status = 'completed') WHERE task_id = new.id;
END;
