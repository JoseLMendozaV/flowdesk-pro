ALTER TABLE note_windows ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1
    CHECK (is_visible IN (0, 1));
ALTER TABLE note_windows ADD COLUMN expanded_height REAL NOT NULL DEFAULT 280
    CHECK (expanded_height >= 120);

CREATE INDEX IF NOT EXISTS idx_note_windows_visible
    ON note_windows(is_visible, updated_at DESC);
