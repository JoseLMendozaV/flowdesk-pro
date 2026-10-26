//! Adjuntos de notas: imágenes, archivos y audio. Los archivos viven en
//! `<datos>/note-attachments/<nota>/<id>.<ext>`; SQLite guarda solo la referencia.
//! Borrar es reversible durante 30 días: el archivo pasa a `.trash/`.

use crate::{
    commands::notes::require_note, database::Database, models::NoteAttachment, note_document,
};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager, State, ipc::Request};
use uuid::Uuid;

const DIRECTORY: &str = "note-attachments";
const TRASH: &str = ".trash";
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;
const TRASH_SECONDS: i64 = 30 * 86_400;
const MAX_NAME: usize = 120;

pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(DIRECTORY))
        .map_err(|error| error.to_string())
}

/// Tipo por extensión. Solo los formatos que WebKit muestra se tratan como imagen o audio.
pub fn classify(file_name: &str) -> (&'static str, &'static str) {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match extension.as_str() {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "m4a" => ("audio", "audio/mp4"),
        "mp3" => ("audio", "audio/mpeg"),
        "wav" => ("audio", "audio/wav"),
        "aac" => ("audio", "audio/aac"),
        "pdf" => ("file", "application/pdf"),
        "txt" | "md" => ("file", "text/plain"),
        _ => ("file", "application/octet-stream"),
    }
}

/// Solo el nombre final, sin separadores ni caracteres de control.
pub fn sanitize_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_NAME)
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "archivo".to_string()
    } else {
        cleaned
    }
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .filter(|extension| {
            extension.len() <= 10 && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
        .map(|extension| format!(".{}", extension.to_ascii_lowercase()))
        .unwrap_or_default()
}

fn map_attachment(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteAttachment> {
    Ok(NoteAttachment {
        id: row.get(0)?,
        note_id: row.get(1)?,
        kind: row.get(2)?,
        file_name: row.get(3)?,
        mime_type: row.get(4)?,
        byte_size: row.get(5)?,
        created_at: row.get(6)?,
        in_use: false,
    })
}

const SELECT: &str =
    "SELECT id, note_id, kind, file_name, mime_type, byte_size, created_at FROM note_attachments";

/// Ruta del archivo, en su sitio o en la papelera si se eliminó.
fn file_path(root: &Path, stored_name: &str, deleted: bool) -> PathBuf {
    if deleted {
        root.join(TRASH).join(stored_name.replace('/', "_"))
    } else {
        root.join(stored_name)
    }
}

fn store(
    database: &Database,
    root: &Path,
    note_id: &str,
    file_name: &str,
    write: impl FnOnce(&Path) -> Result<u64, String>,
) -> Result<NoteAttachment, String> {
    require_note(database, note_id)?;
    let file_name = sanitize_name(file_name);
    let (kind, mime_type) = classify(&file_name);
    let id = Uuid::new_v4().to_string();
    let stored_name = format!("{note_id}/{id}{}", extension_of(&file_name));
    let destination = root.join(&stored_name);
    fs::create_dir_all(destination.parent().ok_or("Ruta no válida")?)
        .map_err(|error| error.to_string())?;
    let byte_size = match write(&destination) {
        Ok(size) => size,
        Err(error) => {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
    };
    let inserted = database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO note_attachments(id, note_id, kind, file_name, stored_name, mime_type, byte_size)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, note_id, kind, file_name, stored_name, mime_type, byte_size as i64],
        )?;
        connection.query_row(&format!("{SELECT} WHERE id = ?1"), [&id], map_attachment)
    });
    if inserted.is_err() {
        let _ = fs::remove_file(&destination);
    }
    inserted
}

pub fn store_bytes(
    database: &Database,
    root: &Path,
    note_id: &str,
    file_name: &str,
    bytes: &[u8],
) -> Result<NoteAttachment, String> {
    if bytes.is_empty() {
        return Err("El archivo está vacío".to_string());
    }
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Los adjuntos no pueden superar 50 MB".to_string());
    }
    store(database, root, note_id, file_name, |destination| {
        fs::write(destination, bytes).map_err(|error| error.to_string())?;
        Ok(bytes.len() as u64)
    })
}

