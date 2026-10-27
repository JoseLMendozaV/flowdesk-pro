//! Hoja de notas del proyecto final de la UTP («Formulario de registro de proyectos
//! finales»): una hoja «Introducción» con los datos del curso y los motivos, y una hoja
//! «GRUPO N» por equipo con sus integrantes, cédula y nota.
//!
//! Se rellena la plantilla oficial que elige el docente sin cambiar su formato
//! (`xlsx_template`). Las celdas se encuentran por sus etiquetas («CÓDIGO DE MATERIA:»,
//! «NOMBRE», «NOTA»…), no por posiciones fijas. La plantilla se guarda en los datos de la
//! app (`plantillas/`), no en el repositorio.

use super::{
    error::{AppError, AppResult},
    xlsx_template::{CellText, CellValue, Template, make_ref},
};
use crate::database::Database;
use chrono::{Datelike, Local};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

const TEMPLATE_DIR: &str = "plantillas";
const TEMPLATE_FILE: &str = "registro-proyectos-finales.xlsx";
const TEMPLATE_NAME_KEY: &str = "teaching_final_sheet_template";
const LAST_SETTINGS_KEY: &str = "teaching_final_sheet:last";

/// Datos de la hoja que no están en la materia, guardados por materia.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FinalSheetSettings {
    pub teacher_name: String,
    pub teacher_identification: String,
    pub career: String,
    pub subject: String,
    pub subject_code: String,
    pub schedule_code: String,
    pub group_name: String,
    pub year: String,
    pub period: String,
    /// Evaluación cuya nota va a la hoja; `None`, la nota final del curso.
    pub evaluation_id: Option<i64>,
    /// Decimales al redondear (0 o 1).
    pub decimals: u8,
    /// Motivos marcados con X (índices de la lista de la plantilla).
    pub reasons: Vec<usize>,
    pub other_reason: String,
    /// «Observaciones al trabajo» de cada equipo, por id del equipo.
    pub team_notes: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub name: String,
    pub groups: usize,
    pub rows_per_group: usize,
    pub reasons: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetEvaluation {
    pub id: i64,
    pub name: String,
    pub grading_mode: String,
    pub max_score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetMember {
    pub name: String,
    pub identification: String,
    /// Nota sobre 100 sin redondear.
    pub grade: Option<f64>,
    /// La que va a la hoja, redondeada.
    pub value: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetTeam {
    pub id: i64,
    pub name: String,
    /// Hoja de la plantilla donde va («GRUPO 1»…), si cabe.
    pub sheet: Option<String>,
    pub members: Vec<SheetMember>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetIssue {
    /// `error` (impide exportar) o `warning`.
    pub level: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalSheetPreview {
    pub settings: FinalSheetSettings,
    pub template: Option<TemplateInfo>,
    pub evaluations: Vec<SheetEvaluation>,
    pub teams: Vec<SheetTeam>,
    /// Estudiantes activos sin equipo: no aparecen en la hoja.
    pub unassigned: Vec<String>,
    pub issues: Vec<SheetIssue>,
    pub can_export: bool,
    pub suggested_file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub teams: usize,
    pub students: usize,
}

/// Minúsculas, sin tildes ni espacios repetidos, sin «:» final.
pub fn normalize(text: &str) -> String {
    let plain: String = text
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            'ñ' => 'n',
            other => other,
        })
        .collect();
    plain
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(':')
        .trim()
        .to_string()
}

/// Redondeo a `decimals` decimales con la mitad hacia arriba (85,5 → 86).
pub fn round_grade(value: f64, decimals: u8) -> f64 {
    let factor = 10_f64.powi(decimals.min(2) as i32);
    // El margen evita que 84,5 calculado como 84,4999… baje.
    ((value * factor) + 1e-9).round() / factor
}

/// Celda a la derecha de una etiqueta, saltando su rango combinado.
fn right_of(label: &CellText, merges: &[(u32, u32, u32, u32)]) -> String {
    let end = merges
        .iter()
        .find(|(column, row, _, _)| *column == label.column && *row == label.row)
        .map_or(label.column, |(_, _, end_column, _)| *end_column);
    make_ref(end + 1, label.row)
}

#[derive(Debug, Default, Clone)]
struct HeaderCells {
    subject_code: Option<String>,
    subject: Option<String>,
    schedule_code: Option<String>,
    year: Option<String>,
    period: Option<String>,
    group: Option<String>,
    teacher: Option<String>,
    teacher_identification: Option<String>,
}

#[derive(Debug, Clone)]
struct GroupLayout {
    sheet: String,
    header: HeaderCells,
    name_column: u32,
    identification_column: u32,
    grade_column: u32,
    rows: Vec<u32>,
    /// Celda de «Observaciones al trabajo» (bajo su título).
    notes: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct IntroLayout {
    sheet: String,
    teacher: Option<String>,
    group: Option<String>,
    career: Option<String>,
    subject: Option<String>,
    subject_code: Option<String>,
    schedule_code: Option<String>,
    /// (texto, celda donde va la X).
    reasons: Vec<(String, String)>,
    other_reason: Option<String>,
}

struct Layout {
    intro: Option<IntroLayout>,
    groups: Vec<GroupLayout>,
}

fn group_number(name: &str) -> Option<u32> {
    normalize(name).strip_prefix("grupo ")?.trim().parse().ok()
}

fn detect_group(template: &mut Template, sheet: &str) -> Result<GroupLayout, String> {
    let cells = template.cells(sheet)?;
    let merges = template.merges(sheet)?;
    let mut header = HeaderCells::default();
    for cell in &cells {
        let raw = cell.text.trim();
        let is_label = raw.ends_with(':');
        let target = Some(right_of(cell, &merges));
        match (normalize(raw).as_str(), is_label) {
            ("codigo de materia", _) => header.subject_code = target,
            ("materia", true) => header.subject = target,
            ("codigo de hora", _) | ("codigo de horario", _) => header.schedule_code = target,
            ("ano", true) => header.year = target,
            ("periodo", true) => header.period = target,
            ("grupo", true) => header.group = target,
            ("docente", true) => header.teacher = target,
            ("cedula", true) => header.teacher_identification = target,
            _ => {}
        }
    }
    let invalid =
        || format!("La hoja «{sheet}» no tiene la tabla de integrantes (NOMBRE, CEDULA, NOTA).");
    let name = cells
        .iter()
        .find(|cell| normalize(&cell.text) == "nombre")
        .ok_or_else(invalid)?;
    let in_header_row = |label: &str| {
        cells
            .iter()
            .find(|cell| cell.row == name.row && normalize(&cell.text) == label)
            .map(|cell| cell.column)
    };
    let identification_column = in_header_row("cedula").ok_or_else(invalid)?;
    let grade_column = in_header_row("nota").ok_or_else(invalid)?;
    // Filas numeradas 1, 2, 3… bajo el encabezado.
    let mut rows = Vec::new();
    for expected in 1.. {
        let row = name.row + expected;
        let numbered = cells.iter().any(|cell| {
            cell.row == row
                && cell.column < name.column
                && cell.text.trim().parse::<f64>().ok() == Some(expected as f64)
        });
        if !numbered {
            break;
        }
        rows.push(row);
    }
    if rows.is_empty() {
        return Err(invalid());
    }
    let notes = cells
        .iter()
        .find(|cell| normalize(&cell.text) == "observaciones al trabajo")
        .map(|cell| make_ref(cell.column, cell.row + 1));
    Ok(GroupLayout {
        notes,
        sheet: sheet.to_string(),
        header,
        name_column: name.column,
        identification_column,
        grade_column,
        rows,
    })
}

fn detect_intro(template: &mut Template, sheet: &str) -> Result<IntroLayout, String> {
    let cells = template.cells(sheet)?;
    let merges = template.merges(sheet)?;
    let mut intro = IntroLayout {
        sheet: sheet.to_string(),
        ..IntroLayout::default()
    };
    let mut reasons_from = u32::MAX;
    for cell in &cells {
        let target = Some(right_of(cell, &merges));
        let label = normalize(&cell.text);
        match label.as_str() {
            "nombre del docente" | "docente" => intro.teacher = target,
            "grupo" => intro.group = target,
            "carrera" => intro.career = target,
            "asignatura" => intro.subject = target,
            "codigo de asignatura" => intro.subject_code = target,
            "codigo de horario" => intro.schedule_code = target,
            _ if label.starts_with("marque con una x") => reasons_from = cell.row,
            _ => {}
        }
    }
    let mut reasons: Vec<&CellText> = cells
        .iter()
        .filter(|cell| {
            let label = normalize(&cell.text);
            cell.row > reasons_from
                && cell.column > 1
                && (label.starts_with("que los alumnos") || label.starts_with("otros"))
        })
        .collect();
    reasons.sort_by_key(|cell| cell.row);
    for cell in reasons {
        if normalize(&cell.text).starts_with("otros") {
            intro.other_reason = Some(make_ref(cell.column, cell.row + 1));
        }
        intro.reasons.push((
            cell.text.trim().to_string(),
            make_ref(cell.column - 1, cell.row),
        ));
    }
    Ok(intro)
}

fn detect(template: &mut Template) -> Result<Layout, String> {
    let names = template.sheet_names();
    let mut group_sheets: Vec<(u32, String)> = names
        .iter()
        .filter_map(|name| group_number(name).map(|number| (number, name.clone())))
        .collect();
    group_sheets.sort();
    if group_sheets.is_empty() {
        return Err(
            "La plantilla no tiene hojas «GRUPO 1», «GRUPO 2»…: no parece el formulario de registro de proyectos finales."
                .into(),
        );
    }
    let mut groups = Vec::new();
    for (_, sheet) in group_sheets {
        groups.push(detect_group(template, &sheet)?);
    }
    let intro = match names
        .iter()
        .find(|name| normalize(name).starts_with("introduccion"))
    {
        Some(sheet) => Some(detect_intro(template, sheet)?),
        None => None,
    };
    Ok(Layout { intro, groups })
}

fn template_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(TEMPLATE_DIR)
        .join(TEMPLATE_FILE))
}

fn info_of(layout: &Layout, name: String) -> TemplateInfo {
    TemplateInfo {
        name,
        groups: layout.groups.len(),
        rows_per_group: layout
            .groups
            .iter()
            .map(|group| group.rows.len())
            .min()
            .unwrap_or(0),
        reasons: layout
            .intro
            .as_ref()
            .map(|intro| intro.reasons.iter().map(|(text, _)| text.clone()).collect())
            .unwrap_or_default(),
    }
}

fn template_info(path: &Path, name: String) -> Result<TemplateInfo, String> {
    let mut template = Template::open(path)?;
    Ok(info_of(&detect(&mut template)?, name))
}

fn setting(connection: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()
}

fn store_setting(connection: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value],
    )?;
    Ok(())
}

