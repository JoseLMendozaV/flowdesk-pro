import { useEffect, useMemo, useRef, useState } from "react";
import { KanbanSquare, List, LoaderCircle, Plus, Search } from "lucide-react";
import { errorMessage, noonTodayUnix } from "../../services/format";
import { flowdeskApi } from "../../services/flowdeskApi";
import { useAppStore } from "../../stores/appStore";
import type { ProjectSummary } from "../../types/projects";
import type { TaskFilter, TaskPriority, TaskSort, TaskStatus, TaskSummary, TaskView } from "../../types/tasks";
import { KanbanBoard } from "./KanbanBoard";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { TaskRow } from "./TaskRow";
import { priorityOptions, sortOptions, viewOptions } from "./taskMeta";
import { useTags, useTasks } from "./useTasks";

const selectClass =
  "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]";

const emptyMessages: Record<TaskView, string> = {
  today: "Nada pendiente para hoy. Las tareas vencidas también aparecen aquí.",
  upcoming: "No hay tareas programadas a partir de mañana.",
  all: "No hay tareas abiertas con estos filtros.",
  completed: "Todavía no has completado tareas con estos filtros.",
};

type TaskWorkspaceProps = {
  view: TaskView;
  onViewChange: (view: TaskView) => void;
  projects: ProjectSummary[];
  /** Limita el espacio a un proyecto (vista de detalle de proyecto). */
  fixedProjectId?: string;
};