/// Copia un archivo elegido o arrastrado. Debe ser un archivo normal y existir.
pub fn store_path(
    database: &Database,
    root: &Path,
    note_id: &str,
    source: &Path,
) -> Result<NoteAttachment, String> {
    if !source.is_absolute() {
        return Err("Ruta no válida".to_string());
    }
    let metadata = fs::metadata(source).map_err(|_| "El archivo no existe".to_string())?;
    if !metadata.is_file() {
        return Err("Solo se pueden adjuntar archivos, no carpetas".to_string());
    }
    if metadata.len() > MAX_BYTES {
        return Err("Los adjuntos no pueden superar 50 MB".to_string());
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("archivo")
        .to_string();
    store(database, root, note_id, &name, |destination| {
        fs::copy(source, destination).map_err(|error| error.to_string())
    })
}

fn referenced_ids(connection: &Connection, note_id: &str) -> rusqlite::Result<Vec<String>> {
    let json: Option<String> = connection
        .query_row(
            "SELECT content_json FROM notes WHERE id = ?1",
            [note_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(json
        .and_then(|json| note_document::digest(&json).ok())
        .map(|digest| digest.attachment_ids)
        .unwrap_or_default())
}

pub fn list(database: &Database, note_id: &str) -> Result<Vec<NoteAttachment>, String> {
    require_note(database, note_id)?;
    database.with_connection(|connection| {
        let used = referenced_ids(connection, note_id)?;
        let mut attachments = connection
            .prepare(&format!(
                "{SELECT} WHERE note_id = ?1 AND deleted_at IS NULL ORDER BY created_at, rowid"
            ))?
            .query_map([note_id], map_attachment)?
            .collect::<Result<Vec<_>, _>>()?;
        for attachment in &mut attachments {
            attachment.in_use = used.contains(&attachment.id);
        }
        Ok(attachments)
    })
}

fn locate(database: &Database, root: &Path, id: &str) -> Result<(PathBuf, String), String> {
    Uuid::parse_str(id).map_err(|_| "Adjunto no válido".to_string())?;
    let (stored_name, deleted, mime_type): (String, bool, String) = database
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT stored_name, deleted_at IS NOT NULL, mime_type FROM note_attachments WHERE id = ?1",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
        })?
        .ok_or_else(|| "El adjunto no existe".to_string())?;
    Ok((file_path(root, &stored_name, deleted), mime_type))
}

pub fn read(database: &Database, root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let (path, _) = locate(database, root, id)?;
    fs::read(path).map_err(|_| "No se encontró el archivo del adjunto".to_string())
}

/// Lo retira de la nota y mueve el archivo a la papelera.
pub fn soft_delete(database: &Database, root: &Path, id: &str, now: i64) -> Result<String, String> {
    Uuid::parse_str(id).map_err(|_| "Adjunto no válido".to_string())?;
    let (note_id, stored_name): (String, String) = database
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT note_id, stored_name FROM note_attachments WHERE id = ?1 AND deleted_at IS NULL",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
        })?
        .ok_or_else(|| "El adjunto no existe".to_string())?;
    let source = file_path(root, &stored_name, false);
    let trashed = file_path(root, &stored_name, true);
    fs::create_dir_all(root.join(TRASH)).map_err(|error| error.to_string())?;
    if source.exists() {
        fs::rename(&source, &trashed).map_err(|error| error.to_string())?;
    }
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE note_attachments SET deleted_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    })?;
    Ok(note_id)
}

