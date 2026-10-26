//! Documento del editor enriquecido de las notas (JSON de ProseMirror/Tiptap).
//!
//! Rust no interpreta el formato visual, pero deriva de él lo que necesita el resto de
//! la app: el texto plano de `notes.content` (búsqueda, vistas previas, tareas, espacios),
//! los elementos de las listas de verificación y los adjuntos que el documento usa.

use serde_json::Value;

/// Versión del formato estructurado guardado en `notes.content_format`.
pub const RICH_FORMAT: &str = "rich-v1";
pub const MAX_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_DEPTH: usize = 64;
const MAX_NODES: usize = 100_000;

/// Nodos de adjunto definidos en el editor (src/features/notes/editor/attachments.ts).
pub const ATTACHMENT_NODES: &[&str] = &["noteImage", "noteFile", "noteAudio"];

#[derive(Debug, Default, PartialEq)]
pub struct Digest {
    pub text: String,
    pub checklist: Vec<(String, bool)>,
    pub attachment_ids: Vec<String>,
    pub words: i64,
    pub characters: i64,
}

struct Walker {
    lines: Vec<String>,
    current: String,
    checklist: Vec<(String, bool)>,
    attachment_ids: Vec<String>,
    nodes: usize,
}

impl Walker {
    fn break_line(&mut self) {
        let line = std::mem::take(&mut self.current);
        self.lines.push(line.trim_end().to_string());
    }

    fn text_of(node: &Value) -> String {
        match node.get("type").and_then(Value::as_str) {
            Some("text") => node
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            Some("hardBreak") => " ".to_string(),
            _ => node
                .get("content")
                .and_then(Value::as_array)
                .map(|children| children.iter().map(Self::text_of).collect::<String>())
                .unwrap_or_default(),
        }
    }

