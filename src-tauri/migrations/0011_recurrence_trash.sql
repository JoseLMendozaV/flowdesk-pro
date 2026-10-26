-- Repeticiones. La regla es un JSON que valida Rust (`recurrence.rs`); NULL = no se repite.
ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT;
-- Siguiente repetición creada al completar la tarea: si se reabre enseguida, se deshace.
ALTER TABLE tasks ADD COLUMN recurrence_next_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
-- 1 mientras esa siguiente repetición no se haya tocado. Cualquier cambio de la tarea
-- actualiza `updated_at`, y el disparador la marca como tocada.
ALTER TABLE tasks ADD COLUMN recurrence_pristine INTEGER NOT NULL DEFAULT 0
    CHECK (recurrence_pristine IN (0, 1));
CREATE TRIGGER IF NOT EXISTS trg_tasks_repetition_touched
AFTER UPDATE OF updated_at ON tasks WHEN new.recurrence_pristine = 1 BEGIN
    UPDATE tasks SET recurrence_pristine = 0 WHERE id = new.id;
END;
ALTER TABLE calendar_events ADD COLUMN recurrence_rule TEXT;
-- Inicios originales de las repeticiones borradas o editadas por separado (array JSON).
ALTER TABLE calendar_events ADD COLUMN recurrence_exceptions TEXT NOT NULL DEFAULT '[]';

-- Papelera. Al borrar se guarda una instantánea de la entidad y de lo que dependía
-- de ella, y la fila se elimina de verdad: ninguna consulta tiene que excluir lo borrado.
-- `event_occurrences` guarda repeticiones quitadas de una serie que sigue existiendo.
CREATE TABLE IF NOT EXISTS trash_items (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL
        CHECK (entity_type IN ('task', 'project', 'event', 'event_occurrences')),
    entity_id TEXT NOT NULL,
    title TEXT NOT NULL,
    payload TEXT NOT NULL,
    deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trash_deleted ON trash_items(deleted_at);
