//! Copias de seguridad automáticas de toda la base de FlowDesk en una carpeta que elige el
//! usuario (por ejemplo, una de iCloud Drive). Una al día mientras la app esté abierta, se
//! conservan las últimas `keep`, y se restauran con un clic: la copia elegida se comprueba,
//! se guarda antes el estado actual y la app se reinicia con ella.
//!
//! Cada copia es un único archivo SQLite (`VACUUM INTO`) que además lleva dentro los
//! adjuntos de las notas, en la tabla `flowdesk_backup_files`. La configuración vive en
//! `backups.json`, fuera de la base, para que restaurar una copia antigua no la cambie.

use crate::{background::wakeup::Wakeup, database::Database};
use chrono::{DateTime, Local, NaiveDateTime, TimeZone};
use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

const CONFIG_FILE: &str = "backups.json";
const STAGING_FILE: &str = "backup-staging.sqlite3";
const CHECK_FILE: &str = "restore-check.sqlite3";
const PENDING_FILE: &str = "restore-pending.sqlite3";
/// Si no hay carpeta elegida, la copia previa a restaurar queda aquí, en los datos de la app.
const LOCAL_SAFETY_DIR: &str = "copias-antes-de-restaurar";
const ATTACHMENTS_DIR: &str = "note-attachments";
const FILES_TABLE: &str = "flowdesk_backup_files";
const PREFIX: &str = "FlowDesk-";
const EXTENSION: &str = ".sqlite3";
const STAMP: &str = "%Y-%m-%d-%H%M%S";
pub const DEFAULT_KEEP: u32 = 30;
const CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);
const FIRST_CHECK: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupSettings {
    pub folder: Option<String>,
    pub enabled: bool,
    pub keep: u32,
    pub last_backup_at: Option<i64>,
    pub last_error: Option<String>,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            folder: None,
            enabled: true,
            keep: DEFAULT_KEEP,
            last_backup_at: None,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupKind {
    Automatic,
    Manual,
    BeforeRestore,
}

impl BackupKind {
    fn suffix(self) -> &'static str {
        match self {
            Self::Automatic => "",
            Self::Manual => "-manual",
            Self::BeforeRestore => "-antes-de-restaurar",
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::Manual => "manual",
            Self::BeforeRestore => "before-restore",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    pub name: String,
    pub created_at: i64,
    pub size: u64,
    /// `automatic`, `manual` o `before-restore`.
    pub kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOverview {
    pub settings: BackupSettings,
    /// La carpeta elegida existe (un disco o iCloud Drive desconectados no lo están).
    pub folder_available: bool,
    pub backups: Vec<BackupEntry>,
}

/// Evita dos copias a la vez (la automática y «Hacer copia ahora») y despierta al hilo
/// de las copias cuando cambia la configuración.
pub struct BackupService {
    running: Mutex<()>,
    wakeup: Wakeup,
}

impl Default for BackupService {
    fn default() -> Self {
        Self {
            running: Mutex::new(()),
            wakeup: Wakeup::new(false),
        }
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

pub fn load_settings(data_dir: &Path) -> BackupSettings {
    fs::read_to_string(data_dir.join(CONFIG_FILE))
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn store_settings(data_dir: &Path, settings: &BackupSettings) -> Result<(), String> {
    let value = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    let temporary = data_dir.join(format!("{CONFIG_FILE}.tmp"));
    fs::write(&temporary, value).map_err(|error| error.to_string())?;
    fs::rename(&temporary, data_dir.join(CONFIG_FILE)).map_err(|error| error.to_string())
}

fn file_name(kind: BackupKind, now: DateTime<Local>) -> String {
    format!("{PREFIX}{}{}{EXTENSION}", now.format(STAMP), kind.suffix())
}

/// Lee una copia por su nombre: `FlowDesk-AAAA-MM-DD-HHMMSS[-manual|-antes-de-restaurar].sqlite3`.
fn parse_name(name: &str) -> Option<(i64, BackupKind)> {
    let stem = name.strip_prefix(PREFIX)?.strip_suffix(EXTENSION)?;
    let stamp = stem.get(..17)?;
    let kind = match &stem[17..] {
        "" => BackupKind::Automatic,
        "-manual" => BackupKind::Manual,
        "-antes-de-restaurar" => BackupKind::BeforeRestore,
        _ => return None,
    };
    let moment = NaiveDateTime::parse_from_str(stamp, STAMP).ok()?;
    let created_at = Local.from_local_datetime(&moment).earliest()?.timestamp();
    Some((created_at, kind))
}

/// Copias de la carpeta, de la más reciente a la más antigua.
pub fn list_backups(folder: &Path) -> Vec<BackupEntry> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut backups: Vec<BackupEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let (created_at, kind) = parse_name(&name)?;
            let metadata = entry
                .metadata()
                .ok()
                .filter(|metadata| metadata.is_file())?;
            Some(BackupEntry {
                path: entry.path().to_string_lossy().to_string(),
                name,
                created_at,
                size: metadata.len(),
                kind: kind.id().to_string(),
            })
        })
        .collect();
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.name.cmp(&a.name)));
    backups
}

/// Borra las copias más antiguas hasta dejar `keep`. Solo toca archivos con el nombre de
/// las copias de FlowDesk. Devuelve cuántas borró.
pub fn prune(folder: &Path, keep: u32) -> usize {
    list_backups(folder)
        .into_iter()
        .skip(keep.max(1) as usize)
        .filter(|backup| fs::remove_file(&backup.path).is_ok())
        .count()
}

fn collect_files(root: &Path, directory: &Path, found: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => collect_files(root, &path, found),
            Ok(kind) if kind.is_file() => {
                if let Ok(relative) = path.strip_prefix(root) {
                    found.push((relative.to_string_lossy().replace('\\', "/"), path));
                }
            }
            _ => {}
        }
    }
}

