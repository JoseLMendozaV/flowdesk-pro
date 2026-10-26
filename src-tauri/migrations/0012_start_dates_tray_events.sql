-- Día desde el que se puede empezar una tarea (mediodía local, como las fechas sin hora).
-- Hasta ese día no aparece en Hoy.
ALTER TABLE tasks ADD COLUMN starts_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_starts ON tasks(starts_at) WHERE starts_at IS NOT NULL;

-- Minutos antes de un evento con hora en que la barra de menús lo anuncia junto al icono
-- («Tutoría en 12 min»); 0 = nunca.
ALTER TABLE tray_preferences ADD COLUMN next_event_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (next_event_minutes >= 0 AND next_event_minutes <= 240);
