//! Rellena una plantilla de Excel (.xlsx) sin tocar su formato. Solo cambia el valor de
//! celdas concretas en el XML de las hojas (conserva su estilo `s`, las celdas combinadas,
//! las fórmulas, imágenes y ajustes de impresión) y copia el resto del archivo tal cual.
//!
//! En una celda con fórmula se conserva la fórmula y solo se actualiza el valor calculado
//! que guarda el archivo, para que también se vea bien en programas que no recalculan.

use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    path::Path,
};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

#[derive(Debug, Clone, PartialEq)]
pub enum CellValue {
    Text(String),
    Number(f64),
    Empty,
}

/// Columna (desde 1) y fila (desde 1) de una referencia como `C5`.
pub fn parse_ref(reference: &str) -> Option<(u32, u32)> {
    let letters: String = reference
        .chars()
        .take_while(char::is_ascii_alphabetic)
        .collect();
    let row: u32 = reference[letters.len()..].parse().ok()?;
    if letters.is_empty() || row == 0 {
        return None;
    }
    let column = letters.chars().fold(0_u32, |acc, letter| {
        acc * 26 + (letter.to_ascii_uppercase() as u32 - 64)
    });
    Some((column, row))
}

pub fn make_ref(column: u32, row: u32) -> String {
    let mut letters = Vec::new();
    let mut value = column;
    while value > 0 {
        let rest = (value - 1) % 26;
        letters.push((b'A' + rest as u8) as char);
        value = (value - 1) / 26;
    }
    letters.iter().rev().collect::<String>() + &row.to_string()
}

pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let Some(end) = tail.find(';') else {
            out.push_str(tail);
            return out;
        };
        let entity = &tail[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(character) => out.push(character),
            None => out.push_str(&tail[..=end]),
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Valor de un atributo `name="…"` dentro del texto de una etiqueta de apertura.
fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!(" {name}=\"");
    let start = tag.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    Some(&tag[start..end])
}

/// Texto de todos los `<t>` de un fragmento (cadenas compartidas o en línea).
fn text_runs(fragment: &str) -> String {
    let mut out = String::new();
    let mut rest = fragment;
    while let Some(start) = rest.find("<t") {
        let after = &rest[start + 2..];
        // `<t>` o `<t xml:space=…>`, no `<tabColor>` ni similares.
        if !(after.starts_with('>') || after.starts_with(' ')) {
            rest = after;
            continue;
        }
        let Some(open_end) = after.find('>') else {
            break;
        };
        if after[..open_end].ends_with('/') {
            rest = &after[open_end + 1..];
            continue;
        }
        let body = &after[open_end + 1..];
        let Some(close) = body.find("</t>") else {
            break;
        };
        out.push_str(&unescape(&body[..close]));
        rest = &body[close + 4..];
    }
    out
}

/// Una celda `<c …>` en el XML de la hoja.
struct CellSpan {
    start: usize,
    end: usize,
    /// Texto de la etiqueta de apertura, sin `<c` ni `>` / `/>`.
    attributes: String,
    inner: Option<String>,
}

fn cell_spans(xml: &str) -> Vec<CellSpan> {
    let mut spans = Vec::new();
    let mut from = 0;
    while let Some(found) = xml[from..].find("<c ") {
        let start = from + found;
        let Some(gt) = xml[start..].find('>').map(|offset| start + offset) else {
            break;
        };
        let self_closing = xml[..gt].ends_with('/');
        let attributes = xml[start + 2..if self_closing { gt - 1 } else { gt }].to_string();
        let (end, inner) = if self_closing {
            (gt + 1, None)
        } else {
            match xml[gt..].find("</c>") {
                Some(close) => (gt + close + 4, Some(xml[gt + 1..gt + close].to_string())),
                None => break,
            }
        };
        spans.push(CellSpan {
            start,
            end,
            attributes,
            inner,
        });
        from = end;
    }
    spans
}

#[derive(Debug, Clone)]
pub struct CellText {
    pub column: u32,
    pub row: u32,
    pub text: String,
}