/// Escribe la copia en `folder` y devuelve su entrada. La base se copia con `VACUUM INTO`
/// (consistente aunque esté en uso) a un archivo provisional en los datos de la app, se le
/// añaden los adjuntos y solo entonces pasa a la carpeta, primero con otro nombre: iCloud
/// nunca ve una copia a medias.
pub fn write_backup(
    database: &Database,
    data_dir: &Path,
    folder: &Path,
    kind: BackupKind,
    now: DateTime<Local>,
) -> Result<BackupEntry, String> {
    if !folder.is_dir() {
        return Err(format!(
            "La carpeta de copias no está disponible: {}",
            folder.display()
        ));
    }
    let staging = data_dir.join(STAGING_FILE);
    let _ = fs::remove_file(&staging);
    database.with_connection(|connection| {
        connection.execute("VACUUM INTO ?1", [staging.to_string_lossy()])?;
        Ok(())
    })?;
    let attach = || -> rusqlite::Result<()> {
        let mut copy = Connection::open(&staging)?;
        let transaction = copy.transaction()?;
        transaction.execute_batch(&format!(
            "CREATE TABLE {FILES_TABLE} (path TEXT PRIMARY KEY NOT NULL, data BLOB NOT NULL);"
        ))?;
        let root = data_dir.join(ATTACHMENTS_DIR);
        let mut files = Vec::new();
        collect_files(&root, &root, &mut files);
        for (relative, path) in files {
            if let Ok(data) = fs::read(&path) {
                transaction.execute(
                    &format!("INSERT INTO {FILES_TABLE}(path, data) VALUES (?1, ?2)"),
                    params![relative, data],
                )?;
            }
        }
        transaction.commit()
    };
    let result = attach().map_err(|error| error.to_string()).and_then(|()| {
        let name = file_name(kind, now);
        let target = folder.join(&name);
        let partial = folder.join(format!("{name}.partial"));
        fs::copy(&staging, &partial).map_err(|error| error.to_string())?;
        fs::rename(&partial, &target).map_err(|error| {
            let _ = fs::remove_file(&partial);
            error.to_string()
        })?;
        Ok(BackupEntry {
            path: target.to_string_lossy().to_string(),
            size: fs::metadata(&target)
                .map(|metadata| metadata.len())
                .unwrap_or(0),
            created_at: now.timestamp(),
            kind: kind.id().to_string(),
            name,
        })
    });
    let _ = fs::remove_file(&staging);
    result
}

/// Hace una copia en la carpeta configurada, guarda cuándo y borra las que sobran.
pub fn run_backup(app: &AppHandle, kind: BackupKind) -> Result<BackupEntry, String> {
    let service = app.state::<BackupService>();
    let _running = service
        .running
        .lock()
        .map_err(|_| "Ya se está haciendo una copia".to_string())?;
    let data_dir = data_dir(app)?;
    let mut settings = load_settings(&data_dir);
    let Some(folder) = settings.folder.clone().map(PathBuf::from) else {
        return Err("Elige primero la carpeta de las copias.".to_string());
    };
    let database = app.state::<Database>();
    let result = write_backup(&database, &data_dir, &folder, kind, Local::now());
    match &result {
        Ok(entry) => {
            settings.last_backup_at = Some(entry.created_at);
            settings.last_error = None;
            prune(&folder, settings.keep);
        }
        Err(error) => settings.last_error = Some(error.clone()),
    }
    store_settings(&data_dir, &settings)?;
    let _ = app.emit("flowdesk://data-changed", "backups");
    result
}