fn settings_key(course_id: i64) -> String {
    format!("teaching_final_sheet:{course_id}")
}

/// «II Semestre» según el periodo de clases del calendario académico que incluye hoy o,
/// sin él, según el mes.
fn current_period(connection: &Connection) -> rusqlite::Result<String> {
    let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
    let term: Option<String> = connection
        .query_row(
            "SELECT title FROM academic_calendar WHERE kind = 'term'
             AND starts_on <= ?1 AND ends_on >= ?1 ORDER BY starts_on LIMIT 1",
            [&today],
            |row| row.get(0),
        )
        .optional()?;
    let from_term = term.map(|title| normalize(&title)).and_then(|title| {
        if title.contains("ii semestre") {
            Some("II Semestre")
        } else if title.contains("i semestre") {
            Some("I Semestre")
        } else if title.contains("verano") {
            Some("Verano")
        } else {
            None
        }
    });
    Ok(from_term
        .unwrap_or(match Local::now().month() {
            1 | 2 => "Verano",
            3..=7 => "I Semestre",
            _ => "II Semestre",
        })
        .to_string())
}

pub fn load_settings(connection: &Connection, course_id: i64) -> AppResult<FinalSheetSettings> {
    if let Some(stored) = setting(connection, &settings_key(course_id))?
        .and_then(|value| serde_json::from_str::<FinalSheetSettings>(&value).ok())
    {
        return Ok(stored);
    }
    let (title, code, group, professor): (String, String, String, String) = connection
        .query_row(
            "SELECT title, code, group_name, professor FROM courses WHERE id = ?1",
            [course_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::Validation("La materia ya no existe.".into()))?;
    // Lo del docente y la carrera se toma de la última hoja preparada.
    let last: FinalSheetSettings = setting(connection, LAST_SETTINGS_KEY)?
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();
    // Por defecto, la evaluación que se llame «proyecto» (o «semestral»); si no hay, la nota
    // final del curso. Que sea por equipos no basta: en Docencia suelen serlo todas.
    let evaluation_id: Option<i64> = connection
        .query_row(
            "SELECT id FROM evaluations WHERE course_id = ?1 AND active = 1
             ORDER BY lower(name) LIKE '%proyecto%' DESC, lower(name) LIKE '%semestral%' DESC,
                      grading_mode = 'group' DESC, sort_order DESC, id DESC
             LIMIT 1",
            [course_id],
            |row| row.get(0),
        )
        .optional()?;
    let looks_like_project: bool = match evaluation_id {
        Some(id) => connection.query_row(
            "SELECT lower(name) LIKE '%proyecto%' OR lower(name) LIKE '%semestral%'
             FROM evaluations WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?,
        None => false,
    };
    Ok(FinalSheetSettings {
        teacher_name: if professor.trim().is_empty() {
            last.teacher_name
        } else {
            professor
        },
        teacher_identification: last.teacher_identification,
        career: last.career,
        subject: title,
        subject_code: code,
        schedule_code: String::new(),
        group_name: group,
        year: Local::now().year().to_string(),
        period: current_period(connection)?,
        evaluation_id: evaluation_id.filter(|_| looks_like_project),
        decimals: 0,
        reasons: Vec::new(),
        other_reason: String::new(),
        team_notes: Default::default(),
    })
}

pub fn store_settings(
    connection: &Connection,
    course_id: i64,
    settings: &FinalSheetSettings,
) -> AppResult<()> {
    if settings.decimals > 1 {
        return Err(AppError::Validation(
            "Redondea a enteros o a un decimal.".into(),
        ));
    }
    if let Some(id) = settings.evaluation_id {
        let belongs: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM evaluations WHERE id = ?1 AND course_id = ?2)",
            params![id, course_id],
            |row| row.get(0),
        )?;
        if !belongs {
            return Err(AppError::Validation(
                "Esa evaluación no es de esta materia.".into(),
            ));
        }
    }
    let value =
        serde_json::to_string(settings).map_err(|error| AppError::Validation(error.to_string()))?;
    store_setting(connection, &settings_key(course_id), &value)?;
    store_setting(connection, LAST_SETTINGS_KEY, &value)?;
    Ok(())
}

