-- Historial del portapapeles: desactivado hasta que el usuario lo autorice.
ALTER TABLE clipboard_items ADD COLUMN source_bundle_id TEXT;
ALTER TABLE clipboard_items ADD COLUMN byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0);

CREATE INDEX IF NOT EXISTS idx_clipboard_favorite ON clipboard_items(is_favorite, created_at DESC);

INSERT OR IGNORE INTO settings(key, value) VALUES (
    'clipboard',
    '{"enabled":false,"paused":false,"maxItems":200,"captureImages":true,"skipSensitive":true,"excludedApps":[{"bundleId":"com.apple.keychainaccess","name":"Acceso a Llaveros"},{"bundleId":"com.apple.Passwords","name":"Contraseñas"},{"bundleId":"com.1password.1password","name":"1Password"},{"bundleId":"com.agilebits.onepassword7","name":"1Password 7"},{"bundleId":"com.bitwarden.desktop","name":"Bitwarden"},{"bundleId":"com.lastpass.LastPass","name":"LastPass"}]}'
);