    fn walk(&mut self, node: &Value, depth: usize, prefix: &str) -> Result<(), String> {
        self.nodes += 1;
        if depth > MAX_DEPTH || self.nodes > MAX_NODES {
            return Err("El documento de la nota es demasiado complejo".to_string());
        }
        let Some(kind) = node.get("type").and_then(Value::as_str) else {
            return Err("Documento de nota no válido".to_string());
        };
        let children = node.get("content").and_then(Value::as_array);
        let attrs = node.get("attrs");
        match kind {
            "text" => {
                if let Some(text) = node.get("text").and_then(Value::as_str) {
                    self.current.push_str(text);
                }
            }
            "hardBreak" => self.break_line(),
            "horizontalRule" => {
                self.break_line();
                self.current.push_str("---");
                self.break_line();
            }
            kind if ATTACHMENT_NODES.contains(&kind) => {
                if let Some(id) = attrs
                    .and_then(|attrs| attrs.get("attachmentId"))
                    .and_then(Value::as_str)
                    && !self.attachment_ids.iter().any(|known| known == id)
                {
                    self.attachment_ids.push(id.to_string());
                }
                let name = attrs
                    .and_then(|attrs| attrs.get("fileName"))
                    .and_then(Value::as_str)
                    .unwrap_or("archivo");
                let label = match kind {
                    "noteImage" => "Imagen",
                    "noteAudio" => "Audio",
                    _ => "Archivo",
                };
                self.break_line();
                self.current.push_str(&format!("[{label}: {name}]"));
                self.break_line();
            }
            "taskItem" => {
                let checked = attrs
                    .and_then(|attrs| attrs.get("checked"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let text = Self::text_of(node).trim().to_string();
                self.checklist.push((text, checked));
                self.current.push_str(if checked { "[x] " } else { "[ ] " });
                self.walk_children(children, depth, "")?;
                self.break_line();
            }
            "listItem" => {
                self.current.push_str(prefix);
                self.walk_children(children, depth, "")?;
                self.break_line();
            }
            "orderedList" => {
                let start = attrs
                    .and_then(|attrs| attrs.get("start"))
                    .and_then(Value::as_i64)
                    .unwrap_or(1);
                for (index, child) in children.into_iter().flatten().enumerate() {
                    self.walk(child, depth + 1, &format!("{}. ", start + index as i64))?;
                }
            }
            "bulletList" => {
                for child in children.into_iter().flatten() {
                    self.walk(child, depth + 1, "- ")?;
                }
            }
            "tableCell" | "tableHeader" => {
                if !self.current.is_empty() {
                    self.current.push_str(" | ");
                }
                self.current.push_str(Self::text_of(node).trim());
            }
            "tableRow" => {
                self.walk_children(children, depth, "")?;
                self.break_line();
            }
            "paragraph" | "heading" | "codeBlock" | "blockquote" => {
                self.walk_children(children, depth, "")?;
                if !self.current.is_empty() || kind != "blockquote" {
                    self.break_line();
                }
            }
            _ => self.walk_children(children, depth, prefix)?,
        }
        Ok(())
    }

    fn walk_children(
        &mut self,
        children: Option<&Vec<Value>>,
        depth: usize,
        prefix: &str,
    ) -> Result<(), String> {
        for child in children.into_iter().flatten() {
            self.walk(child, depth + 1, prefix)?;
        }
        Ok(())
    }
}

/// Valida el documento y deriva su texto plano, listas y adjuntos.
pub fn digest(json: &str) -> Result<Digest, String> {
    if json.len() > MAX_JSON_BYTES {
        return Err("La nota no puede superar 2 MB de contenido".to_string());
    }
    let document: Value =
        serde_json::from_str(json).map_err(|_| "Documento de nota no válido".to_string())?;
    if document.get("type").and_then(Value::as_str) != Some("doc") {
        return Err("Documento de nota no válido".to_string());
    }
    let mut walker = Walker {
        lines: Vec::new(),
        current: String::new(),
        checklist: Vec::new(),
        attachment_ids: Vec::new(),
        nodes: 0,
    };
    walker.walk(&document, 0, "")?;
    walker.break_line();
    // Sin líneas vacías repetidas ni al principio o al final.
    let mut text = String::new();
    let mut blank = true;
    for line in walker.lines {
        if line.is_empty() {
            if !blank {
                text.push('\n');
            }
            blank = true;
            continue;
        }
        if !text.is_empty() && !blank {
            text.push('\n');
        }
        text.push_str(&line);
        blank = false;
    }
    let text = text.trim().to_string();
    Ok(Digest {
        words: count_words(&text),
        characters: text.chars().count() as i64,
        text,
        checklist: walker.checklist,
        attachment_ids: walker.attachment_ids,
    })
}

/// Recuento del texto de una nota en Markdown (formato anterior).
pub fn count_plain(text: &str) -> (i64, i64) {
    (text.chars().count() as i64, count_words(text))
}

/// Palabras con al menos una letra o cifra: los marcadores de lista o tabla no cuentan.
fn count_words(text: &str) -> i64 {
    text.split_whitespace()
        .filter(|word| word.chars().any(char::is_alphanumeric))
        .count() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(content: Value) -> String {
        json!({ "type": "doc", "content": content }).to_string()
    }

    fn text(value: &str) -> Value {
        json!({ "type": "text", "text": value })
    }

    #[test]
    fn derives_plain_text_from_rich_blocks() {
        let json = doc(json!([
            { "type": "heading", "attrs": { "level": 1 }, "content": [text("Plan")] },
            { "type": "paragraph", "content": [text("Texto "), { "type": "text", "text": "en negrita", "marks": [{ "type": "bold" }] }] },
            { "type": "bulletList", "content": [
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("uno")] }] },
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("dos")] }] }
            ]},
            { "type": "orderedList", "attrs": { "start": 3 }, "content": [
                { "type": "listItem", "content": [{ "type": "paragraph", "content": [text("tercero")] }] }
            ]},
            { "type": "horizontalRule" },
            { "type": "blockquote", "content": [{ "type": "paragraph", "content": [text("cita")] }] },
            { "type": "codeBlock", "content": [text("cargo test")] },
            { "type": "table", "content": [
                { "type": "tableRow", "content": [
                    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [text("A")] }] },
                    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [text("B")] }] }
                ]}
            ]}
        ]));
        let digest = digest(&json).expect("digest");
        assert_eq!(
            digest.text,
            "Plan\nTexto en negrita\n- uno\n- dos\n3. tercero\n---\ncita\ncargo test\nA | B"
        );
        assert_eq!(digest.words, 13);
    }

    #[test]
    fn extracts_checklist_items_and_attachments() {
        let json = doc(json!([
            { "type": "taskList", "content": [
                { "type": "taskItem", "attrs": { "checked": true }, "content": [{ "type": "paragraph", "content": [text("Comprar café")] }] },
                { "type": "taskItem", "attrs": { "checked": false }, "content": [{ "type": "paragraph", "content": [text("Llamar")] }] }
            ]},
            { "type": "noteImage", "attrs": { "attachmentId": "img-1", "fileName": "foto.png" } },
            { "type": "noteFile", "attrs": { "attachmentId": "pdf-1", "fileName": "guía.pdf" } },
            { "type": "noteImage", "attrs": { "attachmentId": "img-1", "fileName": "foto.png" } }
        ]));
        let digest = digest(&json).expect("digest");
        assert_eq!(
            digest.checklist,
            vec![
                ("Comprar café".to_string(), true),
                ("Llamar".to_string(), false)
            ]
        );
        assert_eq!(digest.attachment_ids, vec!["img-1", "pdf-1"]);
        assert!(digest.text.contains("[x] Comprar café"));
        assert!(digest.text.contains("[Archivo: guía.pdf]"));
    }

    #[test]
    fn rejects_invalid_or_oversized_documents() {
        assert!(digest("no es json").is_err());
        assert!(digest(&json!({ "type": "paragraph" }).to_string()).is_err());
        assert!(digest(&doc(json!([{ "content": [] }]))).is_err());
        let mut deep = json!({ "type": "paragraph", "content": [text("x")] });
        for _ in 0..70 {
            deep = json!({ "type": "blockquote", "content": [deep] });
        }
        assert!(digest(&doc(json!([deep]))).is_err());
        let huge =
            doc(json!([{ "type": "paragraph", "content": [text(&"a".repeat(MAX_JSON_BYTES))] }]));
        assert!(digest(&huge).is_err());
    }

    #[test]
    fn empty_document_has_no_text() {
        let digest = digest(&doc(json!([{ "type": "paragraph" }]))).expect("digest");
        assert_eq!(digest, Digest::default());
    }
}
