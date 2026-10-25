-- Aviso de cada evento, en minutos antes del inicio (NULL = sin aviso). En los
-- eventos de todo el día se cuenta desde las 9:00 del primer día.
ALTER TABLE calendar_events ADD COLUMN reminder_minutes INTEGER
    CHECK (reminder_minutes IS NULL OR (reminder_minutes >= 0 AND reminder_minutes <= 10080));

-- Preparado para calendarios externos, sin sincronización todavía: un evento
-- importado llevará su origen y su identificador allí. Los creados en FlowDesk son 'local'.
ALTER TABLE calendar_events ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE calendar_events ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_external
    ON calendar_events(source, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_ends ON calendar_events(ends_at);
CREATE INDEX IF NOT EXISTS idx_calendar_project ON calendar_events(project_id);

-- `reminders` no se usaba todavía: se reconstruye con un aviso por entidad y los
-- estados que necesita el servicio. Las filas se derivan de tareas, notas y
-- eventos; la tabla solo recuerda qué avisos ya se entregaron.
DROP TABLE reminders;
CREATE TABLE reminders (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'note', 'event')),
    entity_id TEXT NOT NULL,
    remind_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'delivered', 'silenced', 'missed', 'cancelled')),
    delivered_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (entity_type, entity_id)
);
CREATE INDEX idx_reminders_due ON reminders(status, remind_at);

-- La relación es polimórfica y no admite claves foráneas: los disparadores
-- mantienen la integridad al borrar la entidad de origen.
CREATE TRIGGER trg_tasks_delete_reminders AFTER DELETE ON tasks BEGIN
    DELETE FROM reminders WHERE entity_type = 'task' AND entity_id = old.id;
END;
CREATE TRIGGER trg_notes_delete_reminders AFTER DELETE ON notes BEGIN
    DELETE FROM reminders WHERE entity_type = 'note' AND entity_id = old.id;
END;
CREATE TRIGGER trg_events_delete_reminders AFTER DELETE ON calendar_events BEGIN
    DELETE FROM reminders WHERE entity_type = 'event' AND entity_id = old.id;
END;

INSERT OR IGNORE INTO settings(key, value) VALUES (
    'reminders',
    '{"enabled":true,"taskLeadMinutes":10,"dailyDigest":true,"digestMinute":540,"quietHours":false,"quietStart":1320,"quietEnd":480}'
);