/// Toca copia automática si está activada, hay carpeta y hoy aún no se hizo ninguna.
pub fn is_due(settings: &BackupSettings, now: DateTime<Local>) -> bool {
    settings.enabled
        && settings.folder.is_some()
        && settings.last_backup_at.is_none_or(|last| {
            Local
                .timestamp_opt(last, 0)
                .single()
                .is_none_or(|last| last.date_naive() != now.date_naive())
        })
}

/// Hilo de las copias automáticas: comprueba poco después de abrir la app y luego cada
/// media hora, o en cuanto cambia la configuración.
pub fn spawn_scheduler(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("flowdesk-backups".to_string())
        .spawn(move || {
            std::thread::sleep(FIRST_CHECK);
            loop {
                if let Ok(data_dir) = data_dir(&app)
                    && is_due(&load_settings(&data_dir), Local::now())
                    && let Err(error) = run_backup(&app, BackupKind::Automatic)
                {
                    eprintln!("No se pudo hacer la copia de seguridad: {error}");
                }
                app.state::<BackupService>()
                    .wakeup
                    .wait(Some(CHECK_INTERVAL));
            }
        });
    if let Err(error) = spawned {
        eprintln!("No se pudo iniciar el servicio de copias: {error}");
    }
}

/// Comprueba que el archivo es una base de FlowDesk íntegra y que esta versión la entiende.
pub fn check_backup(path: &Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "El archivo no es una copia de FlowDesk.".to_string())?;
    let integrity: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|_| "El archivo no es una copia de FlowDesk.".to_string())?;
    if integrity != "ok" {
        return Err("La copia está dañada; elige otra.".to_string());
    }
    let version: Option<i64> = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .map_err(|_| "El archivo no es una copia de FlowDesk.".to_string())?;
    let is_flowdesk: bool = connection
        .query_row(
            "SELECT COUNT(*) = 3 FROM sqlite_master WHERE type = 'table'
             AND name IN ('notes', 'tasks', 'calendar_events')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    match version {
        Some(version) if is_flowdesk && version <= crate::database::latest_version() => Ok(()),
        Some(_) if is_flowdesk => Err(
            "La copia es de una versión más nueva de FlowDesk. Actualiza la app para restaurarla."
                .to_string(),
        ),
        _ => Err("El archivo no es una copia de FlowDesk.".to_string()),
    }
}

/// Deja la copia lista para que FlowDesk la use al reiniciar: la copia a los datos de la
/// app, la comprueba y la renombra a `restore-pending.sqlite3`.
pub fn stage_restore(data_dir: &Path, source: &Path) -> Result<(), String> {
    if !source.is_file() {
        return Err("No se encuentra la copia.".to_string());
    }
    let check = data_dir.join(CHECK_FILE);
    let _ = fs::remove_file(&check);
    fs::copy(source, &check).map_err(|error| format!("No se pudo leer la copia: {error}"))?;
    if let Err(error) = check_backup(&check) {
        let _ = fs::remove_file(&check);
        return Err(error);
    }
    fs::rename(&check, data_dir.join(PENDING_FILE)).map_err(|error| error.to_string())
}

/// Al arrancar, antes de abrir la base: si hay una restauración pendiente, sustituye la base
/// por ella. El diario WAL de la base anterior se borra antes, para que SQLite no lo aplique
/// sobre la restaurada. Devuelve si restauró.
pub fn apply_pending(data_dir: &Path) -> std::io::Result<bool> {
    let pending = data_dir.join(PENDING_FILE);
    if !pending.is_file() {
        return Ok(false);
    }
    for suffix in ["-wal", "-shm"] {
        let path = data_dir.join(format!("flowdesk.sqlite3{suffix}"));
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    fs::rename(pending, data_dir.join("flowdesk.sqlite3"))?;
    Ok(true)
}

/// Tras abrir una base restaurada: devuelve los adjuntos de las notas a su carpeta y quita
/// la tabla que los traía. Sin esa tabla no hace nada.
pub fn finish_restore(connection: &Connection, data_dir: &Path) -> Result<(), String> {
    let restore = || -> rusqlite::Result<bool> {
        let has_files: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [FILES_TABLE],
            |row| row.get(0),
        )?;
        if !has_files {
            return Ok(false);
        }
        let files: Vec<(String, Vec<u8>)> = connection
            .prepare(&format!("SELECT path, data FROM {FILES_TABLE}"))?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        let root = data_dir.join(ATTACHMENTS_DIR);
        let _ = fs::remove_dir_all(&root);
        for (relative, data) in files {
            // Solo rutas relativas dentro de la carpeta de adjuntos.
            let safe = Path::new(&relative)
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)));
            if !safe {
                continue;
            }
            let path = root.join(&relative);
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(path, data);
        }
        connection.execute_batch(&format!("DROP TABLE {FILES_TABLE};"))?;
        Ok(true)
    };
    restore().map(|_| ()).map_err(|error| error.to_string())
}