export function TaskWorkspace({ view, onViewChange, projects, fixedProjectId }: TaskWorkspaceProps) {
  const layout = useAppStore((state) => state.taskLayout);
  const setLayout = useAppStore((state) => state.setTaskLayout);
  const tags = useTags();
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [tagId, setTagId] = useState("");
  const [sort, setSort] = useState<TaskSort>("due");
  const [showClosed, setShowClosed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const focusedTaskId = useAppStore((state) => state.focusedTaskId);
  const clearFocusedTask = useAppStore((state) => state.clearFocusedTask);

  // Tarea pedida desde otra sección (por ejemplo, el calendario); el detalle de proyecto no la toma.
  useEffect(() => {
    if (!focusedTaskId || fixedProjectId) return;
    setSelectedId(focusedTaskId);
    clearFocusedTask();
  }, [clearFocusedTask, fixedProjectId, focusedTaskId]);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const composerRef = useRef<HTMLInputElement>(null);

  const kanban = layout === "kanban" && view !== "completed";
  const filter: TaskFilter = {
    view,
    sort,
    search,
    projectId: fixedProjectId ?? (projectId || null),
    priority: priority || null,
    tagId: tagId || null,
    includeCompleted: kanban || showClosed,
  };
  const { tasks, setTasks, loading, error } = useTasks(filter);

  // En Kanban las canceladas no tienen columna.
  const visibleTasks = useMemo(() => (kanban ? tasks.filter((task) => task.status !== "cancelled") : tasks), [kanban, tasks]);
  const openCount = tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length;

  async function changeStatus(task: TaskSummary, status: TaskStatus) {
    setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status } : item)));
    try {
      await flowdeskApi.setTaskStatus(task.id, status);
      setActionError(null);
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  }

  function toggle(task: TaskSummary) {
    void changeStatus(task, task.status === "completed" ? "pending" : "completed");
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const filteredProject = projectId && projectId !== "none" ? projectId : null;
      const task = await flowdeskApi.createTask({
        title,
        dueAt: view === "today" ? noonTodayUnix() : null,
        dueHasTime: false,
        projectId: fixedProjectId ?? filteredProject,
        priority: priority || undefined,
      });
      setNewTitle("");
      setActionError(null);
      if (view === "completed" || view === "upcoming") setSelectedId(task.id);
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      setCreating(false);
      composerRef.current?.focus();
    }
  }

  return (
    <div className={`grid min-h-0 flex-1 ${selectedId ? "grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1"}`}>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-6 py-3">
          <div role="tablist" aria-label="Vista de tareas" data-tour-id="tasks-views" className="flex rounded-lg border border-[var(--line)] bg-[var(--inset)] p-0.5">
            {viewOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={view === option.value}
                onClick={() => onViewChange(option.value)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition ${view === option.value ? "bg-[var(--surface)] font-medium text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex min-w-36 flex-1 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5">
            <Search className="size-3.5 flex-none text-[var(--muted)]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} placeholder="Buscar en título, descripción o etiquetas…" aria-label="Buscar tareas" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[var(--muted)]" />
          </label>
          <div className="flex rounded-lg border border-[var(--line)] bg-[var(--inset)] p-0.5" role="group" aria-label="Disposición" data-tour-id="tasks-layout">
            <button type="button" onClick={() => setLayout("list")} aria-pressed={layout === "list"} aria-label="Vista de lista" title="Lista" className={`grid size-7 place-items-center rounded-md ${layout === "list" ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--muted)]"}`}>
              <List className="size-3.5" />
            </button>
            <button type="button" onClick={() => setLayout("kanban")} aria-pressed={layout === "kanban"} aria-label="Vista Kanban" title="Kanban" className={`grid size-7 place-items-center rounded-md ${layout === "kanban" ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--muted)]"}`}>
              <KanbanSquare className="size-3.5" />
            </button>
          </div>
        </div>

        <div data-tour-id="tasks-filters" className="flex flex-wrap items-center gap-2 px-6 pt-3">
          {!fixedProjectId && (
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Filtrar por proyecto" className={selectClass}>
              <option value="">Todos los proyectos</option>
              <option value="none">Sin proyecto</option>
              {projects.filter((project) => !project.archivedAt).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          )}
          <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | "")} aria-label="Filtrar por prioridad" className={selectClass}>
            <option value="">Cualquier prioridad</option>
            {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {tags.length > 0 && (
            <select value={tagId} onChange={(event) => setTagId(event.target.value)} aria-label="Filtrar por etiqueta" className={selectClass}>
              <option value="">Todas las etiquetas</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>#{tag.name}</option>)}
            </select>
          )}
          {view !== "completed" && (
            <select value={sort} onChange={(event) => setSort(event.target.value as TaskSort)} aria-label="Ordenar" className={selectClass}>
              {sortOptions.map((option) => <option key={option.value} value={option.value}>Ordenar: {option.label}</option>)}
            </select>
          )}
          {!kanban && (view === "today" || view === "all") && (
            <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} className="accent-[var(--accent)]" />
              {view === "today" ? "Incluir completadas hoy" : "Incluir completadas y canceladas"}
            </label>
          )}
          <span className="ml-auto text-[10px] text-[var(--muted)]">
            {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : `${openCount} abiertas · ${tasks.length} mostradas`}
          </span>
        </div>

        <form onSubmit={(event) => void createTask(event)} data-tour-id="tasks-composer" className="mx-6 mt-3 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 focus-within:border-[var(--accent)]">
          <Plus className="size-4 flex-none text-[var(--accent)]" />
          <input
            ref={composerRef}
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            maxLength={240}
            placeholder={view === "today" ? "Nueva tarea para hoy… (Enter para crear)" : "Nueva tarea… (Enter para crear)"}
            aria-label="Nueva tarea"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted)]"
          />
          {creating && <LoaderCircle className="size-3.5 animate-spin text-[var(--muted)]" />}
        </form>

        {(error || actionError) && <p className="mx-6 mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error ?? actionError}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
          {!loading && visibleTasks.length === 0 && !kanban ? (
            <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-[var(--line)] px-6 text-center text-[11px] text-[var(--muted)]">
              {search || priority || tagId || projectId ? "No hay tareas que coincidan con los filtros." : emptyMessages[view]}
            </div>
          ) : kanban ? (
            <KanbanBoard tasks={visibleTasks} selectedId={selectedId} hideProject={Boolean(fixedProjectId)} onSelect={(task) => setSelectedId(task.id)} onMove={(task, status) => void changeStatus(task, status)} />
          ) : (
            <ul className="space-y-0.5">
              {visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} selected={task.id === selectedId} hideProject={Boolean(fixedProjectId)} onSelect={(value) => setSelectedId(value.id)} onToggle={toggle} />
              ))}
            </ul>
          )}
        </div>
      </div>
      {selectedId && <TaskDetailPanel key={selectedId} taskId={selectedId} projects={projects} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