pub struct Template {
    bytes: Vec<u8>,
    shared: Vec<String>,
    /// Nombre de la hoja → ruta en el archivo (`xl/worksheets/sheet1.xml`).
    sheets: Vec<(String, String)>,
    /// XML de las hojas leídas o cambiadas.
    xml: HashMap<String, String>,
    changed: Vec<String>,
    recalculate: bool,
}

fn read_entry(archive: &mut ZipArchive<std::io::Cursor<&[u8]>>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    Some(text)
}

impl Template {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut bytes = Vec::new();
        File::open(path)
            .and_then(|mut file| file.read_to_end(&mut bytes))
            .map_err(|error| format!("No se pudo leer la plantilla: {error}"))?;
        Self::from_bytes(bytes)
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, String> {
        let invalid = || "El archivo no es un libro de Excel (.xlsx).".to_string();
        let (workbook, relationships, shared_xml) = {
            let mut archive =
                ZipArchive::new(std::io::Cursor::new(bytes.as_slice())).map_err(|_| invalid())?;
            (
                read_entry(&mut archive, "xl/workbook.xml").ok_or_else(invalid)?,
                read_entry(&mut archive, "xl/_rels/workbook.xml.rels").ok_or_else(invalid)?,
                read_entry(&mut archive, "xl/sharedStrings.xml").unwrap_or_default(),
            )
        };
        let mut shared = Vec::new();
        let mut rest = shared_xml.as_str();
        while let Some(start) = rest.find("<si>").or_else(|| rest.find("<si ")) {
            let Some(end) = rest[start..].find("</si>") else {
                break;
            };
            shared.push(text_runs(&rest[start..start + end]));
            rest = &rest[start + end + 5..];
        }
        let mut targets = HashMap::new();
        let mut rest = relationships.as_str();
        while let Some(start) = rest.find("<Relationship ") {
            let end = rest[start..]
                .find('>')
                .map_or(rest.len(), |offset| start + offset);
            let tag = &rest[start..end];
            if let (Some(id), Some(target)) = (attribute(tag, "Id"), attribute(tag, "Target")) {
                let target = target.trim_start_matches('/');
                let path = if target.starts_with("xl/") {
                    target.to_string()
                } else {
                    format!("xl/{target}")
                };
                targets.insert(id.to_string(), path);
            }
            rest = &rest[end..];
        }
        let mut sheets = Vec::new();
        let mut rest = workbook.as_str();
        while let Some(start) = rest.find("<sheet ") {
            let end = rest[start..]
                .find('>')
                .map_or(rest.len(), |offset| start + offset);
            let tag = &rest[start..end];
            if let (Some(name), Some(id)) = (attribute(tag, "name"), attribute(tag, "r:id"))
                && let Some(path) = targets.get(id)
            {
                sheets.push((unescape(name), path.clone()));
            }
            rest = &rest[end..];
        }
        if sheets.is_empty() {
            return Err(invalid());
        }
        Ok(Self {
            bytes,
            shared,
            sheets,
            xml: HashMap::new(),
            changed: Vec::new(),
            recalculate: false,
        })
    }

    pub fn sheet_names(&self) -> Vec<String> {
        self.sheets.iter().map(|(name, _)| name.clone()).collect()
    }

    fn path_of(&self, sheet: &str) -> Result<String, String> {
        self.sheets
            .iter()
            .find(|(name, _)| name == sheet)
            .map(|(_, path)| path.clone())
            .ok_or_else(|| format!("La plantilla no tiene la hoja «{sheet}»."))
    }

    fn sheet_xml(&mut self, sheet: &str) -> Result<&mut String, String> {
        let path = self.path_of(sheet)?;
        if !self.xml.contains_key(&path) {
            let mut archive = ZipArchive::new(std::io::Cursor::new(self.bytes.as_slice()))
                .map_err(|error| error.to_string())?;
            let text = read_entry(&mut archive, &path)
                .ok_or_else(|| format!("No se pudo leer la hoja «{sheet}»."))?;
            self.xml.insert(path.clone(), text);
        }
        Ok(self.xml.get_mut(&path).expect("hoja cargada"))
    }