fn overview(data_dir: &Path) -> BackupOverview {
    let settings = load_settings(data_dir);
    let folder = settings.folder.as_deref().map(Path::new);
    BackupOverview {
        folder_available: folder.is_some_and(Path::is_dir),
        backups: folder.map(list_backups).unwrap_or_default(),
        settings,
    }
}

#[tauri::command]
pub fn get_backups(app: AppHandle) -> Result<BackupOverview, String> {
    Ok(overview(&data_dir(&app)?))
}

#[tauri::command]
pub fn update_backup_settings(
    folder: Option<String>,
    enabled: bool,
    keep: u32,
    app: AppHandle,
    service: State<'_, BackupService>,
) -> Result<BackupOverview, String> {
    if !(1..=365).contains(&keep) {
        return Err("Conserva entre 1 y 365 copias.".to_string());
    }
    let folder = folder.filter(|value| !value.trim().is_empty());
    if let Some(folder) = &folder
        && !Path::new(folder).is_dir()
    {
        return Err("Esa carpeta no existe.".to_string());
    }
    let data_dir = data_dir(&app)?;
    let mut settings = load_settings(&data_dir);
    let folder_changed = settings.folder != folder;
    settings.folder = folder;
    settings.enabled = enabled;
    settings.keep = keep;
    if folder_changed {
        // Con otra carpeta, la copia de hoy se hace allí.
        settings.last_backup_at = None;
        settings.last_error = None;
    }
    store_settings(&data_dir, &settings)?;
    if let Some(folder) = &settings.folder {
        prune(Path::new(folder), keep);
    }
    service.wakeup.wake();
    Ok(overview(&data_dir))
}

#[tauri::command]
pub async fn backup_now(app: AppHandle) -> Result<BackupEntry, String> {
    tauri::async_runtime::spawn_blocking(move || run_backup(&app, BackupKind::Manual))
        .await
        .map_err(|error| error.to_string())?
}

