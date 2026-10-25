use crate::{
    commands::{
        dashboard::today_bounds,
        tasks::prune_unused_tags,
        workspaces::{active_workspace, active_workspace_id, project_scope},
    },
    database::Database,
    models::{ProjectDeleteMode, ProjectInput, ProjectSummary},
};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub const PROJECT_COLORS: &[&str] = &[
    "#6C8CFF", "#8B6CF0", "#2FB67C", "#E8A33D", "#E5636F", "#3BA7C4", "#D46BB3", "#8B8FA3",
];
const PROJECT_STATUSES: &[&str] = &["active", "paused", "completed"];

/// `?1` es el inicio del día local, usado para contar tareas vencidas.
const PROJECT_SELECT: &str = "SELECT p.id, p.name, p.description, p.color, p.status,
            p.starts_at, p.target_at, p.created_at, p.updated_at, p.archived_at,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'cancelled'),
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed'),
            (SELECT COUNT(*) FROM tasks t
             WHERE t.project_id = p.id AND t.status IN ('pending', 'in_progress')),
            (SELECT COUNT(*) FROM tasks t
             WHERE t.project_id = p.id AND t.status IN ('pending', 'in_progress')
             AND t.due_at < ?1),
            (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id),
            (SELECT COALESCE(SUM(e.duration_seconds), 0) FROM time_entries e
             WHERE e.project_id = p.id)
     FROM projects p";

struct ValidProject {
    name: String,
    description: String,
    color: String,
    status: String,
    starts_at: Option<i64>,
    target_at: Option<i64>,
}

fn map_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectSummary> {
    let task_count: i64 = row.get(10)?;
    let completed_task_count: i64 = row.get(11)?;
    Ok(ProjectSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        color: row.get(3)?,
        status: row.get(4)?,
        starts_at: row.get(5)?,
        target_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        archived_at: row.get(9)?,
        task_count,
        completed_task_count,
        open_task_count: row.get(12)?,
        overdue_task_count: row.get(13)?,
        note_count: row.get(14)?,
        tracked_seconds: row.get(15)?,
        progress_percent: if task_count == 0 {
            0.0
        } else {
            completed_task_count as f64 / task_count as f64 * 100.0
        },
    })
}

fn query_project(
    connection: &Connection,
    project_id: &str,
    today_start: i64,
) -> rusqlite::Result<Option<ProjectSummary>> {
    connection
        .query_row(
            &format!("{PROJECT_SELECT} WHERE p.id = ?2"),
            params![today_start, project_id],
            map_project,
        )
        .optional()
}

fn load_project(database: &Database, project_id: &str) -> Result<ProjectSummary, String> {
    Uuid::parse_str(project_id).map_err(|_| "Identificador de proyecto no válido".to_string())?;
    let (today_start, _) = today_bounds()?;
    database
        .with_connection(|connection| query_project(connection, project_id, today_start))?
        .ok_or_else(|| "El proyecto no existe".to_string())
}

fn validate_project(input: ProjectInput) -> Result<ValidProject, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("El nombre del proyecto no puede estar vacío".to_string());
    }
    if name.chars().count() > 80 {
        return Err("El nombre no puede superar 80 caracteres".to_string());
    }
    if input.description.chars().count() > 2_000 {
        return Err("La descripción no puede superar 2 000 caracteres".to_string());
    }
    if !PROJECT_COLORS.contains(&input.color.as_str()) {
        return Err("Color de proyecto no válido".to_string());
    }
    if !PROJECT_STATUSES.contains(&input.status.as_str()) {
        return Err("Estado de proyecto no válido".to_string());
    }
    if let (Some(starts_at), Some(target_at)) = (input.starts_at, input.target_at)
        && target_at < starts_at
    {
        return Err("La fecha objetivo no puede ser anterior a la de inicio".to_string());
    }
    Ok(ValidProject {
        name: name.to_string(),
        description: input.description.trim().to_string(),
        color: input.color,
        status: input.status,
        starts_at: input.starts_at,
        target_at: input.target_at,
    })
}

