-- Notas flotantes 2.0: contenido enriquecido versionado, adjuntos, listas de
-- verificación, contextos e historial. Las notas existentes no se convierten aquí:
-- su Markdown sigue en `content` y se guarda una copia recuperable como versión.

-- `content` queda como texto plano para búsquedas y vistas previas; el documento
-- estructurado (ProseMirror/Tiptap) va en `content_json` con su formato.
ALTER TABLE notes ADD COLUMN content_format TEXT NOT NULL DEFAULT 'markdown'
    CHECK (content_format IN ('markdown', 'rich-v1'));
ALTER TABLE notes ADD COLUMN content_json TEXT
    CHECK (content_json IS NULL OR json_valid(content_json));
-- Sube con cada guardado: detecta ediciones simultáneas desde varias ventanas.
ALTER TABLE notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
-- Visible en todos los espacios de trabajo.
ALTER TABLE notes ADD COLUMN pinned_global INTEGER NOT NULL DEFAULT 0 CHECK (pinned_global IN (0, 1));

-- Copias completas: el original de cada nota antigua, instantáneas periódicas y el
-- estado previo a restaurar una versión o a resolver un conflicto.
CREATE TABLE IF NOT EXISTS note_content_versions (
    id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('markdown', 'rich-v1')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_json TEXT CHECK (content_json IS NULL OR json_valid(content_json)),
    reason TEXT NOT NULL CHECK (reason IN ('legacy', 'snapshot', 'before-restore', 'conflict')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_content_versions(note_id, created_at DESC);

-- Registro ligero de cada guardado (sin contenido).
CREATE TABLE IF NOT EXISTS note_revision_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    source TEXT NOT NULL,
    characters INTEGER NOT NULL CHECK (characters >= 0),
    words INTEGER NOT NULL CHECK (words >= 0),
    saved_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_note_history_note ON note_revision_history(note_id, id DESC);

-- Archivos en el directorio de datos (note-attachments/<nota>/); aquí solo la referencia.
-- `deleted_at`: eliminado por el usuario; el archivo pasa a la papelera 30 días.
-- `transcript`: reservado para la transcripción de notas de voz de una fase posterior.
CREATE TABLE IF NOT EXISTS note_attachments (
    id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'file', 'audio')),
    file_name TEXT NOT NULL CHECK (length(trim(file_name)) > 0),
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    transcript TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id, deleted_at);

-- Elementos de las listas de verificación, derivados del documento en cada guardado.
CREATE TABLE IF NOT EXISTS note_checklist_items (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    text TEXT NOT NULL,
    is_checked INTEGER NOT NULL DEFAULT 0 CHECK (is_checked IN (0, 1)),
    PRIMARY KEY (note_id, position)
);

-- Contextos sin tabla propia. Proyecto (`notes.project_id`), tareas (`task_notes`) y
-- espacios (`workspace_notes`) reutilizan sus relaciones existentes.
-- 'document' queda reservado para la biblioteca de conocimiento de una fase posterior.
CREATE TABLE IF NOT EXISTS note_context_links (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('event', 'document')),
    entity_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (note_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_note_context_entity ON note_context_links(entity_type, entity_id);

CREATE TRIGGER IF NOT EXISTS trg_events_delete_note_links AFTER DELETE ON calendar_events BEGIN
    DELETE FROM note_context_links WHERE entity_type = 'event' AND entity_id = old.id;
END;

-- Original recuperable de cada nota existente antes de cualquier conversión.
INSERT INTO note_content_versions(id, note_id, revision, format, title, content, reason, created_at)
SELECT lower(hex(randomblob(16))), id, 0, 'markdown', title, content, 'legacy', updated_at
FROM notes
WHERE length(trim(title)) > 0 OR length(trim(content)) > 0;
