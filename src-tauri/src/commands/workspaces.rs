//! Espacios de trabajo: perfiles que filtran las vistas sin duplicar datos.
//!
//! El espacio activo vive en `settings.selected_workspace_id` y cada consulta lo lee
//! en Rust, así la ventana principal, el panel del tray y las notas coinciden.
//! - Tareas: asignadas al espacio o de uno de sus proyectos.
//! - Proyectos: los vinculados al espacio.
//! - Notas: las del espacio, las de sus proyectos y las que no pertenecen a ninguno.
//! - Eventos: los de sus proyectos y los que no tienen proyecto.
//!
//! Recordatorios y estadísticas de tiempo no se filtran.

use crate::{
    commands::{notes, projects::PROJECT_COLORS},
    database::Database,
    models::{Workspace, WorkspaceInput, WorkspaceResource, WorkspaceState},
};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub const WORKSPACE_ICONS: &[&str] = &[
    "briefcase",
    "flask",
    "code",
    "graduation",
    "book",
    "palette",
    "home",
    "heart",
];
const TASK_VIEWS: &[&str] = &["today", "upcoming", "all"];
const MAX_RESOURCES: i64 = 20;

/// Tareas del espacio `ws` (un marcador de parámetro SQL).
pub fn task_scope(alias: &str, ws: &str) -> String {
    format!(
        "({alias}.workspace_id = {ws} OR {alias}.project_id IN
            (SELECT project_id FROM workspace_projects WHERE workspace_id = {ws}))"
    )
}

pub fn project_scope(alias: &str, ws: &str) -> String {
    format!("{alias}.id IN (SELECT project_id FROM workspace_projects WHERE workspace_id = {ws})")
}

/// Notas visibles con el espacio `ws` activo, o todas si `ws` es NULL. Una nota sin
/// espacio ni proyecto de algún espacio es global y se ve en todos.
pub fn note_scope(alias: &str, ws: &str) -> String {
    format!(
        "({ws} IS NULL
          OR EXISTS (SELECT 1 FROM workspace_notes wn
                     WHERE wn.note_id = {alias}.id AND wn.workspace_id = {ws})
          OR {alias}.project_id IN
             (SELECT project_id FROM workspace_projects WHERE workspace_id = {ws})
          OR (NOT EXISTS (SELECT 1 FROM workspace_notes wn WHERE wn.note_id = {alias}.id)
              AND ({alias}.project_id IS NULL
                   OR {alias}.project_id NOT IN (SELECT project_id FROM workspace_projects))))"
    )
}

/// Solo las notas del espacio `ws` (vinculadas o de sus proyectos), sin las globales.
pub fn note_scope_strict(alias: &str, ws: &str) -> String {
    format!(
        "({ws} IS NULL
          OR EXISTS (SELECT 1 FROM workspace_notes wn
                     WHERE wn.note_id = {alias}.id AND wn.workspace_id = {ws})
          OR {alias}.project_id IN
             (SELECT project_id FROM workspace_projects WHERE workspace_id = {ws}))"
    )
}

pub fn event_scope(alias: &str, ws: &str) -> String {
    format!(
        "({ws} IS NULL OR {alias}.project_id IS NULL OR {alias}.project_id IN
            (SELECT project_id FROM workspace_projects WHERE workspace_id = {ws}))"
    )
}

/// Espacio activo, si existe y no está archivado.
pub fn active_workspace(connection: &Connection) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT w.id FROM settings s JOIN workspaces w ON w.id = s.value
             WHERE s.key = 'selected_workspace_id' AND w.is_archived = 0",
            [],
            |row| row.get(0),
        )
        .optional()
}

pub fn active_workspace_id(database: &Database) -> Result<Option<String>, String> {
    database.with_connection(active_workspace)
}

fn include_global_notes(preferences: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(preferences)
        .ok()
        .and_then(|value| value.get("includeGlobalNotes")?.as_bool())
        .unwrap_or(true)
}