/// Proyectos del espacio activo, o todos con `all_workspaces` (para vincularlos a un espacio).
pub fn query_projects(
    database: &Database,
    include_archived: bool,
    all_workspaces: bool,
) -> Result<Vec<ProjectSummary>, String> {
    let (today_start, _) = today_bounds()?;
    let workspace_id = if all_workspaces {
        None
    } else {
        active_workspace_id(database)?
    };
    let archived = if include_archived {
        "1"
    } else {
        "p.archived_at IS NULL"
    };
    database.with_connection(|connection| {
        connection
            .prepare(&format!(
                "{PROJECT_SELECT} WHERE {archived} AND (?2 IS NULL OR {})
                 ORDER BY p.archived_at IS NOT NULL,
                          CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                          p.name COLLATE NOCASE",
                project_scope("p", "?2")
            ))?
            .query_map(params![today_start, workspace_id], map_project)?
            .collect()
    })
}

pub fn insert_project(database: &Database, input: ProjectInput) -> Result<ProjectSummary, String> {
    let project = validate_project(input)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO projects(id, name, description, color, status, starts_at, target_at,
                created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                id,
                project.name,
                project.description,
                project.color,
                project.status,
                project.starts_at,
                project.target_at,
                now
            ],
        )?;
        // Un proyecto creado con un espacio activo se vincula a él.
        transaction.execute(
            "INSERT INTO workspace_projects(workspace_id, project_id)
             SELECT ?1, ?2 WHERE ?1 IS NOT NULL",
            params![active_workspace(&transaction)?, id],
        )?;
        transaction.commit()
    })?;
    load_project(database, &id)
}

pub fn modify_project(
    database: &Database,
    project_id: &str,
    input: ProjectInput,
) -> Result<ProjectSummary, String> {
    load_project(database, project_id)?;
    let project = validate_project(input)?;
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE projects SET name = ?1, description = ?2, color = ?3, status = ?4,
                starts_at = ?5, target_at = ?6, updated_at = ?7
             WHERE id = ?8",
            params![
                project.name,
                project.description,
                project.color,
                project.status,
                project.starts_at,
                project.target_at,
                Utc::now().timestamp(),
                project_id
            ],
        )?;
        Ok(())
    })?;
    load_project(database, project_id)
}

pub fn set_archived(
    database: &Database,
    project_id: &str,
    archived: bool,
) -> Result<ProjectSummary, String> {
    load_project(database, project_id)?;
    let now = Utc::now().timestamp();
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE projects SET archived_at = CASE WHEN ?1 THEN COALESCE(archived_at, ?2)
                                                   ELSE NULL END,
                updated_at = ?2
             WHERE id = ?3",
            params![archived, now, project_id],
        )?;
        Ok(())
    })?;
    load_project(database, project_id)
}

/// Elimina un proyecto. Las notas, sesiones y registros de tiempo nunca se borran:
/// las claves foráneas `SET NULL` los conservan sin proyecto.
pub fn remove_project(
    database: &Database,
    project_id: &str,
    mode: ProjectDeleteMode,
) -> Result<(), String> {
    load_project(database, project_id)?;
    database.with_connection_mut(|connection| {
        let transaction = connection.transaction()?;
        if mode == ProjectDeleteMode::DeleteTasks {
            transaction.execute("DELETE FROM tasks WHERE project_id = ?1", [project_id])?;
            prune_unused_tags(&transaction)?;
        }
        transaction.execute("DELETE FROM projects WHERE id = ?1", [project_id])?;
        transaction.commit()
    })
}

fn notify(app: &AppHandle) {
    let _ = app.emit("flowdesk://data-changed", "projects");
}

#[tauri::command]
pub fn list_projects(
    include_archived: bool,
    all_workspaces: Option<bool>,
    database: State<'_, Database>,
) -> Result<Vec<ProjectSummary>, String> {
    query_projects(&database, include_archived, all_workspaces.unwrap_or(false))
}

#[tauri::command]
pub fn get_project(
    project_id: String,
    database: State<'_, Database>,
) -> Result<ProjectSummary, String> {
    load_project(&database, &project_id)
}

