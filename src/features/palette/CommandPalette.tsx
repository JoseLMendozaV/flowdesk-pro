import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  CalendarPlus,
  CheckSquare2,
  CircleHelp,
  Clipboard,
  Clock3,
  Focus,
  FolderKanban,
  GraduationCap,
  Home,
  Layers,
  ListTodo,
  Plus,
  Search,
  Settings,
  StickyNote,
  Target,
  Timer,
  Trash2,
} from "lucide-react";
import { useEscape } from "../../hooks/useEscape";
import { flowdeskApi } from "../../services/flowdeskApi";
import { describeDue, errorMessage } from "../../services/format";
import { useAppStore } from "../../stores/appStore";
import type { Note } from "../../types/dashboard";
import type { ProjectSummary } from "../../types/projects";
import type { TaskSummary } from "../../types/tasks";
import type { Workspace } from "../../types/workspaces";
import type { CourseSummary } from "../teaching/bindings/CourseSummary";
import { api as teachingApi } from "../teaching/lib/api";
import { normalizeSearch, matchesQuery } from "./paletteSearch";

type Command = {
  id: string;
  group: string;
  label: string;
  detail?: string;
  icon: ComponentType<{ className?: string }>;
  /** Texto adicional por el que también se encuentra. */
  keywords?: string;
  run: () => unknown;
};

const RESULT_LIMIT = 6;