/// Si al activar el espacio se muestran también las notas que no pertenecen a ninguno.
pub fn includes_global_notes(connection: &Connection, id: &str) -> rusqlite::Result<bool> {
    let preferences: Option<String> = connection
        .query_row(
            "SELECT view_preferences FROM workspaces WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(preferences.as_deref().is_none_or(include_global_notes))
}

fn task_view(preferences: &str) -> String {
    serde_json::from_str::<serde_json::Value>(preferences)
        .ok()
        .and_then(|value| value.get("taskView")?.as_str().map(str::to_string))
        .filter(|view| TASK_VIEWS.contains(&view.as_str()))
        .unwrap_or_else(|| "today".to_string())
}

fn load_workspace(connection: &Connection, id: &str) -> rusqlite::Result<Option<Workspace>> {
    let Some(mut workspace) = connection
        .query_row(
            &format!(
                "SELECT w.id, w.name, w.color, w.icon, w.view_preferences, w.is_archived,
                    (SELECT COUNT(*) FROM tasks t
                     WHERE t.status IN ('pending', 'in_progress') AND {})
                 FROM workspaces w WHERE w.id = ?1",
                task_scope("t", "w.id")
            ),
            [id],
            |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    icon: row.get(3)?,
                    task_view: task_view(&row.get::<_, String>(4)?),
                    include_global_notes: include_global_notes(&row.get::<_, String>(4)?),
                    is_archived: row.get(5)?,
                    project_ids: Vec::new(),
                    note_ids: Vec::new(),
                    resources: Vec::new(),
                    open_task_count: row.get(6)?,
                })
            },
        )
        .optional()?
    else {
        return Ok(None);
    };
    workspace.project_ids = connection
        .prepare(
            "SELECT wp.project_id FROM workspace_projects wp JOIN projects p ON p.id = wp.project_id
             WHERE wp.workspace_id = ?1 ORDER BY p.name COLLATE NOCASE",
        )?
        .query_map([id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    workspace.note_ids = connection
        .prepare("SELECT note_id FROM workspace_notes WHERE workspace_id = ?1")?
        .query_map([id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    workspace.resources = connection
        .prepare(
            "SELECT id, kind, path, label FROM workspace_resources
             WHERE workspace_id = ?1 ORDER BY position, created_at",
        )?
        .query_map([id], |row| {
            let path: String = row.get(2)?;
            Ok(WorkspaceResource {
                id: row.get(0)?,
                kind: row.get(1)?,
                exists: Path::new(&path).exists(),
                path,
                label: row.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(Some(workspace))
}

fn require_workspace(database: &Database, id: &str) -> Result<Workspace, String> {
    Uuid::parse_str(id).map_err(|_| "Identificador de espacio no válido".to_string())?;
    database
        .with_connection(|connection| load_workspace(connection, id))?
        .ok_or_else(|| "El espacio de trabajo no existe".to_string())
}

pub fn query_state(database: &Database) -> Result<WorkspaceState, String> {
    let (active_id, ids) = database.with_connection(|connection| {
        let ids = connection
            .prepare("SELECT id FROM workspaces ORDER BY is_archived, name COLLATE NOCASE")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok((active_workspace(connection)?, ids))
    })?;
    let workspaces = ids
        .iter()
        .map(|id| require_workspace(database, id))
        .collect::<Result<_, _>>()?;
    Ok(WorkspaceState {
        active_id,
        workspaces,
    })
}

fn validate(input: &WorkspaceInput) -> Result<(String, String), String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("El nombre del espacio no puede estar vacío".to_string());
    }
    if name.chars().count() > 60 {
        return Err("El nombre no puede superar 60 caracteres".to_string());
    }
    if !PROJECT_COLORS.contains(&input.color.as_str()) {
        return Err("Color no válido".to_string());
    }
    if !WORKSPACE_ICONS.contains(&input.icon.as_str()) {
        return Err("Icono no válido".to_string());
    }
    if !TASK_VIEWS.contains(&input.task_view.as_str()) {
        return Err("Vista de tareas no válida".to_string());
    }
    let preferences = serde_json::json!({
        "taskView": input.task_view,
        "includeGlobalNotes": input.include_global_notes.unwrap_or(true),
    })
    .to_string();
    Ok((name.to_string(), preferences))
}

pub fn insert_workspace(database: &Database, input: WorkspaceInput) -> Result<Workspace, String> {
    let (name, preferences) = validate(&input)?;
    let id = Uuid::new_v4().to_string();
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO workspaces(id, name, color, icon, view_preferences)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, input.color, input.icon, preferences],
        )?;
        Ok(())
    })?;
    require_workspace(database, &id)
}

pub fn modify_workspace(
    database: &Database,
    id: &str,
    input: WorkspaceInput,
) -> Result<Workspace, String> {
    require_workspace(database, id)?;
    let (name, preferences) = validate(&input)?;
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE workspaces SET name = ?1, color = ?2, icon = ?3, view_preferences = ?4,
                updated_at = unixepoch()
             WHERE id = ?5",
            params![name, input.color, input.icon, preferences, id],
        )?;
        Ok(())
    })?;
    require_workspace(database, id)
}

