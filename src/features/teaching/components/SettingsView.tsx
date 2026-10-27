import { FormEvent, useState } from "react";
import { AnimatePresence } from "../lib/motion";
import { CalendarRange, Clock3, Database, FileDown, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { useResource } from "../lib/useResource";
import { expandBlocks } from "../lib/timeBlocks";
import type { AcademicPeriodRow, TimeBlocks } from "../types";
import { Modal } from "./Modal";

type Props = {
  courseId: number | null;
  databasePath: string;
  /** Solo se puede importar con Docencia vacía. */
  canImport: boolean;
  onImportDesktop: () => void;
  onImportDjango: () => void;
  onBackup: () => void;
  /** Se llama al guardar la configuración del curso, para actualizar la lista de cursos. */
  onCourseSaved: () => Promise<void>;
};

export function SettingsView({
  courseId,
  databasePath,
  canImport,
  onImportDesktop,
  onImportDjango,
  onBackup,
  onCourseSaved,
}: Props) {
  const { run } = useAppActions();
  const { data: periodRows, reload: reloadPeriods } = useResource(() => api.periods(), []);
  const { data: settings, reload: reloadSettings } = useResource(
    () => (courseId ? api.courseSettings(courseId) : Promise.resolve(null)),
    [courseId],
  );
  const periods = periodRows ?? [];
  const { data: storedBlocks, reload: reloadBlocks } = useResource(() => api.timeBlocks(), []);
  const [period, setPeriod] = useState<AcademicPeriodRow | "new" | null>(null);

  async function submitPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await run(async () => {
      await api.savePeriod({
        id: period === "new" ? null : (period?.id ?? null),
        name: String(data.get("name") ?? ""),
        startDate: String(data.get("startDate") ?? ""),
        endDate: String(data.get("endDate") ?? ""),
        isActive: data.get("isActive") === "on",
        isClosed: data.get("isClosed") === "on",
      });
      await reloadPeriods();
    }, "Periodo guardado.");
    if (saved) setPeriod(null);
  }
  async function deletePeriod(periodId: number) {
    if (!confirm("¿Eliminar este periodo?")) return;
    await run(async () => {
      await api.deletePeriod(periodId);
      await reloadPeriods();
    }, "Periodo eliminado.");
  }
  async function submitCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const data = new FormData(event.currentTarget);
    await run(async () => {
      await api.saveCourseSettings({
        id: settings.id,
        title: String(data.get("title") ?? ""),
        code: String(data.get("code") ?? ""),
        groupName: String(data.get("groupName") ?? ""),
        periodLabel: String(data.get("periodLabel") ?? ""),
        academicPeriodId: Number(data.get("academicPeriodId")) || null,
        professor: String(data.get("professor") ?? ""),
        passingGrade: Number(data.get("passingGrade")),
        attendanceMinimum: Number(data.get("attendanceMinimum")),
        lowGradeAlert: Number(data.get("lowGradeAlert")),
        lowAttendanceAlert: Number(data.get("lowAttendanceAlert")),
        promotionRequiresAttendance: data.get("promotionRequiresAttendance") === "on",
        isArchived: data.get("isArchived") === "on",
      });
      await Promise.all([reloadSettings(), reloadPeriods(), onCourseSaved()]);
    }, "Configuración del curso guardada.");
  }
  return (
    <div className="view-stack">
      <div className="settings-grid">
        <section className="panel settings-card">
          <span className="eyebrow">DATOS LOCALES</span>
          <h3>Base de FlowDesk y respaldos</h3>
          <p>Docencia se guarda con el resto de FlowDesk. El respaldo copia toda la base.</p>
          <p className="path-value">{databasePath}</p>
          <div className="settings-actions">
            <button className="primary-button" onClick={onBackup}>
              <FileDown size={17} />
              Crear respaldo
            </button>
          </div>
        </section>
        {canImport && (
          <section className="panel settings-card">
            <span className="eyebrow">IMPORTAR</span>
            <h3>Traer tus datos</h3>
            <p>Copia materias, estudiantes, asistencia y notas. El archivo original no se modifica.</p>
            <div className="settings-actions">
              <button className="primary-button" onClick={onImportDesktop}>
                <Database size={17} />
                Control Docente
              </button>
              <button className="secondary-button" onClick={onImportDjango}>
                <Database size={17} />
                Versión Django
              </button>
            </div>
          </section>
        )}
      </div>
      {storedBlocks && <BlocksSection key={JSON.stringify(storedBlocks)} stored={storedBlocks} onSaved={reloadBlocks} />}
      {settings && (
        <section className="panel settings-section">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">CURSO ACTUAL</span>
              <h3>Identidad y reglas académicas</h3>
            </div>
          </div>
          <form className="form-grid settings-form" onSubmit={submitCourse}>
            <label>
              <span>Asignatura</span>
              <input name="title" required defaultValue={settings.title} />
            </label>
            <label>
              <span>Código</span>
              <input name="code" defaultValue={settings.code} />
            </label>
            <label>
              <span>Grupo</span>
              <input name="groupName" defaultValue={settings.groupName} />
            </label>
            <label>
              <span>Docente</span>
              <input name="professor" defaultValue={settings.professor} />
            </label>
            <label>
              <span>Periodo académico</span>
              <select name="academicPeriodId" defaultValue={settings.academicPeriodId ?? ""}>
                <option value="">Sin periodo estructurado</option>
                {periods.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Etiqueta de periodo</span>
              <input name="periodLabel" defaultValue={settings.periodLabel} />
            </label>
            <label>
              <span>Nota mínima (%)</span>
              <input
                name="passingGrade"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={settings.passingGrade}
              />
            </label>
            <label>
              <span>Asistencia mínima (%)</span>
              <input
                name="attendanceMinimum"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={settings.attendanceMinimum}
              />
            </label>
            <label>
              <span>Alerta de nota (%)</span>
              <input
                name="lowGradeAlert"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={settings.lowGradeAlert}
              />
            </label>
            <label>
              <span>Alerta de asistencia (%)</span>
              <input
                name="lowAttendanceAlert"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={settings.lowAttendanceAlert}
              />
            </label>
            <label className="check-label">
              <input
                name="promotionRequiresAttendance"
                type="checkbox"
                defaultChecked={settings.promotionRequiresAttendance}
              />
              <span>Exigir asistencia para aprobar</span>
            </label>
            <label className="check-label">
              <input name="isArchived" type="checkbox" defaultChecked={settings.isArchived} />
              <span>Archivar este curso (sale del calendario y archiva su proyecto)</span>
            </label>
            <div className="form-actions span-2">
              <button className="primary-button">Guardar configuración</button>
            </div>
          </form>
        </section>
      )}
      <section className="panel settings-section">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CALENDARIO ACADÉMICO</span>
            <h3>Periodos</h3>
          </div>
          <button className="primary-button" onClick={() => setPeriod("new")}>
            <Plus size={16} />
            Nuevo periodo
          </button>
        </div>
        <div className="period-grid">
          {periods.map((item) => (
            <article key={item.id}>
              <CalendarRange />
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.startDate} — {item.endDate}
                </span>
                <small>
                  {item.courseCount} curso(s) ·{" "}
                  {item.isClosed ? "Cerrado" : item.isActive ? "Activo" : "Inactivo"}
                </small>
              </div>
              <div className="row-actions">
                <button onClick={() => setPeriod(item)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="danger"
                  disabled={item.courseCount > 0}
                  title={item.courseCount > 0 ? "Tiene cursos asociados" : "Eliminar"}
                  onClick={() => void deletePeriod(item.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
          {!periods.length && (
            <div className="empty-table">Aún no has creado periodos académicos.</div>
          )}
        </div>
      </section>
      <AnimatePresence>
        {period && (
          <Modal
            eyebrow="PERIODOS"
            title={period === "new" ? "Nuevo periodo" : "Editar periodo"}
            onClose={() => setPeriod(null)}
          >
            <form className="form-grid" onSubmit={submitPeriod}>
              <label className="span-2">
                <span>Nombre *</span>
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={period === "new" ? "" : period.name}
                />
              </label>
              <label>
                <span>Fecha inicial</span>
                <input
                  name="startDate"
                  type="date"
                  required
                  defaultValue={period === "new" ? "" : period.startDate}
                />
              </label>
              <label>
                <span>Fecha final</span>
                <input
                  name="endDate"
                  type="date"
                  required
                  defaultValue={period === "new" ? "" : period.endDate}
                />
              </label>
              <label className="check-label">
                <input
                  name="isActive"
                  type="checkbox"
                  defaultChecked={period === "new" || period.isActive}
                />
                <span>Periodo activo</span>
              </label>
              <label className="check-label">
                <input
                  name="isClosed"
                  type="checkbox"
                  defaultChecked={period !== "new" && period.isClosed}
                />
                <span>Periodo cerrado</span>
              </label>
              <div className="form-actions span-2">
                <button className="primary-button">Guardar periodo</button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Bloques horarios de la institución, para elegir las horas del horario como en la hoja oficial. */
function BlocksSection({ stored, onSaved }: { stored: TimeBlocks; onSaved: () => Promise<void> }) {
  const { run } = useAppActions();
  const [blocks, setBlocks] = useState(stored);
  const preview = expandBlocks(blocks);
  const changed = JSON.stringify(blocks) !== JSON.stringify(stored);
  const number = (key: "minutes" | "gap" | "count") => (event: React.ChangeEvent<HTMLInputElement>) =>
    setBlocks((value) => ({ ...value, [key]: Math.max(0, Math.round(Number(event.target.value) || 0)) }));

  return (
    <section className="panel settings-section">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">HORARIO</span>
          <h3>Bloques horarios de la institución</h3>
        </div>
        <Clock3 size={18} />
      </div>
      <div className="form-grid settings-form">
        <label>
          <span>Primer bloque</span>
          <input type="time" value={blocks.first} onChange={(event) => setBlocks((value) => ({ ...value, first: event.target.value }))} />
        </label>
        <label>
          <span>Duración (min)</span>
          <input type="number" min={5} max={240} value={blocks.minutes} onChange={number("minutes")} />
        </label>
        <label>
          <span>Descanso entre bloques (min)</span>
          <input type="number" min={0} max={60} value={blocks.gap} onChange={number("gap")} />
        </label>
        <label>
          <span>Bloques al día</span>
          <input type="number" min={1} max={30} value={blocks.count} onChange={number("count")} />
        </label>
        <p className="span-2 muted-text">
          {preview.length
            ? `${preview[0].start}–${preview[0].end} · ${preview[1] ? `${preview[1].start}–${preview[1].end} · … · ` : ""}${preview[preview.length - 1].start}–${preview[preview.length - 1].end}`
            : "Sin bloques"}
        </p>
        <div className="form-actions span-2">
          <button className="primary-button" disabled={!changed} onClick={() => void run(async () => {
            await api.saveTimeBlocks(blocks);
            await onSaved();
          }, "Bloques horarios guardados.")}>
            Guardar bloques
          </button>
        </div>
      </div>
    </section>
  );
}