fn natural_key(text: &str) -> Vec<(String, u64)> {
    let mut parts = Vec::new();
    let mut letters = String::new();
    let mut digits = String::new();
    for character in text.to_lowercase().chars() {
        if character.is_ascii_digit() {
            digits.push(character);
        } else {
            if !digits.is_empty() {
                parts.push((std::mem::take(&mut letters), digits.parse().unwrap_or(0)));
                digits.clear();
            }
            letters.push(character);
        }
    }
    parts.push((letters, digits.parse().unwrap_or(0)));
    parts
}

/// (id y nombre del equipo, si tiene; nombre, cédula y nota sobre 100 del estudiante).
type MemberRow = (Option<i64>, Option<String>, String, String, Option<f64>);

/// Equipos de la materia con sus integrantes activos y la nota de cada uno sobre 100.
fn teams(
    connection: &Connection,
    course_id: i64,
    settings: &FinalSheetSettings,
) -> AppResult<(Vec<SheetTeam>, Vec<String>)> {
    let rows: Vec<MemberRow> = connection
        .prepare(
            "SELECT sg.id, sg.name, st.name, st.identification,
                    CASE WHEN ?2 IS NOT NULL THEN
                        (SELECT g.score / ev.max_score * 100 FROM grades g
                         JOIN evaluations ev ON ev.id = g.evaluation_id
                         WHERE g.enrollment_id = e.id AND g.evaluation_id = ?2 AND g.score IS NOT NULL)
                    ELSE
                        (SELECT SUM(g.score / ev.max_score * ev.weight) / SUM(ev.weight) * 100
                         FROM grades g JOIN evaluations ev ON ev.id = g.evaluation_id
                         WHERE g.enrollment_id = e.id AND ev.course_id = e.course_id AND ev.active = 1
                           AND g.score IS NOT NULL AND ev.max_score > 0)
                    END
             FROM enrollments e
             JOIN students st ON st.id = e.student_id
             LEFT JOIN group_memberships gm ON gm.enrollment_id = e.id
             LEFT JOIN student_groups sg ON sg.id = gm.group_id
             WHERE e.course_id = ?1 AND e.status = 'active'
             ORDER BY st.name COLLATE NOCASE",
        )?
        .query_map(params![course_id, settings.evaluation_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })?
        .collect::<Result<_, _>>()?;
    let mut teams: Vec<(i64, SheetTeam)> = Vec::new();
    let mut unassigned = Vec::new();
    for (team_id, team_name, name, identification, grade) in rows {
        let (Some(team_id), Some(team_name)) = (team_id, team_name) else {
            unassigned.push(name);
            continue;
        };
        let member = SheetMember {
            name,
            identification: identification.trim().to_string(),
            grade,
            value: grade.map(|grade| round_grade(grade, settings.decimals)),
        };
        match teams.iter_mut().find(|(id, _)| *id == team_id) {
            Some((_, team)) => team.members.push(member),
            None => teams.push((
                team_id,
                SheetTeam {
                    id: team_id,
                    name: team_name,
                    sheet: None,
                    members: vec![member],
                },
            )),
        }
    }
    let mut teams: Vec<SheetTeam> = teams.into_iter().map(|(_, team)| team).collect();
    teams.sort_by_key(|team| natural_key(&team.name));
    Ok((teams, unassigned))
}