pub fn set_archived(database: &Database, id: &str, archived: bool) -> Result<Workspace, String> {
    require_workspace(database, id)?;
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE workspaces SET is_archived = ?1, updated_at = unixepoch() WHERE id = ?2",
            params![archived, id],
        )?;
        Ok(())
    })?;
    require_workspace(database, id)
}

/// Borra el espacio y sus vínculos. Tareas, proyectos, notas y registros se conservan.
pub fn remove_workspace(database: &Database, id: &str) -> Result<(), String> {
    require_workspace(database, id)?;
    database.with_connection(|connection| {
        connection.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
        Ok(())
    })
}

/// Sustituye un conjunto de vínculos (`workspace_projects` o `workspace_notes`).
fn replace_links(
    database: &Database,
    id: &str,
    ids: &[String],
    table: &str,
    column: &str,
    parent: &str,
) -> Result<Workspace, String> {
    require_workspace(database, id)?;
    for linked in ids {
        Uuid::parse_str(linked).map_err(|_| "Identificador no válido".to_string())?;
    }
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        transaction.execute(
            &format!("DELETE FROM {table} WHERE workspace_id = ?1"),
            [id],
        )?;
        for linked in ids {
            // Los identificadores inexistentes se ignoran en lugar de violar la clave foránea.
            transaction.execute(
                &format!(
                    "INSERT OR IGNORE INTO {table}(workspace_id, {column})
                     SELECT ?1, id FROM {parent} WHERE id = ?2"
                ),
                params![id, linked],
            )?;
        }
        transaction.commit()
    })?;
    require_workspace(database, id)
}

pub fn set_projects(database: &Database, id: &str, ids: &[String]) -> Result<Workspace, String> {
    replace_links(
        database,
        id,
        ids,
        "workspace_projects",
        "project_id",
        "projects",
    )
}

pub fn set_notes(database: &Database, id: &str, ids: &[String]) -> Result<Workspace, String> {
    replace_links(database, id, ids, "workspace_notes", "note_id", "notes")
}

pub fn insert_resource(
    database: &Database,
    id: &str,
    kind: &str,
    path: &str,
) -> Result<Workspace, String> {
    require_workspace(database, id)?;
    let target = Path::new(path);
    if !target.is_absolute() || path.chars().count() > 1_024 {
        return Err("La ruta debe ser absoluta".to_string());
    }
    // Sin `..`: la ruta guardada es la que se valida y la que se abrirá.
    if target
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("Ruta no válida".to_string());
    }
    match kind {
        "folder" if target.is_dir() => {}
        "app"
            if target.is_dir()
                && target
                    .extension()
                    .is_some_and(|extension| extension == "app") => {}
        "folder" => return Err("La carpeta no existe".to_string()),
        "app" => return Err("Selecciona una aplicación (.app)".to_string()),
        _ => return Err("Tipo de recurso no válido".to_string()),
    }
    let label = target
        .file_stem()
        .or_else(|| target.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    let count: i64 = database.with_connection(|connection| {
        connection.query_row(
            "SELECT COUNT(*) FROM workspace_resources WHERE workspace_id = ?1",
            [id],
            |row| row.get(0),
        )
    })?;
    if count >= MAX_RESOURCES {
        return Err("Un espacio admite como máximo 20 carpetas y aplicaciones".to_string());
    }
    database.with_connection(|connection| {
        connection.execute(
            "INSERT OR IGNORE INTO workspace_resources(id, workspace_id, kind, path, label, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![Uuid::new_v4().to_string(), id, kind, path, label, count],
        )?;
        Ok(())
    })?;
    require_workspace(database, id)
}

