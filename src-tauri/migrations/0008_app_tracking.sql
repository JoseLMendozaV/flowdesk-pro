-- Seguimiento automático por aplicación: desactivado hasta que el usuario lo
-- autorice. Solo se guardan el identificador y el nombre de la app, nunca títulos.
CREATE INDEX IF NOT EXISTS idx_app_tracking_bundle ON app_tracking(bundle_id, started_at);

INSERT OR IGNORE INTO settings(key, value) VALUES (
    'app_tracking',
    '{"enabled":false,"paused":false,"idleMinutes":5,"retentionDays":90,"excludedApps":[]}'
);