/// Prepara la restauración de `path`: guarda antes el estado actual (en la carpeta de copias
/// o, sin ella, en los datos de la app). La interfaz reinicia la app a continuación.
#[tauri::command]
pub async fn restore_backup(path: String, app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data_dir = data_dir(&app)?;
        let source = PathBuf::from(&path);
        check_backup(&source)?;
        let settings = load_settings(&data_dir);
        match settings
            .folder
            .as_deref()
            .map(Path::new)
            .filter(|folder| folder.is_dir())
        {
            Some(_) => {
                run_backup(&app, BackupKind::BeforeRestore)?;
            }
            None => {
                let folder = data_dir.join(LOCAL_SAFETY_DIR);
                fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
                let database = app.state::<Database>();
                write_backup(
                    &database,
                    &data_dir,
                    &folder,
                    BackupKind::BeforeRestore,
                    Local::now(),
                )?;
                prune(&folder, 5);
            }
        }
        stage_restore(&data_dir, &source)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Muestra la carpeta de copias en el Finder.
#[tauri::command]
pub fn reveal_backup_folder(app: AppHandle) -> Result<(), String> {
    let settings = load_settings(&data_dir(&app)?);
    let Some(folder) = settings.folder.filter(|folder| Path::new(folder).is_dir()) else {
        return Err("La carpeta de copias no está disponible.".to_string());
    };
    std::process::Command::new("open")
        .arg(folder)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("flowdesk-backup-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn at(day: u32, hour: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 10, day, hour, 15, 30)
            .single()
            .expect("fecha")
    }

    #[test]
    fn names_round_trip_and_ignore_other_files() {
        let name = file_name(BackupKind::Manual, at(26, 22));
        assert_eq!(name, "FlowDesk-2026-10-26-221530-manual.sqlite3");
        assert_eq!(
            parse_name(&name),
            Some((at(26, 22).timestamp(), BackupKind::Manual))
        );
        assert_eq!(
            parse_name("FlowDesk-2026-10-26-221530-antes-de-restaurar.sqlite3")
                .map(|(_, kind)| kind),
            Some(BackupKind::BeforeRestore)
        );
        assert_eq!(
            parse_name("FlowDesk-2026-10-26-221530.sqlite3.partial"),
            None
        );
        assert_eq!(parse_name("notas.sqlite3"), None);
        assert_eq!(parse_name("FlowDesk-2026-10-26-221530-otra.sqlite3"), None);
    }

    #[test]
    fn a_backup_is_due_once_a_day() {
        let mut settings = BackupSettings {
            folder: Some("/tmp".into()),
            ..BackupSettings::default()
        };
        assert!(is_due(&settings, at(26, 9)));
        settings.last_backup_at = Some(at(26, 8).timestamp());
        assert!(!is_due(&settings, at(26, 23)));
        assert!(is_due(&settings, at(27, 0)));
        settings.enabled = false;
        assert!(!is_due(&settings, at(27, 0)));
        settings.enabled = true;
        settings.folder = None;
        assert!(!is_due(&settings, at(27, 0)));
    }

    #[test]
    fn backups_keep_the_newest_and_restore_with_attachments() {
        let data_dir = temp_dir("data");
        let folder = temp_dir("folder");
        let database = Database::in_memory();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO notes(id, title, content) VALUES ('n1', 'Antes', 'texto')",
                    [],
                )?;
                Ok(())
            })
            .expect("nota");
        let image = data_dir.join(ATTACHMENTS_DIR).join("n1").join("a.png");
        fs::create_dir_all(image.parent().unwrap()).unwrap();
        fs::write(&image, b"png").unwrap();
        fs::write(folder.join("otra-cosa.txt"), b"no tocar").unwrap();

        for day in 1..=5 {
            write_backup(
                &database,
                &data_dir,
                &folder,
                BackupKind::Automatic,
                at(day, 10),
            )
            .expect("copia");
        }
        assert_eq!(list_backups(&folder).len(), 5);
        assert_eq!(prune(&folder, 3), 2);
        let left = list_backups(&folder);
        assert_eq!(left.len(), 3);
        assert!(left[0].name.contains("2026-10-05"));
        assert!(folder.join("otra-cosa.txt").exists());
        assert!(!data_dir.join(STAGING_FILE).exists());

        // Restaurar: la copia pasa a ser la base y los adjuntos vuelven.
        check_backup(Path::new(&left[0].path)).expect("copia válida");
        fs::write(data_dir.join("flowdesk.sqlite3"), b"base vieja").unwrap();
        fs::write(data_dir.join("flowdesk.sqlite3-wal"), b"wal viejo").unwrap();
        fs::remove_dir_all(data_dir.join(ATTACHMENTS_DIR)).unwrap();
        stage_restore(&data_dir, Path::new(&left[0].path)).expect("preparada");
        assert!(apply_pending(&data_dir).expect("aplicada"));
        assert!(!data_dir.join("flowdesk.sqlite3-wal").exists());
        assert!(!apply_pending(&data_dir).expect("nada pendiente"));
        let restored = Connection::open(data_dir.join("flowdesk.sqlite3")).expect("base");
        finish_restore(&restored, &data_dir).expect("adjuntos");
        assert_eq!(fs::read(&image).expect("adjunto"), b"png");
        let title: String = restored
            .query_row("SELECT title FROM notes WHERE id = 'n1'", [], |row| {
                row.get(0)
            })
            .expect("nota restaurada");
        assert_eq!(title, "Antes");
        let leftover: bool = restored
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = ?1)",
                [FILES_TABLE],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!leftover);

        let _ = fs::remove_dir_all(data_dir);
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn rejects_files_that_are_not_flowdesk_backups() {
        let dir = temp_dir("reject");
        let other = dir.join("otra.sqlite3");
        Connection::open(&other)
            .unwrap()
            .execute_batch("CREATE TABLE cosas(id INTEGER);")
            .unwrap();
        assert!(check_backup(&other).is_err());
        fs::write(dir.join("texto.sqlite3"), b"hola").unwrap();
        assert!(check_backup(&dir.join("texto.sqlite3")).is_err());
        assert!(stage_restore(&dir, &other).is_err());
        assert!(!dir.join(PENDING_FILE).exists());
        let _ = fs::remove_dir_all(dir);
    }
}