pub fn remove_resource(database: &Database, resource_id: &str) -> Result<(), String> {
    Uuid::parse_str(resource_id).map_err(|_| "Identificador no válido".to_string())?;
    database.with_connection(|connection| {
        connection.execute(
            "DELETE FROM workspace_resources WHERE id = ?1",
            [resource_id],
        )?;
        Ok(())
    })
}

fn open_path(path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err(format!("{path} ya no existe"));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg("--")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Abrir recursos solo está disponible en macOS".to_string())
    }
}

pub fn store_active(database: &Database, id: Option<&str>) -> Result<(), String> {
    if let Some(id) = id
        && require_workspace(database, id)?.is_archived
    {
        return Err("El espacio está archivado".to_string());
    }
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO settings(key, value, updated_at)
             VALUES ('selected_workspace_id', ?1, unixepoch())
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            [id.unwrap_or("")],
        )?;
        Ok(())
    })
}

/// Avisa a todas las vistas filtradas por espacio.
fn announce(app: &AppHandle) {
    for kind in ["workspaces", "tasks", "projects", "notes", "calendar"] {
        let _ = app.emit("flowdesk://data-changed", kind);
    }
}

#[tauri::command]
pub fn get_workspaces(database: State<'_, Database>) -> Result<WorkspaceState, String> {
    query_state(&database)
}

