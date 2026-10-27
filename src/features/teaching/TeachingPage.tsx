import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Database,
  FolderKanban,
  GraduationCap,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { useAppStore, type TeachingTab } from "../../stores/appStore";
import { AnalyticsView } from "./components/AnalyticsView";
import { AttendanceView } from "./components/AttendanceView";
import { DashboardView } from "./components/DashboardView";
import { EvaluationsView } from "./components/EvaluationsView";
import { GradebookView } from "./components/GradebookView";
import { GroupsView } from "./components/GroupsView";
import { LoadingPill } from "./components/LoadingPill";
import { Modal } from "./components/Modal";
import { PlanningView } from "./components/PlanningView";
import { ReportsView } from "./components/ReportsView";
import { ScheduleView } from "./components/ScheduleView";
import { SettingsView } from "./components/SettingsView";
import { StudentsView } from "./components/StudentsView";
import { SyllabusView } from "./components/SyllabusView";
import { api } from "./lib/api";
import { AppActionsContext, type AppActions } from "./lib/app-context";
import { formatTimestamp } from "./lib/dates";
import { AnimatePresence } from "./lib/motion";
import type { Bootstrap } from "./types";
import "./teaching.css";

const tabs: { id: TeachingTab; label: string }[] = [
  { id: "dashboard", label: "Resumen" },
  { id: "schedule", label: "Horario" },
  { id: "students", label: "Estudiantes" },
  { id: "groups", label: "Equipos" },
  { id: "attendance", label: "Asistencia" },
  { id: "syllabus", label: "Plan" },
  { id: "evaluations", label: "Evaluaciones" },
  { id: "grades", label: "Calificaciones" },
  { id: "planning", label: "Planificación" },
  { id: "analytics", label: "Analítica" },
  { id: "reports", label: "Informes" },
  { id: "settings", label: "Ajustes" },
];

