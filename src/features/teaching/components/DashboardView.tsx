import { motion } from "../lib/motion";
import {
  ArrowUpRight,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { api } from "../lib/api";
import { useResource } from "../lib/useResource";
import type { Page } from "../types";
import { LoadingPill } from "./LoadingPill";

type Props = { courseId: number; navigate: (page: Page) => void };

const cardMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

export function DashboardView({ courseId, navigate }: Props) {
  const { data: dashboard, loading } = useResource(() => api.dashboard(courseId), [courseId]);
  if (!dashboard) return loading ? <LoadingPill /> : null;
  const { stats } = dashboard;
  const cards = [
    {
      label: "Estudiantes activos",
      value: stats.activeStudents.toString(),
      note: "Matrícula actual",
      icon: GraduationCap,
      tone: "violet",
    },
    {
      label: "Asistencia promedio",
      value: `${stats.attendanceAverage.toFixed(1)}%`,
      note: `${stats.heldSessions} clases realizadas`,
      icon: ClipboardCheck,
      tone: "emerald",
    },
    {
      label: "Promedio del curso",
      value: stats.gradeAverage == null ? "—" : stats.gradeAverage.toFixed(1),
      note: "Sobre el peso evaluado",
      icon: TrendingUp,
      tone: "blue",
    },
    {
      label: "Peso configurado",
      value: `${stats.configuredWeight.toFixed(0)}%`,
      note: `${stats.activeEvaluations} evaluaciones activas`,
      icon: BookOpenCheck,
      tone: "amber",
    },
  ];

  return (
    <div className="view-stack">
      <section className="hero-card">
        <div>
          <span className="eyebrow">PANEL ACADÉMICO</span>
          <h2>Todo tu curso, claro y bajo control.</h2>
          <p>
            Consulta el pulso de {dashboard.course.title} y continúa exactamente donde lo dejaste.
          </p>
        </div>
        <div className="hero-orb">
          <CheckCircle2 size={42} />
        </div>
      </section>

      <section className="stat-grid">
        {cards.map(({ label, value, note, icon: Icon, tone }, index) => (
          <motion.article
            {...cardMotion}
            transition={{ delay: index * 0.055 }}
            className="stat-card"
            key={label}
          >
            <div className={`icon-chip ${tone}`}>
              <Icon size={20} />
            </div>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </motion.article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel pulse-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ACCESOS RÁPIDOS</span>
              <h3>Continúa tu trabajo</h3>
            </div>
          </div>
          <div className="quick-grid">
            <button onClick={() => navigate("attendance")}>
              <span className="quick-icon emerald">
                <ClipboardCheck />
              </span>
              <div>
                <strong>Registrar asistencia</strong>
                <small>Marca el estado por cada sesión.</small>
              </div>
              <ArrowUpRight size={18} />
            </button>
            <button onClick={() => navigate("grades")}>
              <span className="quick-icon blue">
                <BookOpenCheck />
              </span>
              <div>
                <strong>Ingresar calificaciones</strong>
                <small>Actualiza el libro con guardado directo.</small>
              </div>
              <ArrowUpRight size={18} />
            </button>
            <button onClick={() => navigate("groups")}>
              <span className="quick-icon violet">
                <UsersRound />
              </span>
              <div>
                <strong>Organizar equipos</strong>
                <small>{stats.studentGroups} equipos configurados.</small>
              </div>
              <ArrowUpRight size={18} />
            </button>
            <button onClick={() => navigate("planning")}>
              <span className="quick-icon amber">
                <CalendarClock />
              </span>
              <div>
                <strong>Revisar planificación</strong>
                <small>Clases, entregas y reuniones.</small>
              </div>
              <ArrowUpRight size={18} />
            </button>
          </div>
        </article>

        <article className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SEGUIMIENTO</span>
              <h3>Requieren atención</h3>
            </div>
            <span className="count-badge">{dashboard.attention.length}</span>
          </div>
          <div className="attention-list">
            {dashboard.attention.length ? (
              dashboard.attention.map((student) => (
                <div className="attention-row" key={student.enrollmentId}>
                  <div className="mini-avatar">{student.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <strong>{student.name}</strong>
                    <small>{student.identification}</small>
                  </div>
                  <span>{student.attendance.toFixed(0)}%</span>
                </div>
              ))
            ) : (
              <div className="empty-compact">
                <CheckCircle2 size={27} />
                <strong>Todo en orden</strong>
                <span>No hay alertas de asistencia.</span>
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