/** ⌘K: busca tareas, proyectos y notas y ejecuta acciones o navega desde un solo sitio. */
export function CommandPalette() {
  const open = useAppStore((state) => state.paletteOpen);
  const setOpen = useAppStore((state) => state.setPaletteOpen);
  if (!open) return null;
  return <PaletteDialog onClose={() => setOpen(false)} />;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const selectSection = useAppStore((state) => state.selectSection);
  const openTasks = useAppStore((state) => state.openTasks);
  const openQuickTask = useAppStore((state) => state.openQuickTask);
  const openPreferences = useAppStore((state) => state.openPreferences);
  const requestNewEvent = useAppStore((state) => state.requestNewEvent);
  const focusTask = useAppStore((state) => state.focusTask);
  const focusProject = useAppStore((state) => state.focusProject);
  const setTeachingCourseId = useAppStore((state) => state.setTeachingCourseId);
  const setTeachingTab = useAppStore((state) => state.setTeachingTab);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEscape(onClose);

  useEffect(() => {
    inputRef.current?.focus();
    void flowdeskApi.projects(false).then(setProjects).catch(() => setProjects([]));
    void flowdeskApi.notes(false).then(setNotes).catch(() => setNotes([]));
    void teachingApi
      .bootstrap()
      .then((data) => setCourses(data.courses.filter((course) => !course.isArchived)))
      .catch(() => setCourses([]));
    void flowdeskApi
      .workspaces()
      .then((state) => {
        setWorkspaces(state.workspaces.filter((workspace) => !workspace.isArchived));
        setActiveWorkspaceId(state.activeId);
      })
      .catch(() => setWorkspaces([]));
  }, []);

  // Las tareas se buscan en Rust (título, descripción y etiquetas) del espacio activo.
  useEffect(() => {
    const search = query.trim();
    if (search.length < 2) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void flowdeskApi
        .tasks({ view: "all", sort: "due", search })
        .then((found) => !cancelled && setTasks(found.slice(0, RESULT_LIMIT)))
        .catch(() => !cancelled && setTasks([]));
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query]);

  const commands = useMemo<Command[]>(() => {
    const go = (section: Parameters<typeof selectSection>[0]) => () => selectSection(section);
    const actions: Command[] = [
      { id: "new-task", group: "Acciones", label: "Nueva tarea", icon: Plus, keywords: "crear añadir", run: openQuickTask },
      { id: "new-note", group: "Acciones", label: "Nueva nota flotante", icon: StickyNote, keywords: "crear", run: () => flowdeskApi.createNote() },
      { id: "new-event", group: "Acciones", label: "Nuevo evento", icon: CalendarPlus, keywords: "crear calendario agenda cita", run: requestNewEvent },
      {
        id: "start-pomodoro",
        group: "Acciones",
        label: "Empezar un Pomodoro",
        icon: Target,
        keywords: "concentración enfocarme temporizador",
        run: async () => {
          await flowdeskApi.startPomodoro({ sessionType: "focus" });
          selectSection("focus");
        },
      },
      {
        id: "start-timer",
        group: "Acciones",
        label: "Iniciar el cronómetro",
        icon: Timer,
        keywords: "tiempo registrar",
        run: async () => {
          await flowdeskApi.startTimeEntry({});
          selectSection("time");
        },
      },
      { id: "settings", group: "Acciones", label: "Configuración", icon: Settings, keywords: "preferencias ajustes", run: openPreferences },
      { id: "backups", group: "Acciones", label: "Copias de seguridad", icon: Settings, keywords: "respaldo backup restaurar icloud", run: openPreferences },
      { id: "tour", group: "Acciones", label: "Recorrido por FlowDesk", icon: CircleHelp, keywords: "ayuda guía", run: () => flowdeskApi.openOnboarding("tour") },
    ];
    const sections: Command[] = [
      { id: "go-dashboard", group: "Ir a", label: "Inicio", icon: Home, run: go("dashboard") },
      { id: "go-today", group: "Ir a", label: "Tareas de hoy", icon: CheckSquare2, run: () => openTasks("today") },
      { id: "go-upcoming", group: "Ir a", label: "Próximas tareas", icon: ListTodo, run: () => openTasks("upcoming") },
      { id: "go-projects", group: "Ir a", label: "Proyectos", icon: FolderKanban, run: go("projects") },
      { id: "go-notes", group: "Ir a", label: "Notas", icon: StickyNote, run: go("notes") },
      { id: "go-focus", group: "Ir a", label: "Concentración", icon: Focus, keywords: "pomodoro", run: go("focus") },
      { id: "go-time", group: "Ir a", label: "Tiempo", icon: Clock3, run: go("time") },
      { id: "go-clipboard", group: "Ir a", label: "Portapapeles", icon: Clipboard, run: go("clipboard") },
      { id: "go-calendar", group: "Ir a", label: "Calendario", icon: CalendarDays, keywords: "agenda", run: go("calendar") },
      { id: "go-workspaces", group: "Ir a", label: "Espacios", icon: BriefcaseBusiness, run: go("workspaces") },
      { id: "go-teaching", group: "Ir a", label: "Docencia", icon: GraduationCap, keywords: "materias cursos estudiantes notas asistencia control docente", run: go("teaching") },
      {
        id: "go-schedule",
        group: "Ir a",
        label: "Mi horario de clases",
        icon: CalendarDays,
        keywords: "docencia materias semana",
        run: () => {
          setTeachingTab("schedule");
          selectSection("teaching");
        },
      },
      {
        id: "go-syllabus",
        group: "Ir a",
        label: "Plan del curso",
        icon: GraduationCap,
        keywords: "docencia temario temas syllabus preparar clase",
        run: () => {
          setTeachingTab("syllabus");
          selectSection("teaching");
        },
      },
      { id: "go-trash", group: "Ir a", label: "Papelera", icon: Trash2, keywords: "borrado eliminado recuperar restaurar", run: go("trash") },
    ];
    const switchTo = (workspaceId: string | null) => async () => {
      await flowdeskApi.setActiveWorkspace(workspaceId);
    };
    const spaces: Command[] =
      workspaces.length === 0
        ? []
        : [
            ...(activeWorkspaceId
              ? [{ id: "workspace-all", group: "Espacios", label: "Todos los espacios", icon: Layers, keywords: "cambiar espacio", run: switchTo(null) }]
              : []),
            ...workspaces
              .filter((workspace) => workspace.id !== activeWorkspaceId)
              .map((workspace) => ({
                id: `workspace-${workspace.id}`,
                group: "Espacios",
                label: `Cambiar a ${workspace.name}`,
                icon: BriefcaseBusiness,
                keywords: "espacio",
                run: switchTo(workspace.id),
              })),
          ];
    return [...actions, ...sections, ...spaces];
  }, [activeWorkspaceId, openPreferences, openQuickTask, openTasks, requestNewEvent, selectSection, setTeachingTab, workspaces]);

  const results = useMemo<Command[]>(() => {
    const normalized = normalizeSearch(query);
    if (!normalized) return commands;
    const fixed = commands.filter((command) => matchesQuery(normalized, `${command.label} ${command.keywords ?? ""}`));
    const taskResults: Command[] = tasks.map((task) => ({
      id: `task-${task.id}`,
      group: "Tareas",
      label: task.title,
      detail: [task.dueAt ? describeDue(task.dueAt, task.dueHasTime).label : null, task.projectName].filter(Boolean).join(" · "),
      icon: CheckSquare2,
      run: () => focusTask(task.id),
    }));
    const projectResults: Command[] = projects
      .filter((project) => matchesQuery(normalized, `${project.name} ${project.description}`))
      .slice(0, RESULT_LIMIT)
      .map((project) => ({
        id: `project-${project.id}`,
        group: "Proyectos",
        label: project.name,
        detail: `${project.openTaskCount} pendientes`,
        icon: FolderKanban,
        run: () => focusProject(project.id),
      }));
    const noteResults: Command[] = notes
      .filter((note) => matchesQuery(normalized, `${note.title} ${note.content}`))
      .slice(0, RESULT_LIMIT)
      .map((note) => ({
        id: `note-${note.id}`,
        group: "Notas",
        label: note.title || note.content.slice(0, 60) || "Nota sin título",
        detail: note.title ? note.content.slice(0, 80) : undefined,
        icon: StickyNote,
        run: () => flowdeskApi.showNote(note.id),
      }));
    const courseResults: Command[] = courses
      .filter((course) => matchesQuery(normalized, `${course.title} ${course.code} ${course.groupName}`))
      .slice(0, RESULT_LIMIT)
      .map((course) => ({
        id: `course-${course.id}`,
        group: "Materias",
        label: course.title,
        detail: [course.code, course.groupName].filter(Boolean).join(" · "),
        icon: GraduationCap,
        run: () => {
          setTeachingCourseId(course.id);
          setTeachingTab("dashboard");
          selectSection("teaching");
        },
      }));
    return [...fixed, ...taskResults, ...courseResults, ...projectResults, ...noteResults];
  }, [commands, courses, focusProject, focusTask, notes, projects, query, selectSection, setTeachingCourseId, setTeachingTab, tasks]);

  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  async function execute(command: Command | undefined) {
    if (!command) return;
    try {
      await command.run();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function handleKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void execute(results[activeIndex]);
    }
  }

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[70] grid place-items-start bg-black/25 px-4 pt-[14vh] backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Paleta de comandos" className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] shadow-2xl">
        <label className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 py-3">
          <Search className="size-4 text-[var(--muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKey}
            maxLength={200}
            placeholder="Busca tareas, proyectos y notas, o escribe una acción…"
            aria-label="Buscar"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[activeIndex] ? `palette-${results[activeIndex].id}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)] focus-visible:outline-none"
          />
          <kbd className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[9px] text-[var(--muted)]">esc</kbd>
        </label>
        {error && <p className="mx-3 mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}
        <ul ref={listRef} id="palette-results" role="listbox" aria-label="Resultados" className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[11px] text-[var(--muted)]">Nada coincide con «{query.trim()}».</li>}
          {results.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            const Icon = command.icon;
            const active = index === activeIndex;
            return (
              <li key={command.id} role="presentation">
                {header && <div className="px-2.5 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">{header}</div>}
                <div
                  id={`palette-${command.id}`}
                  role="option"
                  aria-selected={active}
                  data-index={index}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => void execute(command)}
                  className={`flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs ${active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : ""}`}
                >
                  <Icon className="size-3.5 flex-none" />
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.detail && <span className="max-w-[45%] flex-none truncate text-[10px] text-[var(--muted)]">{command.detail}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="flex gap-3 border-t border-[var(--line)] px-4 py-2 text-[10px] text-[var(--muted)]">
          <span>↑↓ moverte</span>
          <span>↵ abrir</span>
          <span>esc cerrar</span>
        </footer>
      </div>
    </div>
  );
}