    /// Celdas con texto o número de la hoja (con el valor calculado de las fórmulas).
    pub fn cells(&mut self, sheet: &str) -> Result<Vec<CellText>, String> {
        let shared = self.shared.clone();
        let xml = self.sheet_xml(sheet)?.clone();
        Ok(cell_spans(&xml)
            .into_iter()
            .filter_map(|span| {
                let (column, row) = parse_ref(attribute(&span.attributes, "r")?)?;
                let inner = span.inner?;
                let kind = attribute(&span.attributes, "t").unwrap_or("n");
                let value = inner.find("<v>").and_then(|start| {
                    let end = inner[start..].find("</v>")? + start;
                    Some(unescape(&inner[start + 3..end]))
                });
                let text = match kind {
                    "s" => shared.get(value?.parse::<usize>().ok()?)?.clone(),
                    "inlineStr" => text_runs(&inner),
                    _ => value?,
                };
                Some(CellText { column, row, text })
            })
            .collect())
    }

    /// Rangos combinados de la hoja como (columna inicial, fila inicial, columna final, fila final).
    pub fn merges(&mut self, sheet: &str) -> Result<Vec<(u32, u32, u32, u32)>, String> {
        let xml = self.sheet_xml(sheet)?.clone();
        let mut merges = Vec::new();
        let mut rest = xml.as_str();
        while let Some(start) = rest.find("<mergeCell ") {
            let end = rest[start..]
                .find('>')
                .map_or(rest.len(), |offset| start + offset);
            if let Some((from, until)) =
                attribute(&rest[start..end], "ref").and_then(|range| range.split_once(':'))
                && let (Some(from), Some(until)) = (parse_ref(from), parse_ref(until))
            {
                merges.push((from.0, from.1, until.0, until.1));
            }
            rest = &rest[end..];
        }
        Ok(merges)
    }

    /// Pone el valor de una celda conservando su estilo. En una celda con fórmula solo
    /// cambia el valor calculado guardado.
    pub fn set(&mut self, sheet: &str, reference: &str, value: &CellValue) -> Result<(), String> {
        let (column, row) =
            parse_ref(reference).ok_or_else(|| format!("Celda no válida: {reference}"))?;
        let reference = make_ref(column, row);
        let path = self.path_of(sheet)?;
        let xml = self.sheet_xml(sheet)?;
        let spans = cell_spans(xml);
        let existing = spans
            .iter()
            .find(|span| attribute(&span.attributes, "r") == Some(reference.as_str()));
        match existing {
            Some(span) => {
                let attributes = without_type(&span.attributes);
                let formula = span.inner.as_deref().and_then(formula_element);
                let cell = build_cell(&attributes, formula.as_deref(), value);
                xml.replace_range(span.start..span.end, &cell);
            }
            None => {
                let cell = build_cell(&format!(" r=\"{reference}\""), None, value);
                insert_cell(xml, column, row, &cell)?;
            }
        }
        if !self.changed.contains(&path) {
            self.changed.push(path);
        }
        Ok(())
    }

    /// Pide a Excel recalcular las fórmulas al abrir el libro.
    pub fn recalculate_on_open(&mut self) {
        self.recalculate = true;
    }

    /// Escribe el libro: las hojas cambiadas con su nuevo XML y todo lo demás copiado sin
    /// recomprimir.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let bytes = self.to_bytes()?;
        let temporary = path.with_extension("xlsx.partial");
        std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
        std::fs::rename(&temporary, path).map_err(|error| {
            let _ = std::fs::remove_file(&temporary);
            error.to_string()
        })
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        let mut archive = ZipArchive::new(std::io::Cursor::new(self.bytes.as_slice()))
            .map_err(|error| error.to_string())?;
        let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for index in 0..archive.len() {
            let name = archive
                .by_index_raw(index)
                .and_then(|file| file.name().map(|name| name.to_string()))
                .map_err(|error| error.to_string())?;
            let replacement = if self.changed.contains(&name) {
                self.xml.get(&name).cloned()
            } else if self.recalculate && name == "xl/workbook.xml" {
                read_entry(&mut archive, &name).map(|workbook| full_calc_on_load(&workbook))
            } else {
                None
            };
            match replacement {
                Some(text) => {
                    writer
                        .start_file(name, options)
                        .map_err(|error| error.to_string())?;
                    writer
                        .write_all(text.as_bytes())
                        .map_err(|error| error.to_string())?;
                }
                None => {
                    let file = archive
                        .by_index_raw(index)
                        .map_err(|error| error.to_string())?;
                    writer
                        .raw_copy_file(file)
                        .map_err(|error| error.to_string())?;
                }
            }
        }
        Ok(writer
            .finish()
            .map_err(|error| error.to_string())?
            .into_inner())
    }
}

