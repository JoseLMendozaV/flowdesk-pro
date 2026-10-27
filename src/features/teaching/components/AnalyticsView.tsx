import { AlertTriangle, CheckCircle2, ClipboardCheck, GraduationCap } from "lucide-react";
import { api } from "../lib/api";
import { useResource } from "../lib/useResource";
import { LoadingPill } from "./LoadingPill";

function Bars({
  items,
  suffix = "",
}: {
  items: Array<{ label: string; value: number }>;
  suffix?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="bar-chart">
      {items.map((item, index) => (
        <div className="bar-row" key={item.label}>
          <span>{item.label}</span>
          <div>
            <i
              style={{ width: `${(item.value / max) * 100}%` }}
              className={`bar-tone-${index % 4}`}
            />
          </div>
          <strong>
            {item.value.toFixed(suffix ? 1 : 0)}
            {suffix}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsView({ courseId }: { courseId: number }) {
  const { data: analytics, loading } = useResource(() => api.analytics(courseId), [courseId]);
  if (!analytics) return loading ? <LoadingPill /> : null;
  const cards = [
    { label: "Estudiantes", value: analytics.totalStudents, icon: GraduationCap, tone: "violet" },
    { label: "Aprobados", value: analytics.approved, icon: CheckCircle2, tone: "emerald" },
    { label: "En riesgo", value: analytics.atRisk, icon: AlertTriangle, tone: "amber" },
    {
      label: "Asistencia",
      value: `${analytics.attendanceAverage.toFixed(1)}%`,
      icon: ClipboardCheck,
      tone: "blue",
    },
  ];
  return (
    <div className="view-stack">
      <section className="stat-grid">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <article className="stat-card compact-stat" key={label}>
            <div className={`icon-chip ${tone}`}>
              <Icon size={19} />
            </div>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="analytics-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RENDIMIENTO</span>
              <h3>Distribución académica</h3>
            </div>
            <span className="metric-callout">
              Promedio {analytics.gradeAverage?.toFixed(1) ?? "—"}
            </span>
          </div>
          <Bars items={analytics.performanceBands} />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ASISTENCIA</span>
              <h3>Niveles del curso</h3>
            </div>
          </div>
          <Bars items={analytics.attendanceBands} />
        </article>
        {analytics.groupPerformance.length > 0 && (
          <article className="panel chart-panel wide-chart">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">EQUIPOS</span>
                <h3>Rendimiento comparado</h3>
              </div>
            </div>
            <Bars items={analytics.groupPerformance} suffix="%" />
          </article>
        )}
      </section>
      <section className="panel risk-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ALERTAS TEMPRANAS</span>
            <h3>Estudiantes que requieren seguimiento</h3>
          </div>
          <span className="count-badge">{analytics.risks.length}</span>
        </div>
        {analytics.risks.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Estudiante</th>
                  <th>Calificación</th>
                  <th>Asistencia</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {analytics.risks.map((item) => (
                  <tr key={item.identification}>
                    <td>
                      <strong>{item.name}</strong>
                      <small className="cell-note">{item.identification}</small>
                    </td>
                    <td>{item.grade?.toFixed(1) ?? "—"}</td>
                    <td>{item.attendance.toFixed(1)}%</td>
                    <td>
                      <span className="risk-badge">
                        <AlertTriangle size={12} />
                        {item.reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-compact risk-empty">
            <CheckCircle2 />
            <strong>No hay alertas activas</strong>
            <span>El curso está dentro de los parámetros definidos.</span>
          </div>
        )}
      </section>
    </div>
  );
}