#[tauri::command]
pub fn create_project(
    input: ProjectInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<ProjectSummary, String> {
    let project = insert_project(&database, input)?;
    notify(&app);
    Ok(project)
}

#[tauri::command]
pub fn update_project(
    project_id: String,
    input: ProjectInput,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<ProjectSummary, String> {
    let project = modify_project(&database, &project_id, input)?;
    notify(&app);
    Ok(project)
}

#[tauri::command]
pub fn archive_project(
    project_id: String,
    archived: bool,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<ProjectSummary, String> {
    let project = set_archived(&database, &project_id, archived)?;
    notify(&app);
    Ok(project)
}

#[tauri::command]
pub fn delete_project(
    project_id: String,
    mode: ProjectDeleteMode,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    remove_project(&database, &project_id, mode)?;
    notify(&app);
    let _ = app.emit("flowdesk://data-changed", "tasks");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        commands::{
            dashboard::load_dashboard,
            tasks::{change_status, insert_task},
        },
        models::TaskInput,
    };

    fn project_input(name: &str) -> ProjectInput {
        ProjectInput {
            name: name.to_string(),
            color: PROJECT_COLORS[0].to_string(),
            status: "active".to_string(),
            ..ProjectInput::default()
        }
    }

    fn task_in(database: &Database, project_id: &str, title: &str) -> String {
        insert_task(
            database,
            TaskInput {
                title: title.to_string(),
                project_id: Some(project_id.to_string()),
                ..TaskInput::default()
            },
        )
        .expect("task")
        .summary
        .id
    }

    fn count(database: &Database, sql: &str) -> i64 {
        database
            .with_connection(|connection| connection.query_row(sql, [], |row| row.get(0)))
            .expect("count")
    }

    #[test]
    fn validates_project_input() {
        let database = Database::in_memory();
        assert!(insert_project(&database, project_input("  ")).is_err());
        let bad_color = ProjectInput {
            color: "red".to_string(),
            ..project_input("Tesis")
        };
        assert!(insert_project(&database, bad_color).is_err());
        let inverted = ProjectInput {
            starts_at: Some(2_000),
            target_at: Some(1_000),
            ..project_input("Tesis")
        };
        assert!(insert_project(&database, inverted).is_err());
    }

    #[test]
    fn computes_progress_and_counts() {
        let database = Database::in_memory();
        let project = insert_project(&database, project_input("Curso de Rust")).expect("project");
        let first = task_in(&database, &project.id, "Tema 1");
        task_in(&database, &project.id, "Tema 2");
        let cancelled = task_in(&database, &project.id, "Descartado");
        change_status(&database, &first, "completed").expect("complete");
        change_status(&database, &cancelled, "cancelled").expect("cancel");

        let project = load_project(&database, &project.id).expect("summary");
        assert_eq!(project.task_count, 2);
        assert_eq!(project.completed_task_count, 1);
        assert_eq!(project.open_task_count, 1);
        assert_eq!(project.progress_percent, 50.0);
        assert_eq!(
            load_dashboard(&database)
                .expect("dashboard")
                .active_projects,
            1
        );
    }

    #[test]
    fn archived_projects_leave_active_lists() {
        let database = Database::in_memory();
        let project = insert_project(&database, project_input("Docencia")).expect("project");
        set_archived(&database, &project.id, true).expect("archive");
        assert!(
            query_projects(&database, false, false)
                .expect("list")
                .is_empty()
        );
        assert_eq!(
            query_projects(&database, true, false).expect("list").len(),
            1
        );
        assert_eq!(
            load_dashboard(&database)
                .expect("dashboard")
                .active_projects,
            0
        );
        let restored = set_archived(&database, &project.id, false).expect("restore");
        assert!(restored.archived_at.is_none());
    }

    #[test]
    fn deleting_and_keeping_tasks_preserves_related_data() {
        let database = Database::in_memory();
        let project = insert_project(&database, project_input("Investigación")).expect("project");
        task_in(&database, &project.id, "Leer artículos");
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO notes(id, project_id) VALUES ('nota', ?1)",
                    [&project.id],
                )
            })
            .expect("note");

        remove_project(&database, &project.id, ProjectDeleteMode::KeepTasks).expect("delete");
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM tasks WHERE project_id IS NULL"
            ),
            1
        );
        assert_eq!(
            count(
                &database,
                "SELECT COUNT(*) FROM notes WHERE project_id IS NULL"
            ),
            1
        );
    }

    #[test]
    fn deleting_with_tasks_never_deletes_notes() {
        let database = Database::in_memory();
        let project = insert_project(&database, project_input("Programación")).expect("project");
        task_in(&database, &project.id, "Refactorizar");
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO notes(id, project_id) VALUES ('nota', ?1)",
                    [&project.id],
                )
            })
            .expect("note");

        remove_project(&database, &project.id, ProjectDeleteMode::DeleteTasks).expect("delete");
        assert_eq!(count(&database, "SELECT COUNT(*) FROM tasks"), 0);
        assert_eq!(count(&database, "SELECT COUNT(*) FROM notes"), 1);
        assert_eq!(count(&database, "SELECT COUNT(*) FROM projects"), 0);
    }
}