#[tauri::command]
pub fn set_active_workspace(
    workspace_id: Option<String>,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<WorkspaceState, String> {
    store_active(&database, workspace_id.as_deref())?;
    notes::apply_workspace_windows(&app, &database);
    announce(&app);
    query_state(&database)
}

#[tauri::command]
pub fn create_workspace(
    input: WorkspaceInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Workspace, String> {
    let workspace = insert_workspace(&database, input)?;
    let _ = app.emit("flowdesk://data-changed", "workspaces");
    Ok(workspace)
}

#[tauri::command]
pub fn update_workspace(
    workspace_id: String,
    input: WorkspaceInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Workspace, String> {
    let workspace = modify_workspace(&database, &workspace_id, input)?;
    let _ = app.emit("flowdesk://data-changed", "workspaces");
    Ok(workspace)
}

#[tauri::command]
pub fn archive_workspace(
    workspace_id: String,
    archived: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Workspace, String> {
    let workspace = set_archived(&database, &workspace_id, archived)?;
    notes::apply_workspace_windows(&app, &database);
    announce(&app);
    Ok(workspace)
}

#[tauri::command]
pub fn delete_workspace(
    workspace_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    remove_workspace(&database, &workspace_id)?;
    notes::apply_workspace_windows(&app, &database);
    announce(&app);
    Ok(())
}

#[tauri::command]
pub fn set_workspace_projects(
    workspace_id: String,
    project_ids: Vec<String>,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Workspace, String> {
    let workspace = set_projects(&database, &workspace_id, &project_ids)?;
    notes::apply_workspace_windows(&app, &database);
    announce(&app);
    Ok(workspace)
}

#[tauri::command]
pub fn set_workspace_notes(
    workspace_id: String,
    note_ids: Vec<String>,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Workspace, String> {
    let workspace = set_notes(&database, &workspace_id, &note_ids)?;
    notes::apply_workspace_windows(&app, &database);
    announce(&app);
    Ok(workspace)
}

#[tauri::command]
pub fn add_workspace_resource(
    workspace_id: String,
    kind: String,
    path: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Workspace, String> {
    let workspace = insert_resource(&database, &workspace_id, &kind, &path)?;
    let _ = app.emit("flowdesk://data-changed", "workspaces");
    Ok(workspace)
}

#[tauri::command]
pub fn remove_workspace_resource(
    resource_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    remove_resource(&database, &resource_id)?;
    let _ = app.emit("flowdesk://data-changed", "workspaces");
    Ok(())
}

/// Abre un recurso, o todos los del espacio si no se indica ninguno.
#[tauri::command]
pub fn open_workspace_resources(
    workspace_id: String,
    resource_id: Option<String>,
    database: State<'_, Database>,
) -> Result<(), String> {
    let workspace = require_workspace(&database, &workspace_id)?;
    let targets: Vec<_> = workspace
        .resources
        .iter()
        .filter(|resource| resource_id.as_deref().is_none_or(|id| resource.id == id))
        .collect();
    if targets.is_empty() {
        return Err("No hay recursos que abrir".to_string());
    }
    let errors: Vec<_> = targets
        .iter()
        .filter_map(|resource| open_path(&resource.path).err())
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" · "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        commands::{
            calendar::{insert_event, query_range},
            dashboard::load_dashboard,
            projects::{insert_project, query_projects},
            tasks::{insert_task, query_tasks},
        },
        models::{EventInput, ProjectInput, TaskFilter, TaskInput, TaskView},
    };

    fn input(name: &str) -> WorkspaceInput {
        WorkspaceInput {
            name: name.to_string(),
            color: PROJECT_COLORS[1].to_string(),
            icon: "flask".to_string(),
            task_view: "all".to_string(),
            include_global_notes: None,
        }
    }

    fn project(database: &Database, name: &str) -> String {
        insert_project(
            database,
            ProjectInput {
                name: name.to_string(),
                color: PROJECT_COLORS[0].to_string(),
                status: "active".to_string(),
                ..ProjectInput::default()
            },
        )
        .expect("project")
        .id
    }

    fn task(database: &Database, title: &str, project_id: Option<&str>) -> String {
        insert_task(
            database,
            TaskInput {
                title: title.to_string(),
                project_id: project_id.map(str::to_string),
                ..TaskInput::default()
            },
        )
        .expect("task")
        .summary
        .id
    }

    fn visible_tasks(database: &Database) -> Vec<String> {
        let mut titles: Vec<_> = query_tasks(
            database,
            TaskFilter {
                view: TaskView::All,
                ..TaskFilter::default()
            },
        )
        .expect("tasks")
        .into_iter()
        .map(|task| task.title)
        .collect();
        titles.sort();
        titles
    }

    #[test]
    fn validates_and_updates_workspaces() {
        let database = Database::in_memory();
        assert!(insert_workspace(&database, input(" ")).is_err());
        let bad_icon = WorkspaceInput {
            icon: "rocket".to_string(),
            ..input("Investigación")
        };
        assert!(insert_workspace(&database, bad_icon).is_err());
        let workspace = insert_workspace(&database, input("Investigación")).expect("workspace");
        assert_eq!(workspace.task_view, "all");
        let renamed = modify_workspace(
            &database,
            &workspace.id,
            WorkspaceInput {
                task_view: "today".to_string(),
                ..input("Ciencia")
            },
        )
        .expect("update");
        assert_eq!(renamed.name, "Ciencia");
        assert_eq!(renamed.task_view, "today");
    }

    #[test]
    fn active_workspace_scopes_tasks_projects_and_events() {
        let database = Database::in_memory();
        let research = project(&database, "Tesis");
        let teaching = project(&database, "Curso");
        task(&database, "Leer artículos", Some(&research));
        task(&database, "Corregir", Some(&teaching));
        task(&database, "Comprar café", None);
        let workspace = insert_workspace(&database, input("Investigación")).expect("workspace");
        set_projects(&database, &workspace.id, std::slice::from_ref(&research)).expect("link");
        insert_event(
            &database,
            EventInput {
                title: "Clase".to_string(),
                project_id: Some(teaching.clone()),
                starts_at: 1_000,
                ends_at: 2_000,
                ..EventInput::default()
            },
        )
        .expect("event");
        insert_event(
            &database,
            EventInput {
                title: "Médico".to_string(),
                starts_at: 1_000,
                ends_at: 2_000,
                ..EventInput::default()
            },
        )
        .expect("event");

        assert_eq!(visible_tasks(&database).len(), 3);
        store_active(&database, Some(&workspace.id)).expect("activate");
        assert_eq!(visible_tasks(&database), ["Leer artículos"]);
        // Una tarea creada con el espacio activo queda asignada a él.
        task(&database, "Escribir resumen", None);
        assert_eq!(
            visible_tasks(&database),
            ["Escribir resumen", "Leer artículos"]
        );
        // Un proyecto nuevo se vincula al espacio activo.
        project(&database, "Artículo");
        let names: Vec<_> = query_projects(&database, false, false)
            .expect("projects")
            .into_iter()
            .map(|project| project.name)
            .collect();
        assert_eq!(names, ["Artículo", "Tesis"]);
        assert_eq!(
            query_projects(&database, false, true).expect("all").len(),
            3
        );
        let events: Vec<_> = query_range(&database, 0, 3_000)
            .expect("range")
            .events
            .into_iter()
            .map(|event| event.title)
            .collect();
        assert_eq!(events, ["Médico"]);
        assert_eq!(
            load_dashboard(&database)
                .expect("dashboard")
                .active_projects,
            2
        );
        assert_eq!(
            query_state(&database).expect("state").workspaces[0].open_task_count,
            2
        );

        // Archivar el espacio activo vuelve a mostrar todo.
        set_archived(&database, &workspace.id, true).expect("archive");
        assert_eq!(visible_tasks(&database).len(), 4);
        assert!(store_active(&database, Some(&workspace.id)).is_err());
    }

    #[test]
    fn notes_follow_workspace_or_stay_global() {
        let database = Database::in_memory();
        let research = project(&database, "Tesis");
        let workspace = insert_workspace(&database, input("Investigación")).expect("workspace");
        let other = insert_workspace(&database, input("Docencia")).expect("other");
        set_projects(&database, &workspace.id, std::slice::from_ref(&research)).expect("link");
        database
            .with_connection(|connection| {
                connection.execute_batch(&format!(
                    "INSERT INTO notes(id, title) VALUES
                        ('00000000-0000-4000-8000-000000000001', 'Global'),
                        ('00000000-0000-4000-8000-000000000002', 'De Docencia'),
                        ('00000000-0000-4000-8000-000000000003', 'De la tesis');
                     UPDATE notes SET project_id = '{research}'
                        WHERE id = '00000000-0000-4000-8000-000000000003';"
                ))
            })
            .expect("notes");
        set_notes(
            &database,
            &other.id,
            &["00000000-0000-4000-8000-000000000002".to_string()],
        )
        .expect("note link");
        let visible = |active: Option<&str>| -> Vec<String> {
            database
                .with_connection(|connection| {
                    connection
                        .prepare(&format!(
                            "SELECT n.title FROM notes n WHERE {} ORDER BY n.title",
                            note_scope("n", "?1")
                        ))?
                        .query_map([active], |row| row.get(0))?
                        .collect()
                })
                .expect("notes")
        };
        assert_eq!(visible(None).len(), 3);
        assert_eq!(visible(Some(&workspace.id)), ["De la tesis", "Global"]);
        assert_eq!(visible(Some(&other.id)), ["De Docencia", "Global"]);
    }

    #[test]
    fn deleting_workspace_keeps_data() {
        let database = Database::in_memory();
        let research = project(&database, "Tesis");
        let workspace = insert_workspace(&database, input("Investigación")).expect("workspace");
        set_projects(&database, &workspace.id, std::slice::from_ref(&research)).expect("link");
        store_active(&database, Some(&workspace.id)).expect("activate");
        task(&database, "Asignada", None);
        remove_workspace(&database, &workspace.id).expect("delete");
        assert_eq!(active_workspace_id(&database).expect("active"), None);
        assert_eq!(visible_tasks(&database), ["Asignada"]);
        assert_eq!(
            query_projects(&database, false, true)
                .expect("projects")
                .len(),
            1
        );
    }

    #[test]
    fn validates_resources() {
        let database = Database::in_memory();
        let workspace = insert_workspace(&database, input("Programación")).expect("workspace");
        let folder = std::env::temp_dir();
        let folder = folder.to_string_lossy();
        assert!(insert_resource(&database, &workspace.id, "folder", "relativa").is_err());
        assert!(
            insert_resource(&database, &workspace.id, "folder", "/no/existe/flowdesk").is_err()
        );
        assert!(insert_resource(&database, &workspace.id, "app", &folder).is_err());
        assert!(insert_resource(&database, &workspace.id, "folder", "/tmp/../etc").is_err());
        let updated = insert_resource(&database, &workspace.id, "folder", &folder).expect("folder");
        assert_eq!(updated.resources.len(), 1);
        assert!(updated.resources[0].exists);
        // La misma ruta no se duplica.
        let again = insert_resource(&database, &workspace.id, "folder", &folder).expect("again");
        assert_eq!(again.resources.len(), 1);
        remove_resource(&database, &again.resources[0].id).expect("remove");
        assert!(
            require_workspace(&database, &workspace.id)
                .expect("ws")
                .resources
                .is_empty()
        );
    }
}