fn issue(level: &str, message: impl Into<String>) -> SheetIssue {
    SheetIssue {
        level: level.to_string(),
        message: message.into(),
    }
}

fn names(list: &[String]) -> String {
    match list.len() {
        0 => String::new(),
        1..=3 => list.join(", "),
        count => format!("{} y {} más", list[..3].join(", "), count - 3),
    }
}

/// Reparte los equipos en las hojas y revisa lo que falta o no cabe.
fn check(
    settings: &FinalSheetSettings,
    template: Option<&TemplateInfo>,
    teams: &mut [SheetTeam],
    unassigned: &[String],
    sheet_names: &[String],
) -> Vec<SheetIssue> {
    let mut issues = Vec::new();
    match template {
        None => issues.push(issue(
            "error",
            "Elige la plantilla oficial (el Excel «Formato de registro de proyectos») para exportar.",
        )),
        Some(template) => {
            if teams.len() > template.groups {
                issues.push(issue(
                    "error",
                    format!(
                        "Hay {} equipos y la plantilla tiene hojas para {}.",
                        teams.len(),
                        template.groups
                    ),
                ));
            }
            for team in teams.iter() {
                if team.members.len() > template.rows_per_group {
                    issues.push(issue(
                        "error",
                        format!(
                            "«{}» tiene {} integrantes y la hoja admite {}.",
                            team.name,
                            team.members.len(),
                            template.rows_per_group
                        ),
                    ));
                }
            }
            if !template.reasons.is_empty() && settings.reasons.is_empty() {
                issues.push(issue(
                    "warning",
                    "Marca al menos un motivo por el que el proyecto reemplaza el examen semestral.",
                ));
            }
        }
    }
    for (team, sheet) in teams.iter_mut().zip(sheet_names) {
        team.sheet = Some(sheet.clone());
    }
    if teams.is_empty() {
        issues.push(issue(
            "error",
            "La materia no tiene equipos con integrantes. Forma los equipos en «Equipos».",
        ));
    }
    if !unassigned.is_empty() {
        issues.push(issue(
            "warning",
            format!(
                "{} sin equipo no aparecen en la hoja: {}.",
                if unassigned.len() == 1 {
                    "1 estudiante".to_string()
                } else {
                    format!("{} estudiantes", unassigned.len())
                },
                names(unassigned)
            ),
        ));
    }
    let members: Vec<&SheetMember> = teams.iter().flat_map(|team| &team.members).collect();
    let ungraded: Vec<String> = members
        .iter()
        .filter(|member| member.grade.is_none())
        .map(|member| member.name.clone())
        .collect();
    if !ungraded.is_empty() {
        issues.push(issue(
            "warning",
            format!("Sin nota (la celda queda vacía): {}.", names(&ungraded)),
        ));
    }
    let out_of_range: Vec<String> = members
        .iter()
        .filter(|member| {
            member
                .value
                .is_some_and(|value| !(0.0..=100.0).contains(&value))
        })
        .map(|member| member.name.clone())
        .collect();
    if !out_of_range.is_empty() {
        issues.push(issue(
            "error",
            format!("Notas fuera de 0 a 100: {}.", names(&out_of_range)),
        ));
    }
    let without_id: Vec<String> = members
        .iter()
        .filter(|member| member.identification.is_empty())
        .map(|member| member.name.clone())
        .collect();
    if !without_id.is_empty() {
        issues.push(issue(
            "warning",
            format!("Sin cédula: {}.", names(&without_id)),
        ));
    }
    let missing: Vec<&str> = [
        ("nombre del docente", &settings.teacher_name),
        ("cédula del docente", &settings.teacher_identification),
        ("carrera", &settings.career),
        ("asignatura", &settings.subject),
        ("código de asignatura", &settings.subject_code),
        ("código de horario", &settings.schedule_code),
        ("grupo", &settings.group_name),
        ("año", &settings.year),
        ("período", &settings.period),
    ]
    .into_iter()
    .filter(|(_, value)| value.trim().is_empty())
    .map(|(label, _)| label)
    .collect();
    if !missing.is_empty() {
        issues.push(issue("warning", format!("Falta: {}.", missing.join(", "))));
    }
    issues
}

