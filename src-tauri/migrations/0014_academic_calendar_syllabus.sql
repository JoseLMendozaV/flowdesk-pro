-- Calendario académico y plan del curso (Docencia).

-- Feriados, días libres, semanas de exámenes, periodos de clases y fechas límite. Lo que
-- `cancels_classes` quita las clases del horario (excepciones en el calendario) y las
-- sesiones de asistencia de esos días. `source`: feriados nacionales de Panamá, calendario
-- de la UTP o añadido a mano. Los que no son periodos aparecen en el calendario de FlowDesk
-- como eventos de todo el día (`calendar_event_id`).
CREATE TABLE IF NOT EXISTS academic_calendar (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('holiday', 'break', 'exams', 'term', 'deadline')),
    starts_on TEXT NOT NULL,
    ends_on TEXT NOT NULL,
    cancels_classes INTEGER NOT NULL DEFAULT 1 CHECK (cancels_classes IN (0, 1)),
    source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('panama', 'utp', 'user')),
    calendar_event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ends_on >= starts_on),
    UNIQUE (source, starts_on, title)
);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_dates ON academic_calendar(starts_on, ends_on);

CREATE TRIGGER IF NOT EXISTS trg_academic_calendar_delete_mirror
AFTER DELETE ON academic_calendar
WHEN old.calendar_event_id IS NOT NULL
BEGIN
    DELETE FROM calendar_events WHERE id = old.calendar_event_id;
END;

-- Repeticiones que el calendario académico quitó de la franja (instantes de inicio). Se
-- guardan aparte de las que el usuario quitó a mano para poder devolverlas si el día deja
-- de ser libre.
ALTER TABLE course_schedule ADD COLUMN skipped_occurrences TEXT NOT NULL DEFAULT '[]';

-- Plan del curso: temas en orden, con semana prevista o sesión de asistencia y una nota
-- flotante para preparar la clase.
CREATE TABLE IF NOT EXISTS course_topics (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    week INTEGER CHECK (week IS NULL OR week BETWEEN 1 AND 60),
    details TEXT NOT NULL DEFAULT '',
    session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
    done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_course_topics_course ON course_topics(course_id, position);
CREATE INDEX IF NOT EXISTS idx_course_topics_session ON course_topics(session_id);

-- Dar la clase (pasar asistencia) cumple los temas de esa sesión.
CREATE TRIGGER IF NOT EXISTS trg_sessions_held_topics
AFTER UPDATE OF is_held ON class_sessions
WHEN new.is_held = 1 AND old.is_held = 0
BEGIN
    UPDATE course_topics SET done = 1 WHERE session_id = new.id;
END;
