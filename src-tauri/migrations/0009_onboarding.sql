-- Bienvenida, recorrido y novedades. Una sola fila con las preferencias y lo que el
-- usuario ya conoce; las funcionalidades se identifican por el id estable del registro
-- del frontend (src/features/onboarding/registry) y su revisión de contenido.
CREATE TABLE IF NOT EXISTS onboarding_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    welcome_status TEXT NOT NULL DEFAULT 'pending' CHECK (welcome_status IN ('pending', 'completed', 'skipped')),
    show_welcome_on_startup INTEGER NOT NULL DEFAULT 1 CHECK (show_welcome_on_startup IN (0, 1)),
    show_whats_new_on_update INTEGER NOT NULL DEFAULT 1 CHECK (show_whats_new_on_update IN (0, 1)),
    resume_tour INTEGER NOT NULL DEFAULT 1 CHECK (resume_tour IN (0, 1)),
    last_seen_app_version TEXT,
    last_seen_feature_revision TEXT,
    seen_features TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(seen_features)),
    last_completed_step_id TEXT,
    last_onboarding_at INTEGER,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Historial breve de lo que se mostró y cómo terminó. Se conservan las últimas 200 filas.
CREATE TABLE IF NOT EXISTS onboarding_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL CHECK (event IN (
        'welcome_completed', 'welcome_skipped', 'whats_new_shown',
        'guided_tour_started', 'guided_tour_completed', 'reset'
    )),
    detail TEXT,
    app_version TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO onboarding_state(id) VALUES (1);