fn file_name(settings: &FinalSheetSettings) -> String {
    let base = format!(
        "Registro de proyectos finales - {}{}",
        settings.subject.trim(),
        if settings.group_name.trim().is_empty() {
            String::new()
        } else {
            format!(" {}", settings.group_name.trim())
        }
    );
    let clean: String = base
        .chars()
        .map(|character| {
            if matches!(character, '/' | '\\' | ':') {
                '-'
            } else {
                character
            }
        })
        .collect();
    format!("{clean}.xlsx")
}

fn prepare(
    connection: &Connection,
    course_id: i64,
    template: Option<(&Path, String)>,
) -> AppResult<FinalSheetPreview> {
    let settings = load_settings(connection, course_id)?;
    let evaluations = connection
        .prepare(
            "SELECT id, name, grading_mode, max_score FROM evaluations
             WHERE course_id = ?1 AND active = 1 ORDER BY sort_order, id",
        )?
        .query_map([course_id], |row| {
            Ok(SheetEvaluation {
                id: row.get(0)?,
                name: row.get(1)?,
                grading_mode: row.get(2)?,
                max_score: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let (mut teams, unassigned) = teams(connection, course_id, &settings)?;
    let (info, sheet_names) = match template {
        Some((path, name)) => {
            let layout = detect(&mut Template::open(path)?)?;
            let sheet_names = layout
                .groups
                .iter()
                .map(|group| group.sheet.clone())
                .collect();
            (Some(info_of(&layout, name)), sheet_names)
        }
        None => (None, Vec::new()),
    };
    let issues = check(
        &settings,
        info.as_ref(),
        &mut teams,
        &unassigned,
        &sheet_names,
    );
    let can_export = !issues.iter().any(|issue| issue.level == "error");
    Ok(FinalSheetPreview {
        suggested_file_name: file_name(&settings),
        settings,
        template: info,
        evaluations,
        teams,
        unassigned,
        issues,
        can_export,
    })
}

fn text(value: &str) -> CellValue {
    if value.trim().is_empty() {
        CellValue::Empty
    } else {
        CellValue::Text(value.trim().to_string())
    }
}

fn set_optional(
    template: &mut Template,
    sheet: &str,
    cell: &Option<String>,
    value: &CellValue,
) -> Result<(), String> {
    match cell {
        Some(cell) => template.set(sheet, cell, value),
        None => Ok(()),
    }
}

/// Rellena la plantilla con los datos y los equipos ya revisados.
pub fn fill(
    template: &mut Template,
    settings: &FinalSheetSettings,
    teams: &[SheetTeam],
) -> Result<(), String> {
    let layout = detect(template)?;
    if let Some(intro) = &layout.intro {
        let sheet = intro.sheet.as_str();
        set_optional(
            template,
            sheet,
            &intro.teacher,
            &text(&settings.teacher_name),
        )?;
        set_optional(template, sheet, &intro.group, &text(&settings.group_name))?;
        set_optional(template, sheet, &intro.career, &text(&settings.career))?;
        set_optional(template, sheet, &intro.subject, &text(&settings.subject))?;
        set_optional(
            template,
            sheet,
            &intro.subject_code,
            &text(&settings.subject_code),
        )?;
        set_optional(
            template,
            sheet,
            &intro.schedule_code,
            &text(&settings.schedule_code),
        )?;
        for (index, (_, cell)) in intro.reasons.iter().enumerate() {
            let marked = settings.reasons.contains(&index);
            template.set(
                sheet,
                cell,
                &if marked {
                    CellValue::Text("X".into())
                } else {
                    CellValue::Empty
                },
            )?;
        }
        set_optional(
            template,
            sheet,
            &intro.other_reason,
            &text(&settings.other_reason),
        )?;
    }
    let year = settings.year.trim();
    let year_value = year
        .parse::<f64>()
        .map(CellValue::Number)
        .unwrap_or_else(|_| text(year));
    for (index, group) in layout.groups.iter().enumerate() {
        let sheet = group.sheet.as_str();
        let header = &group.header;
        // Las hojas que copian el encabezado con fórmulas también reciben su valor calculado.
        set_optional(
            template,
            sheet,
            &header.subject_code,
            &text(&settings.subject_code),
        )?;
        set_optional(template, sheet, &header.subject, &text(&settings.subject))?;
        set_optional(
            template,
            sheet,
            &header.schedule_code,
            &text(&settings.schedule_code),
        )?;
        set_optional(template, sheet, &header.year, &year_value)?;
        set_optional(template, sheet, &header.period, &text(&settings.period))?;
        set_optional(template, sheet, &header.group, &text(&settings.group_name))?;
        set_optional(
            template,
            sheet,
            &header.teacher,
            &text(&settings.teacher_name),
        )?;
        set_optional(
            template,
            sheet,
            &header.teacher_identification,
            &text(&settings.teacher_identification),
        )?;
        let team = teams.get(index);
        let note = team
            .and_then(|team| settings.team_notes.get(&team.id.to_string()))
            .map_or(CellValue::Empty, |note| text(note));
        set_optional(template, sheet, &group.notes, &note)?;
        let members = team.map(|team| team.members.as_slice()).unwrap_or(&[]);
        for (position, row) in group.rows.iter().enumerate() {
            let member = members.get(position);
            template.set(
                sheet,
                &make_ref(group.name_column, *row),
                &member.map_or(CellValue::Empty, |member| text(&member.name)),
            )?;
            template.set(
                sheet,
                &make_ref(group.identification_column, *row),
                &member.map_or(CellValue::Empty, |member| text(&member.identification)),
            )?;
            template.set(
                sheet,
                &make_ref(group.grade_column, *row),
                &member
                    .and_then(|member| member.value)
                    .map_or(CellValue::Empty, CellValue::Number),
            )?;
        }
    }
    template.recalculate_on_open();
    Ok(())
}

#[cfg(test)]
pub fn prepare_for_tests(
    connection: &Connection,
    course_id: i64,
    template: &Path,
) -> FinalSheetPreview {
    prepare(
        connection,
        course_id,
        Some((template, "plantilla.xlsx".into())),
    )
    .expect("preparar")
}

fn stored_template(
    app: &AppHandle,
    connection: &Connection,
) -> AppResult<Option<(PathBuf, String)>> {
    let path = template_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let name = setting(connection, TEMPLATE_NAME_KEY)?.unwrap_or_else(|| TEMPLATE_FILE.to_string());
    Ok(Some((path, name)))
}

fn preview(app: &AppHandle, database: &Database, course_id: i64) -> AppResult<FinalSheetPreview> {
    let connection = database.lock().map_err(|_| AppError::State)?;
    let template = stored_template(app, &connection)?;
    prepare(
        &connection,
        course_id,
        template
            .as_ref()
            .map(|(path, name)| (path.as_path(), name.clone())),
    )
}

#[tauri::command]
pub fn teaching_get_final_sheet(
    course_id: i64,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<FinalSheetPreview> {
    preview(&app, &database, course_id)
}

#[tauri::command]
pub fn teaching_save_final_sheet_settings(
    course_id: i64,
    settings: FinalSheetSettings,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<FinalSheetPreview> {
    {
        let connection = database.lock().map_err(|_| AppError::State)?;
        store_settings(&connection, course_id, &settings)?;
    }
    preview(&app, &database, course_id)
}

/// Comprueba que el archivo es el formulario y guarda una copia privada en los datos de la app.
#[tauri::command]
pub fn teaching_set_final_sheet_template(
    path: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<TemplateInfo> {
    let source = PathBuf::from(&path);
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| TEMPLATE_FILE.to_string());
    let info = template_info(&source, name.clone())?;
    let target = template_path(&app)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::copy(&source, &target)
        .map_err(|error| format!("No se pudo guardar la plantilla: {error}"))?;
    let connection = database.lock().map_err(|_| AppError::State)?;
    store_setting(&connection, TEMPLATE_NAME_KEY, &name)?;
    Ok(info)
}

#[tauri::command]
pub fn teaching_export_final_sheet(
    course_id: i64,
    path: String,
    database: State<'_, Database>,
    app: AppHandle,
) -> AppResult<ExportSummary> {
    let (preview, template_file) = {
        let connection = database.lock().map_err(|_| AppError::State)?;
        let Some((template_file, name)) = stored_template(&app, &connection)? else {
            return Err(AppError::Validation(
                "Elige primero la plantilla oficial.".into(),
            ));
        };
        (
            prepare(&connection, course_id, Some((&template_file, name)))?,
            template_file,
        )
    };
    if let Some(blocking) = preview.issues.iter().find(|issue| issue.level == "error") {
        return Err(AppError::Validation(blocking.message.clone()));
    }
    let mut template = Template::open(&template_file)?;
    fill(&mut template, &preview.settings, &preview.teams)?;
    let target = PathBuf::from(&path);
    let target = if target
        .extension()
        .is_some_and(|extension| extension == "xlsx")
    {
        target
    } else {
        target.with_extension("xlsx")
    };
    template.save(&target)?;
    Ok(ExportSummary {
        teams: preview.teams.len(),
        students: preview.teams.iter().map(|team| team.members.len()).sum(),
    })
}
