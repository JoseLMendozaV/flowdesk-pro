import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Eye,
  EyeOff,
  GraduationCap,
  MapPin,
  SlidersHorizontal,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { kindLabels } from "../lib/timeBlocks";
import { useResource } from "../lib/useResource";
import type { CourseOverview, OverviewLayout, OverviewWidgetId, Page, StudentOverview, StudentStatus } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";
import { StudentProfileModal } from "./StudentProfileModal";

type Props = { courseId: number; navigate: (page: Page) => void };

/** Paneles del Resumen: nombre, explicación y si ocupan todo el ancho. */
const widgetInfo: Record<OverviewWidgetId, { title: string; hint: string; wide: boolean }> = {
  kpis: { title: "Cifras clave", hint: "Estudiantes, asistencia, promedio, aprobando y en riesgo.", wide: true },
  attention: { title: "Requieren atención", hint: "Quién tiene nota o asistencia por debajo de las alertas.", wide: false },
  agenda: { title: "Próximas clases y entregas", hint: "Lo que viene según el horario y la planificación.", wide: false },
  "attendance-trend": { title: "Asistencia por clase", hint: "Qué parte del grupo asistió a cada clase realizada.", wide: true },
  "grade-distribution": { title: "Distribución de notas", hint: "Cuántos estudiantes hay en cada nivel.", wide: false },
  evaluations: { title: "Promedio por evaluación", hint: "Cómo le fue al grupo en cada evaluación.", wide: false },
  students: { title: "Estudiantes", hint: "Nota, asistencia y estado de cada uno, ordenables.", wide: true },
  groups: { title: "Rendimiento por equipo", hint: "Promedio de las notas de cada equipo.", wide: false },
  "quick-actions": { title: "Accesos rápidos", hint: "Pasar lista, calificar, equipos y planificación.", wide: false },
};

const statusMeta: Record<StudentStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  approved: { label: "Aprobando", icon: CheckCircle2, className: "good" },
  at_risk: { label: "En riesgo", icon: AlertTriangle, className: "critical" },
  ungraded: { label: "Sin notas", icon: CircleDashed, className: "neutral" },
};

const pct = (value: number) => `${Number.isInteger(Math.round(value * 10) / 10) ? Math.round(value) : value.toFixed(1)} %`;
const grade = (value: number | null) => (value == null ? "—" : value.toFixed(1));

function dateLabel(value: string | null) {
  if (!value) return "Sin fecha";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

/** «Jue, 29 oct» para una fecha local `AAAA-MM-DD…`. */
function dayLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}

/** Etiqueta de un instante local `AAAA-MM-DD` o `AAAA-MM-DDTHH:MM`. */
function momentLabel(value: string) {
  const hasTime = value.length > 10;
  const date = new Date(hasTime ? value : `${value}T00:00`);
  return date.toLocaleString("es-ES", hasTime ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short" });
}

export function DashboardView({ courseId, navigate }: Props) {
  const { run } = useAppActions();
  const { data: overview, loading, reload } = useResource(() => api.overview(courseId), [courseId]);
  const { data: layout, reload: reloadLayout } = useResource(() => api.overviewLayout(), []);
  const [customizing, setCustomizing] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);

  if (!overview || !layout) return loading ? <LoadingPill /> : null;
  const visible = layout.widgets.filter((widget) => widget.visible);

  const panels: Record<OverviewWidgetId, () => ReactNode> = {
    kpis: () => <Kpis overview={overview} />,
    attention: () => <Attention overview={overview} onOpen={setProfileId} />,
    agenda: () => <Agenda overview={overview} />,
    "attendance-trend": () => <AttendanceTrend overview={overview} />,
    "grade-distribution": () => <GradeDistribution overview={overview} />,
    evaluations: () => <Evaluations overview={overview} />,
    students: () => <StudentsTable overview={overview} onOpen={setProfileId} />,
    groups: () => <Groups overview={overview} />,
    "quick-actions": () => <QuickActions overview={overview} navigate={navigate} />,
  };

  return (
    <div className="view-stack overview">
      <div className="overview-toolbar">
        <div>
          <span className="eyebrow">RESUMEN</span>
          <h2>{overview.course.title}</h2>
        </div>
        <button className="secondary-button" onClick={() => setCustomizing(true)}>
          <SlidersHorizontal size={16} />
          Personalizar
        </button>
      </div>
      {visible.length === 0 ? (
        <div className="feature-empty">
          <EyeOff />
          <h3>No hay paneles visibles</h3>
          <p>Elige en «Personalizar» qué quieres ver en el resumen.</p>
        </div>
      ) : (
        <div className="overview-grid">
          {visible.map(({ id }) => (
            <section key={id} className={`panel overview-panel ${widgetInfo[id].wide ? "wide" : ""}`} aria-label={widgetInfo[id].title}>
              {id !== "kpis" && (
                <div className="panel-heading">
                  <div>
                    <h3>{widgetInfo[id].title}</h3>
                  </div>
                </div>
              )}
              {panels[id]()}
            </section>
          ))}
        </div>
      )}
      {customizing && (
        <CustomizeModal
          layout={layout}
          onClose={() => setCustomizing(false)}
          onSave={async (next) => {
            const saved = await run(async () => {
              await api.saveOverviewLayout(next);
              await reloadLayout();
            }, "Resumen personalizado.");
            if (saved) setCustomizing(false);
          }}
        />
      )}
      {profileId != null && (
        <StudentProfileModal enrollmentId={profileId} onClose={() => setProfileId(null)} onStudentChanged={reload} />
      )}
    </div>
  );
}