/// Al restaurar una versión: los adjuntos que vuelve a usar salen de la papelera.
pub fn restore_referenced(database: &Database, root: &Path, note_id: &str) -> Result<(), String> {
    let rows: Vec<(String, String)> = database.with_connection(|connection| {
        let used = referenced_ids(connection, note_id)?;
        let mut statement = connection.prepare(
            "SELECT id, stored_name FROM note_attachments WHERE note_id = ?1 AND deleted_at IS NOT NULL",
        )?;
        let rows = statement
            .query_map([note_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<(String, String)>, _>>()?;
        Ok(rows.into_iter().filter(|(id, _)| used.contains(id)).collect())
    })?;
    for (id, stored_name) in rows {
        let trashed = file_path(root, &stored_name, true);
        let destination = file_path(root, &stored_name, false);
        if trashed.exists() {
            if let Some(parent) = destination.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::rename(&trashed, &destination).map_err(|error| error.to_string())?;
        }
        database.with_connection(|connection| {
            connection.execute(
                "UPDATE note_attachments SET deleted_at = NULL WHERE id = ?1",
                [&id],
            )?;
            Ok(())
        })?;
    }
    Ok(())
}

/// Borra definitivamente lo que lleva más de 30 días en la papelera.
pub fn purge_trash(database: &Database, root: &Path, now: i64) -> Result<usize, String> {
    let expired: Vec<(String, String)> = database.with_connection(|connection| {
        connection
            .prepare("SELECT id, stored_name FROM note_attachments WHERE deleted_at < ?1")?
            .query_map([now - TRASH_SECONDS], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect()
    })?;
    for (id, stored_name) in &expired {
        let _ = fs::remove_file(file_path(root, stored_name, true));
        database.with_connection(|connection| {
            connection.execute("DELETE FROM note_attachments WHERE id = ?1", [id])?;
            Ok(())
        })?;
    }
    Ok(expired.len())
}

pub fn remove_note_directory(app: &AppHandle, note_id: &str) {
    if Uuid::parse_str(note_id).is_err() {
        return;
    }
    if let Ok(root) = root(app) {
        let _ = fs::remove_dir_all(root.join(note_id));
    }
}

fn open_path(path: &Path) -> Result<(), String> {
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
        let _ = path;
        Err("Abrir adjuntos solo está disponible en macOS".to_string())
    }
}

/// Nombre del archivo en la cabecera `x-file-name`, codificado con `encodeURIComponent`.
fn decode_header(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16)
        {
            decoded.push(byte);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn changed(app: &AppHandle) {
    let _ = app.emit("flowdesk://data-changed", "notes");
}

/// Recibe los bytes del archivo en el cuerpo (imagen pegada o elegida en la nota).
#[tauri::command]
pub fn add_note_attachment(
    request: Request<'_>,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<NoteAttachment, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let note_id = header("x-note-id").ok_or("Falta la nota")?;
    let file_name = decode_header(&header("x-file-name").unwrap_or_else(|| "archivo".to_string()));
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaba el contenido del archivo".to_string());
    };
    let attachment = store_bytes(&database, &root(&app)?, &note_id, &file_name, bytes)?;
    changed(&app);
    Ok(attachment)
}

/// Archivos arrastrados desde el Finder o elegidos con el selector de macOS.
#[tauri::command]
pub fn attach_note_files(
    note_id: String,
    paths: Vec<String>,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<Vec<NoteAttachment>, String> {
    if paths.len() > 20 {
        return Err("Como máximo 20 archivos a la vez".to_string());
    }
    let root = root(&app)?;
    let attachments = paths
        .iter()
        .map(|path| store_path(&database, &root, &note_id, Path::new(path)))
        .collect::<Result<Vec<_>, _>>()?;
    changed(&app);
    Ok(attachments)
}

#[tauri::command]
pub fn list_note_attachments(
    note_id: String,
    database: State<'_, Database>,
) -> Result<Vec<NoteAttachment>, String> {
    list(&database, &note_id)
}

#[tauri::command]
pub fn get_note_attachment_data(
    attachment_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<tauri::ipc::Response, String> {
    read(&database, &root(&app)?, &attachment_id).map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn open_note_attachment(
    attachment_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    let (path, _) = locate(&database, &root(&app)?, &attachment_id)?;
    if !path.exists() {
        return Err("No se encontró el archivo del adjunto".to_string());
    }
    open_path(&path)
}

#[tauri::command]
pub fn delete_note_attachment(
    attachment_id: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> Result<(), String> {
    soft_delete(
        &database,
        &root(&app)?,
        &attachment_id,
        Utc::now().timestamp(),
    )?;
    changed(&app);
    Ok(())
}

/// Enlaces de las notas: solo web y correo, con la app predeterminada del sistema.
#[tauri::command]
pub fn open_note_link(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Enlace no válido".to_string())?;
    if url.len() > 2_048 || !["http", "https", "mailto"].contains(&parsed.scheme()) {
        return Err("Solo se abren enlaces web o de correo".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg("--")
            .arg(parsed.as_str())
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    Err("Abrir enlaces solo está disponible en macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::notes::tests_support::new_note;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("flowdesk-attachments-{}", Uuid::new_v4()))
    }

    #[test]
    fn names_and_kinds_are_safe() {
        assert_eq!(sanitize_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_name("C:\\\\tmp\\\\foto.PNG"), "foto.PNG");
        assert_eq!(sanitize_name(".oculto"), "oculto");
        assert_eq!(sanitize_name("\u{0}\n"), "archivo");
        assert_eq!(classify("foto.PNG"), ("image", "image/png"));
        assert_eq!(classify("voz.m4a"), ("audio", "audio/mp4"));
        assert_eq!(classify("informe.pdf"), ("file", "application/pdf"));
        assert_eq!(classify("foto.heic").0, "file");
        assert_eq!(extension_of("x.tar.gz"), ".gz");
        assert_eq!(extension_of("x.ex$e"), "");
        assert_eq!(decode_header("gu%C3%ADa%20final.pdf"), "guía final.pdf");
    }

    #[test]
    fn stores_reads_and_lists_attachments_without_blobs() {
        let database = Database::in_memory();
        let root = temp_root();
        let note = new_note(&database);
        let image =
            store_bytes(&database, &root, &note, "captura.png", b"PNG-DATA").expect("image");
        assert_eq!(image.kind, "image");
        assert_eq!(
            read(&database, &root, &image.id).expect("read"),
            b"PNG-DATA"
        );
        let stored = root.join(&note).join(format!("{}.png", image.id));
        assert!(
            stored.exists(),
            "el archivo vive en el directorio administrado"
        );
        let column_bytes: i64 = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT length(stored_name) FROM note_attachments",
                    [],
                    |row| row.get(0),
                )
            })
            .expect("row");
        assert!(column_bytes < 100, "SQLite guarda solo la referencia");

        let source = root.join("origen.pdf");
        fs::write(&source, b"%PDF").expect("source");
        let pdf = store_path(&database, &root, &note, &source).expect("pdf");
        assert_eq!(pdf.file_name, "origen.pdf");
        assert!(
            store_path(&database, &root, &note, &root).is_err(),
            "carpetas no"
        );
        assert!(store_path(&database, &root, &note, Path::new("relativa.txt")).is_err());
        assert!(store_bytes(&database, &root, &note, "vacío.txt", b"").is_err());

        // En uso solo lo que el documento referencia.
        database
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE notes SET content_json = ?1 WHERE id = ?2",
                    params![
                        format!(r#"{{"type":"doc","content":[{{"type":"noteImage","attrs":{{"attachmentId":"{}","fileName":"captura.png"}}}}]}}"#, image.id),
                        note
                    ],
                )
            })
            .expect("doc");
        let listed = list(&database, &note).expect("list");
        assert_eq!(listed.len(), 2);
        assert!(
            listed
                .iter()
                .find(|item| item.id == image.id)
                .expect("image")
                .in_use
        );
        assert!(
            !listed
                .iter()
                .find(|item| item.id == pdf.id)
                .expect("pdf")
                .in_use
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn deleting_moves_to_trash_and_restoring_a_version_brings_it_back() {
        let database = Database::in_memory();
        let root = temp_root();
        let note = new_note(&database);
        let image = store_bytes(&database, &root, &note, "a.png", b"IMG").expect("image");
        database
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE notes SET content_json = ?1 WHERE id = ?2",
                    params![
                        format!(r#"{{"type":"doc","content":[{{"type":"noteImage","attrs":{{"attachmentId":"{}"}}}}]}}"#, image.id),
                        note
                    ],
                )
            })
            .expect("doc");
        soft_delete(&database, &root, &image.id, 1_000).expect("delete");
        assert!(list(&database, &note).expect("list").is_empty());
        assert_eq!(
            read(&database, &root, &image.id).expect("still readable"),
            b"IMG"
        );
        restore_referenced(&database, &root, &note).expect("restore");
        assert_eq!(list(&database, &note).expect("list").len(), 1);

        soft_delete(&database, &root, &image.id, 1_000).expect("delete again");
        assert_eq!(
            purge_trash(&database, &root, 1_000 + TRASH_SECONDS - 1).expect("purge"),
            0
        );
        assert_eq!(
            purge_trash(&database, &root, 1_000 + TRASH_SECONDS + 1).expect("purge"),
            1
        );
        assert!(read(&database, &root, &image.id).is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_files_over_the_limit() {
        let database = Database::in_memory();
        let root = temp_root();
        let note = new_note(&database);
        let big = vec![0_u8; (MAX_BYTES + 1) as usize];
        assert!(store_bytes(&database, &root, &note, "grande.bin", &big).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
