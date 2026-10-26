import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckSquare2, FolderKanban, Layers, X } from "lucide-react";
import { flowdeskApi } from "../../../services/flowdeskApi";
import { errorMessage } from "../../../services/format";
import type { CalendarEvent } from "../../../types/calendar";
import type { NoteContextKind, NoteContexts } from "../../../types/notes";
import type { ProjectSummary } from "../../../types/projects";
import type { TaskSummary } from "../../../types/tasks";
import type { Workspace } from "../../../types/workspaces";

const dateFormatter = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type ContextPanelProps = {
  noteId: string;
  projectId: string | null;
  /** El proyecto viaja con el autoguardado de la nota, como antes. */
  onProjectChange: (projectId: string | null) => void;
};

/** Proyecto, tareas, espacios y eventos relacionados. Desvincular nunca borra nada. */
export function ContextPanel({ noteId, projectId, onProjectChange }: ContextPanelProps) {
  const [contexts, setContexts] = useState<NoteContexts | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskResults, setTaskResults] = useState<TaskSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void flowdeskApi.noteContexts(noteId).then(setContexts).catch((reason) => setError(errorMessage(reason)));
  }, [noteId]);

  useEffect(() => {
    load();
    const now = Math.floor(Date.now() / 1000);
    void flowdeskApi.projects(false, true).then(setProjects).catch(() => setProjects([]));
    void flowdeskApi.workspaces().then((state) => setWorkspaces(state.workspaces.filter((workspace) => !workspace.isArchived))).catch(() => setWorkspaces([]));
    void flowdeskApi.calendar(now - 7 * 86_400, now + 60 * 86_400).then((range) => setEvents(range.events)).catch(() => setEvents([]));
  }, [load]);

  useEffect(() => {
    const query = taskQuery.trim();
    if (!query) {
      setTaskResults([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      void flowdeskApi.tasks({ view: "all", sort: "due", search: query }).then((tasks) => setTaskResults(tasks.slice(0, 6))).catch(() => setTaskResults([]));
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [taskQuery]);

  async function link(kind: NoteContextKind, entityId: string, linked: boolean) {
    try {
      setContexts(await flowdeskApi.setNoteContext(noteId, kind, entityId, linked));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (!contexts) return error ? <p className="text-[0.7rem] text-red-600">{error}</p> : <p className="text-[0.7rem] text-slate-600">Cargando…</p>;
  const linkedTasks = new Set(contexts.tasks.map((task) => task.id));
  const linkedWorkspaces = new Set(contexts.workspaces.map((workspace) => workspace.id));
  const linkedEvents = new Set(contexts.events.map((event) => event.id));

  return (
    <div className="space-y-3 text-[0.72rem]">
      <section>
        <h3 className="note-section-title"><FolderKanban /> Proyecto</h3>
        <select value={projectId ?? ""} onChange={(event) => onProjectChange(event.target.value || null)} aria-label="Proyecto" className="note-field block w-full">
          <option value="">Sin proyecto</option>
          {projectId && !projects.some((project) => project.id === projectId) && <option value={projectId}>Proyecto actual</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </section>

      <section>
        <h3 className="note-section-title"><CheckSquare2 /> Tareas</h3>
        <ul className="space-y-1">
          {contexts.tasks.map((task) => (
            <li key={task.id} className="note-context-row">
              <span className={`min-w-0 flex-1 truncate ${task.status === "completed" ? "line-through opacity-60" : ""}`}>{task.title}</span>
              <button type="button" onClick={() => void link("task", task.id, false)} aria-label={`Desvincular ${task.title}`} className="note-icon-button"><X /></button>
            </li>
          ))}
        </ul>
        <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Buscar una tarea para vincular…" aria-label="Buscar tarea" className="note-field mt-1 block w-full" />
        {taskResults.filter((task) => !linkedTasks.has(task.id)).map((task) => (
          <button key={task.id} type="button" onClick={() => { void link("task", task.id, true); setTaskQuery(""); }} className="note-context-row mt-1 w-full text-left hover:bg-black/5">
            <span className="min-w-0 flex-1 truncate">+ {task.title}</span>
          </button>
        ))}
      </section>

      <section>
        <h3 className="note-section-title"><Layers /> Espacios de trabajo</h3>
        {workspaces.length === 0 ? (
          <p className="text-slate-600">No hay espacios. Sin espacio, la nota es global.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {workspaces.map((workspace) => {
              const linked = linkedWorkspaces.has(workspace.id);
              return (
                <button key={workspace.id} type="button" aria-pressed={linked} onClick={() => void link("workspace", workspace.id, !linked)} className={`note-chip ${linked ? "is-active" : ""}`}>
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: workspace.color }} /> {workspace.name}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="note-section-title"><CalendarDays /> Eventos</h3>
        <ul className="space-y-1">
          {contexts.events.map((event) => (
            <li key={event.id} className="note-context-row">
              <span className="min-w-0 flex-1 truncate">{event.title}</span>
              {event.at && <span className="flex-none text-[0.62rem] text-slate-600">{dateFormatter.format(new Date(event.at * 1000))}</span>}
              <button type="button" onClick={() => void link("event", event.id, false)} aria-label={`Desvincular ${event.title}`} className="note-icon-button"><X /></button>
            </li>
          ))}
        </ul>
        <select value="" onChange={(event) => event.target.value && void link("event", event.target.value, true)} aria-label="Vincular evento" className="note-field mt-1 block w-full">
          <option value="">Vincular un evento…</option>
          {events.filter((event) => !linkedEvents.has(event.id)).map((event) => (
            <option key={event.id} value={event.id}>{event.title} · {dateFormatter.format(new Date(event.startsAt * 1000))}</option>
          ))}
        </select>
      </section>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