function StatTile({ label, value, note, icon: Icon, meter, minimum }: { label: string; value: string; note: string; icon: typeof GraduationCap; meter?: number; minimum?: number }) {
  return (
    <article className="overview-stat">
      <span className="overview-stat-label">
        <Icon size={14} />
        {label}
      </span>
      <strong>{value}</strong>
      {meter != null && (
        <span className="meter" aria-hidden>
          <i style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} />
          {minimum != null && <b style={{ left: `${minimum}%` }} />}
        </span>
      )}
      <small>{note}</small>
    </article>
  );
}

function Kpis({ overview }: { overview: CourseOverview }) {
  const { stats, rules } = overview;
  return (
    <div className="overview-kpis">
      <StatTile icon={GraduationCap} label="Estudiantes activos" value={String(stats.activeStudents)} note={`${stats.studentGroups} equipos`} />
      <StatTile icon={ClipboardCheck} label="Asistencia promedio" value={pct(stats.attendanceAverage)} note={`Mínimo ${pct(rules.attendanceMinimum)} · ${stats.heldSessions} de ${stats.totalSessions} clases realizadas`} meter={stats.attendanceAverage} minimum={rules.attendanceMinimum} />
      <StatTile icon={TrendingUp} label="Promedio del curso" value={grade(stats.gradeAverage)} note={`Para aprobar: ${rules.passingGrade} · sobre ${stats.configuredWeight.toFixed(0)} % evaluado`} meter={stats.gradeAverage ?? undefined} minimum={rules.passingGrade} />
      <article className="overview-stat">
        <span className="overview-stat-label">
          <UsersRound size={14} />
          Situación del grupo
        </span>
        <div className="status-counts">
          {(["approved", "at_risk", "ungraded"] as const).map((status) => {
            const { label, icon: Icon, className } = statusMeta[status];
            const value = status === "approved" ? stats.approved : status === "at_risk" ? stats.atRisk : stats.ungraded;
            return (
              <span key={status} className={`status-pill ${className}`}>
                <Icon size={12} />
                <b>{value}</b> {label.toLowerCase()}
              </span>
            );
          })}
        </div>
        <small>Según las reglas de la materia (Ajustes)</small>
      </article>
    </div>
  );
}

