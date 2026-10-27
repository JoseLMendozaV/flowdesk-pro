import { Database, FileDown, FileSpreadsheet, GraduationCap, Printer } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { useResource } from "../lib/useResource";
import { LoadingPill } from "./LoadingPill";

export function ReportsView({ courseId }: { courseId: number }) {
  // Solo se imprime el informe: el resto de FlowDesk se oculta mientras dura la impresión.
  function printReport() {
    document.body.classList.add("printing-report");
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-report"), { once: true });
    window.print();
  }
  const { run } = useAppActions();
  const { data: report, loading } = useResource(() => api.report(courseId), [courseId]);
  if (!report) return loading ? <LoadingPill /> : null;
  const fileName = report.course.title || "curso";

  async function exportCsv() {
    const path = await save({
      defaultPath: `${fileName}-informe.csv`,
      filters: [{ name: "Archivo CSV", extensions: ["csv"] }],
    });
    if (path)
      await run(() => api.exportCsv(courseId, path), "Informe CSV exportado correctamente.");
  }

  async function exportExcel() {
    const path = await save({
      defaultPath: `${fileName}-completo.xlsx`,
      filters: [{ name: "Libro de Excel", extensions: ["xlsx"] }],
    });
    if (path) {
      await run(
        () => api.exportExcel(courseId, path),
        "Libro de Excel exportado con estudiantes, asistencia, calificaciones y equipos.",
      );
    }
  }

  return (
    <div className="view-stack report-view">
      <section className="report-hero panel">
        <div>
          <span className="eyebrow">INFORME GENERAL</span>
          <h2>{report.course.title}</h2>
          <p>
            {report.course.groupName}
            {report.course.periodLabel ? ` · ${report.course.periodLabel}` : ""}
          </p>
        </div>
        <div className="report-actions">
          <button className="secondary-button" onClick={printReport}>
            <Printer size={16} />
            Imprimir / PDF
          </button>
          <button className="secondary-button" onClick={() => void exportCsv()}>
            <FileDown size={16} />
            CSV
          </button>
          <button className="primary-button" onClick={() => void exportExcel()}>
            <FileSpreadsheet size={16} />
            Exportar Excel
          </button>
        </div>
      </section>
      <section className="report-summary-grid">
        <div>
          <GraduationCap />
          <strong>{report.activeStudents}</strong>
          <span>Estudiantes activos</span>
        </div>
        <div>
          <Database />
          <strong>{report.sessions}</strong>
          <span>Sesiones</span>
        </div>
        <div>
          <FileDown />
          <strong>{report.evaluations}</strong>
          <span>Evaluaciones</span>
        </div>
        <div>
          <span className="report-symbol">Ø</span>
          <strong>{report.gradeAverage?.toFixed(1) ?? "—"}</strong>
          <span>Promedio general</span>
        </div>
      </section>
      <section className="panel printable-report">
        <div className="print-report-heading">
          <div>
            <h2>FlowDesk · Docencia</h2>
            <p>Resumen académico del curso</p>
          </div>
          <span>
            {new Date(report.generatedAt).toLocaleDateString("es-PA", { dateStyle: "long" })}
          </span>
        </div>
        <div className="print-course">
          <h3>{report.course.title}</h3>
          <p>
            {report.course.code || "Sin código"} · {report.course.groupName || "Sin grupo"} ·{" "}
            {report.course.professor || "Docente"}
          </p>
        </div>
        <div className="print-metrics">
          <div>
            <span>Matrícula total</span>
            <strong>{report.totalStudents}</strong>
          </div>
          <div>
            <span>Asistencia promedio</span>
            <strong>{report.attendanceAverage.toFixed(1)}%</strong>
          </div>
          <div>
            <span>Calificación promedio</span>
            <strong>{report.gradeAverage?.toFixed(1) ?? "—"}</strong>
          </div>
          <div>
            <span>Equipos</span>
            <strong>{report.groups}</strong>
          </div>
        </div>
        <p className="report-footnote">
          Este resumen fue generado localmente por FlowDesk. Los datos permanecen almacenados
          en este equipo.
        </p>
      </section>
    </div>
  );
}