/** Docencia: la gestión académica de Control Docente dentro de FlowDesk. */
export default function TeachingPage() {
  const courseId = useAppStore((state) => state.teachingCourseId);
  const setCourseId = useAppStore((state) => state.setTeachingCourseId);
  const page = useAppStore((state) => state.teachingTab);
  const setPage = useAppStore((state) => state.setTeachingTab);
  const setLeaveGuard = useAppStore((state) => state.setLeaveGuard);
  const focusProject = useAppStore((state) => state.focusProject);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [importing, setImporting] = useState(false);
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsavedRef = useRef(false);

  const activeCourses = useMemo(() => bootstrap?.courses.filter((course) => !course.isArchived) ?? [], [bootstrap]);
  const currentCourse = bootstrap?.courses.find((course) => course.id === courseId) ?? null;

  /** Pide confirmación si la vista actual tiene cambios sin guardar. */
  const confirmLeave = useCallback(() => {
    if (!unsavedRef.current) return true;
    if (!window.confirm("Tienes cambios sin guardar. ¿Quieres salir y descartarlos?")) return false;
    unsavedRef.current = false;
    return true;
  }, []);

  // Salir de Docencia por la barra lateral o la paleta también respeta los cambios sin guardar.
  useEffect(() => {
    setLeaveGuard(confirmLeave);
    return () => setLeaveGuard(null);
  }, [confirmLeave, setLeaveGuard]);

  const actions = useMemo<AppActions>(
    () => ({
      notify: (message) => {
        setError(null);
        setNotice(message);
      },
      fail: (cause) => {
        setNotice(null);
        setError(String(cause));
      },
      run: async (action, success) => {
        try {
          await action();
          if (success) {
            setError(null);
            setNotice(success);
          }
          return true;
        } catch (cause) {
          setNotice(null);
          setError(String(cause));
          return false;
        }
      },
      setUnsaved: (unsaved) => {
        unsavedRef.current = unsaved;
      },
    }),
    [],
  );
  const { run } = actions;

  const loadBootstrap = useCallback(
    async (preferredCourse?: number) => {
      try {
        const data = await api.bootstrap();
        setBootstrap(data);
        const current = useAppStore.getState().teachingCourseId;
        const valid = data.courses.some((course) => course.id === (preferredCourse ?? current));
        setCourseId(valid ? (preferredCourse ?? current) : (data.courses.find((course) => !course.isArchived)?.id ?? null));
      } catch (cause) {
        setError(String(cause));
      }
    },
    [setCourseId],
  );

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);
  // El proyecto de una materia puede cambiar de color o nombre desde Proyectos.
  useDataChanged(["projects"], () => void loadBootstrap());

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function navigate(next: TeachingTab) {
    if (next !== page && confirmLeave()) setPage(next);
  }

  function selectCourse(next: number) {
    if (next !== courseId && confirmLeave()) setCourseId(next);
  }

  async function importFrom(kind: "desktop" | "django", knownPath?: string | null) {
    const path =
      knownPath ??
      (await open({
        multiple: false,
        filters: [{ name: "Base SQLite", extensions: ["sqlite3", "sqlite", "db"] }],
      }));
    if (typeof path !== "string") return;
    setImporting(true);
    await run(async () => {
      const result = kind === "desktop" ? await api.importDesktop(path) : await api.importDjango(path);
      await loadBootstrap();
      setPage("dashboard");
      actions.notify(`${result.message} ${result.courses} materias y ${result.students} estudiantes disponibles.`);
    });
    setImporting(false);
  }

  async function createBackup() {
    const path = await save({
      defaultPath: `FlowDesk-${formatTimestamp(new Date().toISOString())}.sqlite3`,
      filters: [{ name: "Base SQLite", extensions: ["sqlite3"] }],
    });
    if (path) await run(() => api.backup(path), "Respaldo creado correctamente.");
  }

  async function submitCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = await run(async () => {
      const id = await api.createCourse({
        title: String(form.get("title") ?? ""),
        code: String(form.get("code") ?? ""),
        groupName: String(form.get("groupName") ?? ""),
        periodLabel: String(form.get("periodLabel") ?? ""),
        professor: String(form.get("professor") ?? ""),
      });
      await loadBootstrap(id);
      setPage("schedule");
    }, "Materia creada. Añade sus clases al horario.");
    if (created) setCreatingCourse(false);
  }

  const showWelcome = bootstrap !== null && courseId == null && page !== "settings";

  return (
    <AppActionsContext.Provider value={actions}>
      <div className="flex h-full min-h-0 flex-col">
        <header data-tauri-drag-region="deep" className="flex-none border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pt-[26px] backdrop-blur-xl">
          <div data-tauri-drag-region="deep" className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-[-0.025em]">Docencia</h1>
              <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                {currentCourse
                  ? [currentCourse.code, currentCourse.groupName, currentCourse.periodLabel, currentCourse.professor].filter(Boolean).join(" · ") || "Materia sin datos de grupo"
                  : "Materias, estudiantes, asistencia, notas y horario"}
              </p>
            </div>
            {bootstrap && bootstrap.courses.length > 0 && (
              <div data-tour-id="teaching-course" className="flex flex-none items-center gap-1.5">
                {currentCourse && <span className="size-2.5 rounded-full" style={{ backgroundColor: currentCourse.color }} />}
                <select
                  value={courseId ?? ""}
                  onChange={(event) => selectCourse(Number(event.target.value))}
                  aria-label="Materia"
                  className="max-w-64 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-[11px] font-medium outline-none"
                >
                  {activeCourses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                      {course.groupName ? ` · ${course.groupName}` : ""}
                    </option>
                  ))}
                  {currentCourse?.isArchived && <option value={currentCourse.id}>{currentCourse.title} (archivada)</option>}
                </select>
                {currentCourse?.projectId && (
                  <button
                    type="button"
                    onClick={() => focusProject(currentCourse.projectId!)}
                    title="Abrir el proyecto de la materia (tareas, notas y tiempo)"
                    aria-label="Abrir el proyecto de la materia"
                    className="grid size-[30px] place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    <FolderKanban className="size-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => setCreatingCourse(true)} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:brightness-105">
                  <Plus className="size-3.5" /> Nueva materia
                </button>
              </div>
            )}
          </div>
          <nav data-tour-id="teaching-tabs" aria-label="Secciones de Docencia" className="-mb-px mt-2.5 flex gap-0.5 overflow-x-auto">
            {tabs.map(({ id, label }) => {
              const active = page === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigate(id)}
                  aria-current={active ? "page" : undefined}
                  disabled={showWelcome && id !== "settings"}
                  className={`flex-none border-b-2 px-2.5 pb-2 pt-1 text-[11px] transition disabled:opacity-40 ${
                    active ? "border-[var(--accent)] font-medium text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="teaching relative min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {notice && (
            <div className="toast success" role="status">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Cerrar aviso">
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="toast error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Cerrar error">
                <X size={16} />
              </button>
            </div>
          )}

          {!bootstrap ? (
            <div className="grid min-h-60 place-items-center text-[var(--muted)]">
              <LoaderCircle className="spin" />
            </div>
          ) : showWelcome ? (
            <Welcome
              desktopDatabase={bootstrap.desktopDatabase}
              canImport={bootstrap.courses.length === 0}
              onImportDesktop={() => void importFrom("desktop", bootstrap.desktopDatabase)}
              onImportDesktopFile={() => void importFrom("desktop")}
              onImportDjango={() => void importFrom("django")}
              onCreate={() => setCreatingCourse(true)}
            />
          ) : (
            <div key={`${page}-${courseId}`}>
              {courseId != null && (
                <>
                  {page === "dashboard" && <DashboardView courseId={courseId} navigate={(next) => navigate(next as TeachingTab)} />}
                  {page === "schedule" && <ScheduleView courseId={courseId} courses={bootstrap.courses} />}
                  {page === "students" && <StudentsView courseId={courseId} />}
                  {page === "groups" && <GroupsView courseId={courseId} />}
                  {page === "attendance" && <AttendanceView courseId={courseId} />}
                  {page === "syllabus" && <SyllabusView courseId={courseId} />}
                  {page === "evaluations" && <EvaluationsView courseId={courseId} />}
                  {page === "grades" && <GradebookView courseId={courseId} />}
                  {page === "planning" && <PlanningView courseId={courseId} />}
                  {page === "analytics" && <AnalyticsView courseId={courseId} />}
                  {page === "reports" && <ReportsView courseId={courseId} />}
                </>
              )}
              {page === "settings" && (
                <SettingsView
                  courseId={courseId}
                  databasePath={bootstrap.databasePath}
                  canImport={bootstrap.courses.length === 0}
                  onImportDesktop={() => void importFrom("desktop", bootstrap.desktopDatabase)}
                  onImportDjango={() => void importFrom("django")}
                  onBackup={() => void createBackup()}
                  onCourseSaved={() => loadBootstrap()}
                />
              )}
            </div>
          )}
          {importing && <LoadingPill />}

          <AnimatePresence>
            {creatingCourse && (
              <Modal eyebrow="DOCENCIA" title="Nueva materia" onClose={() => setCreatingCourse(false)}>
                <CourseForm onSubmit={submitCourse} />
              </Modal>
            )}
          </AnimatePresence>
        </div>
      </div>
    </AppActionsContext.Provider>
  );
}

type WelcomeProps = {
  desktopDatabase: string | null;
  canImport: boolean;
  onImportDesktop: () => void;
  onImportDesktopFile: () => void;
  onImportDjango: () => void;
  onCreate: () => void;
};

function Welcome({ desktopDatabase, canImport, onImportDesktop, onImportDesktopFile, onImportDjango, onCreate }: WelcomeProps) {
  return (
    <section className="welcome-card">
      <div className="welcome-art">
        <GraduationCap size={42} />
      </div>
      <span className="eyebrow">DOCENCIA EN FLOWDESK</span>
      <h2>Tus materias, junto a tu agenda.</h2>
      <p>
        {desktopDatabase
          ? "Encontramos tus datos de Control Docente en este Mac. Impórtalos para conservar materias, estudiantes, asistencia y calificaciones; el archivo original no se modifica."
          : "Importa tus datos de Control Docente o de su versión Django, o empieza creando una materia."}
      </p>
      <div>
        {canImport && desktopDatabase && (
          <button className="primary-button" onClick={onImportDesktop}>
            <Database size={17} />
            Importar Control Docente
          </button>
        )}
        {canImport && !desktopDatabase && (
          <button className="primary-button" onClick={onImportDesktopFile}>
            <Database size={17} />
            Importar Control Docente…
          </button>
        )}
        {canImport && (
          <button className="secondary-button" onClick={onImportDjango}>
            <Database size={17} />
            Desde Django (db.sqlite3)
          </button>
        )}
        <button className="secondary-button" onClick={onCreate}>
          <Plus size={17} />
          Crear materia
        </button>
      </div>
    </section>
  );
}

function CourseForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="span-2">
        <span>Materia *</span>
        <input name="title" required autoFocus placeholder="Ej. Desarrollo de Software VIII" />
      </label>
      <label>
        <span>Código</span>
        <input name="code" placeholder="8408" />
      </label>
      <label>
        <span>Grupo</span>
        <input name="groupName" placeholder="2GS131" />
      </label>
      <label>
        <span>Periodo</span>
        <input name="periodLabel" placeholder="Segundo semestre" />
      </label>
      <label>
        <span>Docente</span>
        <input name="professor" placeholder="Nombre del docente" />
      </label>
      <p className="span-2 muted-text">Se crea también un proyecto en FlowDesk para sus tareas, notas y tiempo.</p>
      <div className="form-actions span-2">
        <button className="primary-button">Crear materia</button>
      </div>
    </form>
  );
}