function Attention({ overview, onOpen }: { overview: CourseOverview; onOpen: (id: number) => void }) {
  const risky = overview.students
    .filter((student) => student.status === "at_risk")
    .sort((a, b) => a.attendance - b.attendance || (a.grade ?? 101) - (b.grade ?? 101))
    .slice(0, 8);
  if (!risky.length)
    return (
      <div className="empty-compact">
        <CheckCircle2 size={27} />
        <strong>Todo en orden</strong>
        <span>Nadie está por debajo de las alertas.</span>
      </div>
    );
  return (
    <ul className="overview-list">
      {risky.map((student) => (
        <li key={student.enrollmentId}>
          <button onClick={() => onOpen(student.enrollmentId)} title="Abrir expediente">
            <span className="mini-avatar">{student.name.slice(0, 2).toUpperCase()}</span>
            <span className="overview-list-main">
              <strong>{student.name}</strong>
              <small>{student.reasons.join(" y ")}</small>
            </span>
            <span className="overview-list-values">
              <b>{grade(student.grade)}</b>
              <small>nota</small>
            </span>
            <span className="overview-list-values">
              <b>{pct(student.attendance)}</b>
              <small>asistencia</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Agenda({ overview }: { overview: CourseOverview }) {
  if (!overview.nextClasses.length && !overview.agenda.length)
    return (
      <div className="empty-compact">
        <CalendarClock size={27} />
        <strong>Nada a la vista</strong>
        <span>Añade el horario o la planificación de la materia.</span>
      </div>
    );
  const time = (value: number) => new Date(value * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return (
    <ul className="overview-list agenda">
      {overview.nextClasses.map((item) => (
        <li key={`class-${item.startsAt}`}>
          <span className="agenda-date">{new Date(item.startsAt * 1000).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</span>
          <span className="overview-list-main">
            <strong>{item.kind === "class" ? "Clase" : kindLabels[item.kind]}</strong>
            <small>
              {time(item.startsAt)} – {time(item.endsAt)}
              {item.room && (
                <>
                  {" · "}
                  <MapPin size={10} /> {item.room}
                </>
              )}
            </small>
          </span>
        </li>
      ))}
      {overview.agenda.map((item) => (
        <li key={`${item.kind}-${item.title}-${item.startsAt}`}>
          <span className="agenda-date">{dayLabel(item.startsAt)}</span>
          <span className="overview-list-main">
            <strong>{item.title}</strong>
            <small>{item.kind === "delivery" ? "Entrega" : "Planificación"} · {momentLabel(item.startsAt)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Tooltip de una marca del gráfico: aparece al pasar el ratón o al enfocarla con el teclado. */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const bind = (lines: string[]) => ({
    tabIndex: 0,
    "aria-label": lines.join(". "),
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      setTip({ x: box.left + box.width / 2, y: box.top, lines });
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      setTip({ x: box.left + box.width / 2, y: box.top, lines });
    },
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null),
  });
  const node = tip && (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      <strong>{tip.lines[0]}</strong>
      {tip.lines.slice(1).map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
  return { bind, node };
}

function AttendanceTrend({ overview }: { overview: CourseOverview }) {
  const { bind, node } = useTip();
  const minimum = overview.rules.attendanceMinimum;
  if (!overview.sessions.length)
    return (
      <div className="empty-compact">
        <ClipboardCheck size={27} />
        <strong>Sin clases realizadas</strong>
        <span>Al guardar la asistencia de una clase, aparece aquí.</span>
      </div>
    );
  const unmarked = overview.sessions.filter((session) => session.unmarked > 0).length;
  return (
    <div className="column-chart">
      <div className="column-plot" style={{ ["--minimum" as string]: `${minimum}%` }}>
        <span className="column-axis">
          <i>100 %</i>
          <i>50 %</i>
          <i>0 %</i>
        </span>
        <span className="column-threshold" aria-hidden>
          <em>Mínimo {pct(minimum)}</em>
        </span>
        <div className="column-bars" style={{ gridTemplateColumns: `repeat(${overview.sessions.length}, minmax(0, 1fr))` }}>
          {overview.sessions.map((session) => (
            <span
              key={session.sessionId}
              className={`column ${session.rate < minimum ? "below" : ""}`}
              {...bind([
                `${pct(session.rate)} asistió`,
                `Clase ${session.number} · ${dateLabel(session.date)}`,
                `${session.present} presentes · ${session.late} tardanzas · ${session.excused} justificados`,
                `${session.absent} ausentes${session.unmarked ? ` · ${session.unmarked} sin marcar` : ""}`,
              ])}
            >
              <i style={{ height: `${Math.max(session.rate, 1.5)}%` }} />
            </span>
          ))}
        </div>
      </div>
      <div className="column-labels" style={{ gridTemplateColumns: `repeat(${overview.sessions.length}, minmax(0, 1fr))` }}>
        {overview.sessions.map((session, index) => (
          <span key={session.sessionId}>{overview.sessions.length <= 16 || index % 2 === 0 ? session.number : ""}</span>
        ))}
      </div>
      <p className="chart-note">
        Clases realizadas, por número. Las barras más tenues quedaron por debajo del mínimo.
        {unmarked > 0 && ` ${unmarked} ${unmarked === 1 ? "clase tiene" : "clases tienen"} estudiantes sin marcar, que cuentan como ausentes.`}
      </p>
      {node}
    </div>
  );
}

/** Barras horizontales de un solo color con el valor al final. */
function BarList({ rows, max, format, empty }: { rows: { label: string; value: number | null; detail: string }[]; max: number; format: (value: number) => string; empty: string }) {
  const { bind, node } = useTip();
  if (!rows.length) return <div className="empty-table">{empty}</div>;
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div key={row.label} className="bar-row" {...bind([row.value == null ? "Sin datos" : format(row.value), row.label, row.detail])}>
          <span className="bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="bar-track">
            <i style={{ width: `${row.value == null ? 0 : Math.max((row.value / max) * 100, 1)}%` }} />
          </span>
          <span className="bar-value">{row.value == null ? "—" : format(row.value)}</span>
        </div>
      ))}
      {node}
    </div>
  );
}

function GradeDistribution({ overview }: { overview: CourseOverview }) {
  const graded = overview.gradeBands.reduce((sum, band) => sum + band.value, 0);
  return (
    <BarList
      rows={overview.gradeBands.map((band) => ({
        label: band.label,
        value: band.value,
        detail: graded ? `${Math.round((band.value / graded) * 100)} % de los que tienen notas` : "",
      }))}
      max={Math.max(1, ...overview.gradeBands.map((band) => band.value))}
      format={(value) => `${value} ${value === 1 ? "estudiante" : "estudiantes"}`}
      empty="Aún no hay notas."
    />
  );
}

function Evaluations({ overview }: { overview: CourseOverview }) {
  return (
    <BarList
      rows={overview.evaluations.map((evaluation) => ({
        label: evaluation.name,
        value: evaluation.average,
        detail: `${evaluation.graded} de ${evaluation.total} calificados · peso ${evaluation.weight} %`,
      }))}
      max={100}
      format={(value) => pct(value)}
      empty="No hay evaluaciones activas."
    />
  );
}

function Groups({ overview }: { overview: CourseOverview }) {
  return (
    <BarList
      rows={overview.groups.map((group) => ({ label: group.label, value: group.value, detail: "Promedio de las notas de sus integrantes" }))}
      max={100}
      format={(value) => pct(value)}
      empty="No hay equipos con notas."
    />
  );
}

type SortKey = "name" | "grade" | "attendance" | "absences" | "status";

function StudentsTable({ overview, onOpen }: { overview: CourseOverview; onOpen: (id: number) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "name", descending: false });
  const rows = useMemo(() => {
    const order: Record<StudentStatus, number> = { at_risk: 0, ungraded: 1, approved: 2 };
    const value = (student: StudentOverview) =>
      sort.key === "name" ? student.name.toLocaleLowerCase("es") : sort.key === "status" ? order[student.status] : sort.key === "grade" ? (student.grade ?? -1) : student[sort.key];
    return [...overview.students].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const result = typeof left === "string" ? left.localeCompare(right as string, "es") : (left as number) - (right as number);
      return sort.descending ? -result : result;
    });
  }, [overview.students, sort]);
  const header = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"}>
      <button className="sort-button" onClick={() => setSort((current) => ({ key, descending: current.key === key ? !current.descending : key !== "name" }))}>
        {label}
        {sort.key === key && (sort.descending ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );
  const { passingGrade, attendanceMinimum } = overview.rules;
  return (
    <div className="table-scroll">
      <table className="data-table overview-table">
        <thead>
          <tr>
            {header("name", "Estudiante")}
            {header("grade", "Nota")}
            {header("attendance", "Asistencia")}
            {header("absences", "Ausencias")}
            {header("status", "Estado")}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((student) => {
            const { label, icon: Icon, className } = statusMeta[student.status];
            return (
              <tr key={student.enrollmentId}>
                <td>
                  <div className="student-cell">
                    <div className="mini-avatar">{student.name.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <strong>{student.name}</strong>
                      <small>{student.groupName ?? student.identification}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="cell-meter">
                    <b>{grade(student.grade)}</b>
                    <span className={`meter ${student.grade != null && student.grade < passingGrade ? "low" : ""}`} aria-hidden>
                      <i style={{ width: `${student.grade ?? 0}%` }} />
                    </span>
                  </span>
                </td>
                <td>
                  <span className="cell-meter">
                    <b>{pct(student.attendance)}</b>
                    <span className={`meter ${student.attendance < attendanceMinimum ? "low" : ""}`} aria-hidden>
                      <i style={{ width: `${student.attendance}%` }} />
                    </span>
                  </span>
                </td>
                <td>{student.absences}</td>
                <td>
                  <span className={`status-pill ${className}`} title={student.reasons.join(" y ") || undefined}>
                    <Icon size={12} />
                    {label}
                  </span>
                </td>
                <td>
                  <button className="icon-button" title="Abrir expediente" onClick={() => onOpen(student.enrollmentId)}>
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function QuickActions({ overview, navigate }: { overview: CourseOverview; navigate: (page: Page) => void }) {
  const actions: { page: Page; title: string; note: string; icon: typeof ClipboardCheck; tone: string }[] = [
    { page: "attendance", title: "Registrar asistencia", note: "Marca el estado por cada sesión.", icon: ClipboardCheck, tone: "emerald" },
    { page: "grades", title: "Ingresar calificaciones", note: "Actualiza el libro de notas.", icon: BookOpenCheck, tone: "blue" },
    { page: "groups", title: "Organizar equipos", note: `${overview.stats.studentGroups} equipos configurados.`, icon: UsersRound, tone: "violet" },
    { page: "planning", title: "Revisar planificación", note: "Clases, entregas y reuniones.", icon: CalendarClock, tone: "amber" },
  ];
  return (
    <div className="quick-grid">
      {actions.map(({ page, title, note, icon: Icon, tone }) => (
        <button key={page} onClick={() => navigate(page)}>
          <span className={`quick-icon ${tone}`}>
            <Icon />
          </span>
          <div>
            <strong>{title}</strong>
            <small>{note}</small>
          </div>
          <ArrowUpRight size={18} />
        </button>
      ))}
    </div>
  );
}

function CustomizeModal({ layout, onClose, onSave }: { layout: OverviewLayout; onClose: () => void; onSave: (layout: OverviewLayout) => Promise<void> }) {
  const [widgets, setWidgets] = useState(layout.widgets);
  function move(index: number, offset: number) {
    setWidgets((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + offset, 0, item);
      return next;
    });
  }
  return (
    <Modal eyebrow="RESUMEN" title="Personalizar el resumen" onClose={onClose}>
      <p className="muted-text">Elige qué paneles ver y en qué orden. Se aplica a todas las materias.</p>
      <ol className="customize-list">
        {widgets.map((widget, index) => (
          <li key={widget.id} className={widget.visible ? "" : "hidden-widget"}>
            <label>
              <input
                type="checkbox"
                checked={widget.visible}
                onChange={(event) => setWidgets((current) => current.map((item) => (item.id === widget.id ? { ...item, visible: event.target.checked } : item)))}
              />
              <span>
                <strong>{widgetInfo[widget.id].title}</strong>
                <small>{widgetInfo[widget.id].hint}</small>
              </span>
            </label>
            <span className="row-actions">
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${widgetInfo[widget.id].title}`}>
                <ArrowUp size={13} />
              </button>
              <button type="button" disabled={index === widgets.length - 1} onClick={() => move(index, 1)} aria-label={`Bajar ${widgetInfo[widget.id].title}`}>
                <ArrowDown size={13} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="form-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setWidgets((Object.keys(widgetInfo) as OverviewWidgetId[]).map((id) => ({ id, visible: true })))}
        >
          Restablecer
        </button>
        <button type="button" className="primary-button" onClick={() => void onSave({ widgets })}>
          <Eye size={16} />
          Guardar
        </button>
      </div>
    </Modal>
  );
}
