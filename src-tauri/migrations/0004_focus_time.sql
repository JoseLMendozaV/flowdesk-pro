-- Marca temporal de la última reanudación: permite mostrar la hora de fin prevista.
ALTER TABLE pomodoro_sessions ADD COLUMN resumed_at INTEGER;

ALTER TABLE time_entries ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE time_entries ADD COLUMN resumed_at INTEGER;
ALTER TABLE time_entries ADD COLUMN pomodoro_session_id TEXT
    REFERENCES pomodoro_sessions(id) ON DELETE SET NULL;

-- Como máximo un Pomodoro y un cronómetro manual activos. La expresión vale 1 en
-- todas las filas filtradas, así que el índice único admite una sola.
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_pomodoro
    ON pomodoro_sessions(status IN ('running', 'paused'))
    WHERE status IN ('running', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_manual_entry
    ON time_entries(status IN ('running', 'paused'))
    WHERE source = 'manual' AND status IN ('running', 'paused');

CREATE INDEX IF NOT EXISTS idx_pomodoro_started ON pomodoro_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);

INSERT OR IGNORE INTO settings(key, value) VALUES (
    'pomodoro',
    '{"focusMinutes":25,"shortBreakMinutes":5,"longBreakMinutes":15,"longBreakEvery":4,"autoStartBreaks":false,"autoStartFocus":false,"notifications":true}'
);
