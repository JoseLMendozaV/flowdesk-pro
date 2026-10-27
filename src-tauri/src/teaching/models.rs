//! Tipos de Docencia (antes Control Docente). Se serializan en camelCase para la interfaz.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub database_path: String,
    pub has_legacy_import: bool,
    pub courses: Vec<CourseSummary>,
    /// Base de la app de escritorio de Control Docente en este Mac, para importarla.
    pub desktop_database: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CourseSummary {
    pub id: i64,
    pub title: String,
    pub code: String,
    pub group_name: String,
    pub period_label: String,
    pub professor: String,
    pub is_archived: bool,
    /// Proyecto de FlowDesk de la materia y su color.
    pub project_id: Option<String>,
    pub color: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseInput {
    pub title: String,
    pub code: String,
    pub group_name: String,
    pub period_label: String,
    pub professor: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentRow {
    pub enrollment_id: i64,
    pub student_id: i64,
    pub identification: String,
    pub name: String,
    pub email: String,
    pub guardian_name: String,
    pub guardian_phone: String,
    pub status: String,
    pub group_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentInput {
    pub identification: String,
    pub name: String,
    pub email: String,
    pub guardian_name: String,
    pub guardian_email: String,
    pub guardian_phone: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceMatrix {
    pub students: Vec<MatrixStudent>,
    pub sessions: Vec<SessionColumn>,
    pub cells: Vec<AttendanceCell>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixStudent {
    pub enrollment_id: i64,
    pub name: String,
    pub identification: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionColumn {
    pub id: i64,
    pub number: i64,
    pub title: String,
    pub date: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub topic: String,
    pub is_held: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceCell {
    pub enrollment_id: i64,
    pub session_id: i64,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceUpdate {
    pub enrollment_id: i64,
    pub session_id: i64,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gradebook {
    pub students: Vec<MatrixStudent>,
    pub evaluations: Vec<EvaluationColumn>,
    pub cells: Vec<GradeCell>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationColumn {
    pub id: i64,
    pub name: String,
    pub evaluation_type: String,
    pub grading_mode: String,
    pub weight: f64,
    pub max_score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeCell {
    pub enrollment_id: i64,
    pub evaluation_id: i64,
    pub score: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeUpdate {
    pub enrollment_id: i64,
    pub evaluation_id: i64,
    pub score: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupGradebook {
    pub groups: Vec<GroupGradeRow>,
    pub evaluations: Vec<EvaluationColumn>,
    pub cells: Vec<GroupGradeCell>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupGradeRow {
    pub group_id: i64,
    pub name: String,
    pub member_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupGradeCell {
    pub group_id: i64,
    pub evaluation_id: i64,
    pub score: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupGradeUpdate {
    pub group_id: i64,
    pub evaluation_id: i64,
    pub score: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub courses: i64,
    pub students: i64,
    pub enrollments: i64,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRow {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub leader_name: Option<String>,
    pub member_count: i64,
    pub members: Vec<GroupMember>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    pub enrollment_id: i64,
    pub name: String,
    pub identification: String,
    pub is_leader: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInput {
    pub id: Option<i64>,
    pub course_id: i64,
    pub name: String,
    pub description: String,
    pub enrollment_ids: Vec<i64>,
    pub leader_enrollment_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationRow {
    pub id: i64,
    pub name: String,
    pub evaluation_type: String,
    pub grading_mode: String,
    pub weight: f64,
    pub max_score: f64,
    pub active: bool,
    pub sort_order: i64,
    pub due_date: Option<String>,
    pub rubric_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationInput {
    pub id: Option<i64>,
    pub course_id: i64,
    pub name: String,
    pub evaluation_type: String,
    pub grading_mode: String,
    pub weight: f64,
    pub max_score: f64,
    pub active: bool,
    pub due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub id: Option<i64>,
    pub course_id: i64,
    pub number: i64,
    pub title: String,
    pub date: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub topic: String,
    pub is_held: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicEventRow {
    pub id: i64,
    pub title: String,
    pub event_type: String,
    pub starts_at: String,
    pub ends_at: Option<String>,
    pub description: String,
    pub reminder_days: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicEventInput {
    pub id: Option<i64>,
    pub course_id: i64,
    pub title: String,
    pub event_type: String,
    pub starts_at: String,
    pub ends_at: Option<String>,
    pub description: String,
    pub reminder_days: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analytics {
    pub total_students: i64,
    pub approved: i64,
    pub at_risk: i64,
    pub ungraded: i64,
    pub attendance_average: f64,
    pub grade_average: Option<f64>,
    pub performance_bands: Vec<ChartValue>,
    pub attendance_bands: Vec<ChartValue>,
    pub group_performance: Vec<ChartValue>,
    pub risks: Vec<RiskStudent>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartValue {
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskStudent {
    pub name: String,
    pub identification: String,
    pub grade: Option<f64>,
    pub attendance: f64,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    pub course: CourseSummary,
    pub generated_at: String,
    pub total_students: i64,
    pub active_students: i64,
    pub sessions: i64,
    pub evaluations: i64,
    pub groups: i64,
    pub grade_average: Option<f64>,
    pub attendance_average: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicPeriodRow {
    pub id: i64,
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    pub is_active: bool,
    pub is_closed: bool,
    pub course_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicPeriodInput {
    pub id: Option<i64>,
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    pub is_active: bool,
    pub is_closed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseSettingsInput {
    pub id: i64,
    pub title: String,
    pub code: String,
    pub group_name: String,
    pub period_label: String,
    pub academic_period_id: Option<i64>,
    pub professor: String,
    pub passing_grade: f64,
    pub attendance_minimum: f64,
    pub low_grade_alert: f64,
    pub low_attendance_alert: f64,
    pub promotion_requires_attendance: bool,
    pub is_archived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseSettings {
    pub id: i64,
    pub title: String,
    pub code: String,
    pub group_name: String,
    pub period_label: String,
    pub academic_period_id: Option<i64>,
    pub professor: String,
    pub passing_grade: f64,
    pub attendance_minimum: f64,
    pub low_grade_alert: f64,
    pub low_attendance_alert: f64,
    pub promotion_requires_attendance: bool,
    pub is_archived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricCriterionRow {
    pub id: i64,
    pub evaluation_id: i64,
    pub name: String,
    pub description: String,
    pub weight: f64,
    pub max_score: f64,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricCriterionInput {
    pub id: Option<i64>,
    pub evaluation_id: i64,
    pub name: String,
    pub description: String,
    pub weight: f64,
    pub max_score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricScoreCell {
    pub enrollment_id: i64,
    pub criterion_id: i64,
    pub score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricMatrix {
    pub students: Vec<MatrixStudent>,
    pub criteria: Vec<RubricCriterionRow>,
    pub cells: Vec<RubricScoreCell>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricScoreInput {
    pub enrollment_id: i64,
    pub criterion_id: i64,
    pub score: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentProfile {
    pub enrollment_id: i64,
    pub name: String,
    pub identification: String,
    pub email: String,
    pub guardian_name: String,
    pub guardian_email: String,
    pub guardian_phone: String,
    pub status: String,
    pub grade: Option<f64>,
    pub attendance: f64,
    pub observations: Vec<ObservationRow>,
    pub grades: Vec<StudentGradeRow>,
    pub recoveries: Vec<RecoveryRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationRow {
    pub id: i64,
    pub category: String,
    pub text: String,
    pub follow_up_date: Option<String>,
    pub resolved: bool,
    pub private: bool,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationInput {
    pub id: Option<i64>,
    pub enrollment_id: i64,
    pub category: String,
    pub text: String,
    pub follow_up_date: Option<String>,
    pub resolved: bool,
    pub private: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentGradeRow {
    pub evaluation_id: i64,
    pub evaluation_name: String,
    pub score: Option<f64>,
    pub max_score: f64,
    pub weight: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRow {
    pub id: i64,
    pub evaluation_id: i64,
    pub evaluation_name: String,
    pub original_score: Option<f64>,
    pub recovery_score: f64,
    pub applied_score: f64,
    pub notes: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInput {
    pub enrollment_id: i64,
    pub evaluation_id: i64,
    pub recovery_score: f64,
    pub notes: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncementRow {
    pub id: i64,
    pub title: String,
    pub body: String,
    pub attachment: String,
    pub published: bool,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncementInput {
    pub id: Option<i64>,
    pub course_id: i64,
    pub title: String,
    pub body: String,
    pub published: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStudentsResult {
    pub created: i64,
    pub updated: i64,
    pub skipped: i64,
}

/// Franja semanal del horario. `weekday`: 1 = lunes … 7 = domingo; horas `HH:MM`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSlot {
    pub id: i64,
    pub course_id: i64,
    /// `class`, `theory` o `lab`.
    pub kind: String,
    pub course_title: String,
    pub group_name: String,
    pub color: String,
    pub weekday: u32,
    pub start_time: String,
    pub end_time: String,
    pub room: String,
    pub starts_on: String,
    pub ends_on: String,
    pub reminder_minutes: Option<i64>,
    /// La clase está en el calendario (no se borró desde allí).
    pub in_calendar: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSlotInput {
    pub id: Option<i64>,
    pub course_id: i64,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub weekday: u32,
    pub start_time: String,
    pub end_time: String,
    pub room: String,
    pub starts_on: String,
    pub ends_on: String,
    pub reminder_minutes: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSessionsResult {
    pub created: i64,
    pub updated: i64,
}

fn default_kind() -> String {
    "class".to_string()
}

/// Bloques horarios de la institución: `count` bloques de `minutes` minutos desde `first`
/// (`HH:MM`), con `gap` minutos entre uno y otro. Sirven para elegir las horas del horario.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeBlocks {
    pub first: String,
    pub minutes: u32,
    pub gap: u32,
    pub count: u32,
}

impl Default for TimeBlocks {
    /// Universidad Tecnológica de Panamá: bloques de 45 minutos de 7:00 a 22:45.
    fn default() -> Self {
        Self {
            first: "07:00".to_string(),
            minutes: 45,
            gap: 5,
            count: 19,
        }
    }
}

/// Reglas de la materia que usa el Resumen.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewRules {
    pub passing_grade: f64,
    pub attendance_minimum: f64,
    pub low_grade_alert: f64,
    pub low_attendance_alert: f64,
    pub promotion_requires_attendance: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewStats {
    pub active_students: i64,
    pub attendance_average: f64,
    pub grade_average: Option<f64>,
    pub configured_weight: f64,
    pub held_sessions: i64,
    pub total_sessions: i64,
    pub active_evaluations: i64,
    pub student_groups: i64,
    pub approved: i64,
    pub at_risk: i64,
    pub ungraded: i64,
}

/// Cómo va un estudiante: nota ponderada (0–100) sobre lo evaluado y asistencia sobre las
/// clases realizadas. `status`: `approved`, `at_risk` o `ungraded`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentOverview {
    pub enrollment_id: i64,
    pub name: String,
    pub identification: String,
    pub group_name: Option<String>,
    pub grade: Option<f64>,
    pub attendance: f64,
    pub absences: i64,
    pub status: String,
    pub reasons: Vec<String>,
}

/// Asistencia de una clase realizada; `rate` cuenta P, T y J sobre los estudiantes activos.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAttendance {
    pub session_id: i64,
    pub number: i64,
    pub date: Option<String>,
    pub present: i64,
    pub late: i64,
    pub excused: i64,
    pub absent: i64,
    pub unmarked: i64,
    pub rate: f64,
}

/// Promedio de una evaluación en porcentaje de su puntaje máximo.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationAverage {
    pub id: i64,
    pub name: String,
    pub weight: f64,
    pub max_score: f64,
    pub due_date: Option<String>,
    pub average: Option<f64>,
    pub graded: i64,
    pub total: i64,
}

/// Entrega (`delivery`) o evento de la planificación (su tipo) en los próximos días.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingItem {
    pub title: String,
    pub kind: String,
    pub starts_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextClass {
    pub starts_at: i64,
    pub ends_at: i64,
    pub kind: String,
    pub room: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseOverview {
    pub course: CourseSummary,
    pub rules: OverviewRules,
    pub stats: OverviewStats,
    pub students: Vec<StudentOverview>,
    pub grade_bands: Vec<ChartValue>,
    pub sessions: Vec<SessionAttendance>,
    pub evaluations: Vec<EvaluationAverage>,
    pub groups: Vec<ChartValue>,
    pub agenda: Vec<UpcomingItem>,
    pub next_classes: Vec<NextClass>,
}

/// Paneles del Resumen en el orden elegido, y si se muestran.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewWidget {
    pub id: String,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewLayout {
    pub widgets: Vec<OverviewWidget>,
}
