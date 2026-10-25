-- Carpetas y aplicaciones que un espacio de trabajo abre. Solo se guardan rutas
-- absolutas validadas al añadirlas; se abren con `open`, nunca con una shell.
CREATE TABLE IF NOT EXISTS workspace_resources (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('folder', 'app')),
    path TEXT NOT NULL CHECK (substr(path, 1, 1) = '/'),
    label TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (workspace_id, path)
);

CREATE INDEX IF NOT EXISTS idx_workspace_resources ON workspace_resources(workspace_id, position);
CREATE INDEX IF NOT EXISTS idx_workspace_projects_project ON workspace_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_workspace_notes_note ON workspace_notes(note_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_archived ON workspaces(is_archived, name);