/// Los atributos de la celda sin `t` (el tipo depende del nuevo valor).
fn without_type(attributes: &str) -> String {
    match attributes.find(" t=\"") {
        Some(start) => {
            let end = attributes[start + 4..]
                .find('"')
                .map_or(attributes.len(), |offset| start + 4 + offset + 1);
            format!("{}{}", &attributes[..start], &attributes[end..])
        }
        None => attributes.to_string(),
    }
}

/// El elemento `<f …>…</f>` o `<f …/>` de una celda, si tiene fórmula.
fn formula_element(inner: &str) -> Option<String> {
    let start = inner.find("<f")?;
    let gt = inner[start..].find('>')? + start;
    if inner[..gt].ends_with('/') {
        return Some(inner[start..=gt].to_string());
    }
    let close = inner[gt..].find("</f>")? + gt;
    Some(inner[start..close + 4].to_string())
}

fn number_text(value: f64) -> String {
    format!("{value}")
}

fn build_cell(attributes: &str, formula: Option<&str>, value: &CellValue) -> String {
    let attributes = attributes.trim_end();
    match (formula, value) {
        (Some(formula), CellValue::Number(number)) => {
            format!(
                "<c{attributes}>{formula}<v>{}</v></c>",
                number_text(*number)
            )
        }
        (Some(formula), CellValue::Text(text)) => {
            format!(
                "<c{attributes} t=\"str\">{formula}<v>{}</v></c>",
                escape(text)
            )
        }
        (Some(formula), CellValue::Empty) => {
            format!("<c{attributes} t=\"str\">{formula}<v></v></c>")
        }
        (None, CellValue::Number(number)) => {
            format!("<c{attributes}><v>{}</v></c>", number_text(*number))
        }
        (None, CellValue::Text(text)) => format!(
            "<c{attributes} t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
            escape(text)
        ),
        (None, CellValue::Empty) => format!("<c{attributes}/>"),
    }
}

/// Añade una celda que no existía, en su fila y en orden de columnas.
fn insert_cell(xml: &mut String, column: u32, row: u32, cell: &str) -> Result<(), String> {
    let row_tag = format!("<row r=\"{row}\"");
    if let Some(row_start) = xml.find(&row_tag) {
        let gt = xml[row_start..].find('>').ok_or("Fila mal formada")? + row_start;
        if xml[..gt].ends_with('/') {
            // `<row …/>` pasa a `<row …>celda</row>`.
            let open = xml[row_start..gt - 1].to_string();
            xml.replace_range(row_start..=gt, &format!("{open}>{cell}</row>"));
            return Ok(());
        }
        let row_end = xml[gt..].find("</row>").ok_or("Fila mal formada")? + gt;
        let insert_at = cell_spans(&xml[gt..row_end])
            .into_iter()
            .find(|span| {
                attribute(&span.attributes, "r")
                    .and_then(parse_ref)
                    .is_some_and(|(other, _)| other > column)
            })
            .map_or(row_end, |span| gt + span.start);
        xml.insert_str(insert_at, cell);
        return Ok(());
    }
    // Fila nueva antes de la primera con un número mayor.
    let new_row = format!("<row r=\"{row}\">{cell}</row>");
    let mut from = 0;
    while let Some(found) = xml[from..].find("<row r=\"") {
        let start = from + found;
        let number: u32 = xml[start + 8..]
            .split('"')
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        if number > row {
            xml.insert_str(start, &new_row);
            return Ok(());
        }
        from = start + 1;
    }
    if let Some(end) = xml.find("</sheetData>") {
        xml.insert_str(end, &new_row);
    } else if let Some(empty) = xml.find("<sheetData/>") {
        xml.replace_range(
            empty..empty + 12,
            &format!("<sheetData>{new_row}</sheetData>"),
        );
    } else {
        return Err("La hoja no tiene datos.".into());
    }
    Ok(())
}

