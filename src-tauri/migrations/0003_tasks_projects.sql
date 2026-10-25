-- Recuperación de integridad: filas huérfanas creadas por borrados ejecutados
-- fuera de FlowDesk sin `PRAGMA foreign_keys = ON`.
DELETE FROM note_windows WHERE note_id NOT IN (SELECT id FROM notes);
DELETE FROM workspace_notes WHERE note_id NOT IN (SELECT id FROM notes);
DELETE FROM subtasks WHERE task_id NOT IN (SELECT id FROM tasks);
DELETE FROM task_tags
    WHERE task_id NOT IN (SELECT id FROM tasks) OR tag_id NOT IN (SELECT id FROM tags);

-- Fecha límite sin hora concreta ("hoy", "mañana"). Se guarda a mediodía local
-- para que los cambios de horario no la desplacen de día.
ALTER TABLE tasks ADD COLUMN due_has_time INTEGER NOT NULL DEFAULT 1
    CHECK (due_has_time IN (0, 1));
UPDATE tasks SET due_has_time = 0
    WHERE due_at IS NOT NULL
    AND strftime('%H:%M:%S', due_at, 'unixepoch', 'localtime') = '12:00:00';

CREATE TABLE IF NOT EXISTS task_notes (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (task_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_task_notes_note ON task_notes(note_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, position);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(archived_at, status);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