fn full_calc_on_load(workbook: &str) -> String {
    if workbook.contains("fullCalcOnLoad") {
        return workbook.to_string();
    }
    if let Some(start) = workbook.find("<calcPr") {
        let mut out = workbook.to_string();
        out.insert_str(start + 7, " fullCalcOnLoad=\"1\"");
        return out;
    }
    let anchor = workbook
        .find("<extLst")
        .or_else(|| workbook.find("</workbook>"))
        .unwrap_or(workbook.len());
    let mut out = workbook.to_string();
    out.insert_str(anchor, "<calcPr fullCalcOnLoad=\"1\"/>");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_round_trip() {
        assert_eq!(parse_ref("C5"), Some((3, 5)));
        assert_eq!(parse_ref("AA10"), Some((27, 10)));
        assert_eq!(make_ref(27, 10), "AA10");
        assert_eq!(make_ref(7, 31), "G31");
        assert_eq!(parse_ref("5"), None);
    }

    #[test]
    fn cells_keep_their_style_and_formulas() {
        let mut xml = r#"<sheetData><row r="5"><c r="B5" s="13" t="s"><v>0</v></c><c r="C5" s="20"/><c r="E5" s="7"/></row><row r="6"><c r="C6" s="20"><f>'GRUPO 1'!C5</f><v>0</v></c></row><row r="9" spans="1:7"/></sheetData>"#.to_string();
        let span = cell_spans(&xml)
            .into_iter()
            .find(|span| span.attributes.contains("C5"))
            .unwrap();
        let cell = build_cell(
            &without_type(&span.attributes),
            None,
            &CellValue::Text("8408 & <x>".into()),
        );
        xml.replace_range(span.start..span.end, &cell);
        assert!(xml.contains(r#"<c r="C5" s="20" t="inlineStr"><is><t xml:space="preserve">8408 &amp; &lt;x&gt;</t></is></c>"#));
        let span = cell_spans(&xml)
            .into_iter()
            .find(|span| span.attributes.contains("C6"))
            .unwrap();
        let formula = formula_element(span.inner.as_deref().unwrap());
        let cell = build_cell(
            &without_type(&span.attributes),
            formula.as_deref(),
            &CellValue::Text("8408".into()),
        );
        xml.replace_range(span.start..span.end, &cell);
        assert!(xml.contains(r#"<c r="C6" s="20" t="str"><f>'GRUPO 1'!C5</f><v>8408</v></c>"#));
        insert_cell(&mut xml, 4, 5, r#"<c r="D5"><v>1</v></c>"#).unwrap();
        assert!(
            xml.contains(r#"<c r="C5""#) && xml.find(r#"<c r="D5""#) < xml.find(r#"<c r="E5""#)
        );
        insert_cell(&mut xml, 2, 9, r#"<c r="B9"><v>2</v></c>"#).unwrap();
        assert!(xml.contains(r#"<row r="9" spans="1:7"><c r="B9"><v>2</v></c></row>"#));
        insert_cell(&mut xml, 2, 7, r#"<c r="B7"><v>3</v></c>"#).unwrap();
        assert!(xml.find(r#"<row r="7">"#) < xml.find(r#"<row r="9""#));
    }

    #[test]
    fn calc_on_load_is_added_once() {
        let workbook = r#"<workbook><sheets/><calcPr calcId="145621"/></workbook>"#;
        let once = full_calc_on_load(workbook);
        assert_eq!(
            once,
            r#"<workbook><sheets/><calcPr fullCalcOnLoad="1" calcId="145621"/></workbook>"#
        );
        assert_eq!(full_calc_on_load(&once), once);
        assert_eq!(unescape("Educaci&#243;n &amp; m&#xE1;s"), "Educación & más");
    }
}
