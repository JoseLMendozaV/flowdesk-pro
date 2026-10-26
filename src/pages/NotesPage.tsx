import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CheckSquare2,
  ExternalLink,
  ListChecks,
  Paperclip,
  Pin,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useProjects } from "../features/projects/useProjects";
import { useWorkspaces } from "../features/workspaces/useWorkspaces";
import { useDataChanged } from "../hooks/useDataChanged";
import { flowdeskApi } from "../services/flowdeskApi";
import type { Note } from "../types/dashboard";

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

type ContextFilter = "all" | "tasks" | "events" | "attachments" | "checklist" | "pinned";

const contextFilters: { value: ContextFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "tasks", label: "Con tareas" },
  { value: "events", label: "Con eventos" },
  { value: "attachments", label: "Con adjuntos" },
  { value: "checklist", label: "Con pendientes" },
  { value: "pinned", label: "Fijadas" },
];

function matchesContext(note: Note, filter: ContextFilter) {
  const { links } = note;
  switch (filter) {
    case "tasks": return links.taskIds.length > 0;
    case "events": return links.eventIds.length > 0;
    case "attachments": return links.attachmentCount > 0;
    case "checklist": return links.checklistDone < links.checklistTotal;
    case "pinned": return note.pinnedGlobal;
    default: return true;
  }
}

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextFilter, setContextFilter] = useState<ContextFilter>("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const { projects } = useProjects(true);
  const { workspaces } = useWorkspaces();
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const load = useCallback(async () => {
    try {
      setNotes(await flowdeskApi.notes(includeArchived));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);
  useDataChanged(["notes"], () => void load());

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return notes.filter(
      (note) =>
        (!normalized || `${note.title} ${note.content}`.toLocaleLowerCase("es").includes(normalized)) &&
        matchesContext(note, contextFilter) &&
        (!projectFilter || (projectFilter === "none" ? !note.projectId : note.projectId === projectFilter)) &&
        (!workspaceFilter || (workspaceFilter === "none" ? note.links.workspaceIds.length === 0 : note.links.workspaceIds.includes(workspaceFilter))),
    );
  }, [contextFilter, notes, projectFilter, query, workspaceFilter]);
  const filtering = Boolean(query.trim()) || contextFilter !== "all" || Boolean(projectFilter) || Boolean(workspaceFilter);

  async function createNote() {
    try {
      await flowdeskApi.createNote();
      await load();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function toggleArchive(note: Note) {
    await flowdeskApi.archiveNote(note.id, !note.isArchived);
    await load();
  }

  async function remove(note: Note) {
    if (!window.confirm(`¿Eliminar definitivamente “${note.title || "Nota sin título"}”?`)) return;
    await flowdeskApi.deleteNote(note.id);
    await load();
  }

  return (
    <div className="h-full overflow-y-auto">
      <header data-tauri-drag-region="deep" className="sticky top-0 z-10 flex h-[74px] items-end justify-between border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.025em]">Notas</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Ideas disponibles sobre cualquier aplicación</p>
        </div>
        <button type="button" data-tour-id="notes-new" onClick={() => void createNote()} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white shadow-sm">
          <Plus className="size-3.5" /> Nueva nota <kbd className="ml-1 rounded bg-white/15 px-1 py-0.5 text-[9px]">⌥N</kbd>
        </button>
      </header>

      <div data-tour-id="notes-list" className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <label className="flex min-w-0 max-w-sm flex-1 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
            <Search className="size-3.5 text-[var(--muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar notas…" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted)]" />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--muted)]">
            <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} className="accent-[var(--accent)]" />
            Mostrar archivadas
          </label>
        </div>
        <div data-tour-id="notes-filters" className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Filtrar por contexto" className="flex flex-wrap rounded-lg border border-[var(--line)] bg-[var(--inset)] p-0.5">
            {contextFilters.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={contextFilter === option.value} onClick={() => setContextFilter(option.value)} className={`rounded-md px-2.5 py-1 text-[11px] ${contextFilter === option.value ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>
                {option.label}
              </button>
            ))}
          </div>
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label="Filtrar por proyecto" className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-[11px]">
            <option value="">Todos los proyectos</option>
            <option value="none">Sin proyecto</option>
            {projects.filter((project) => !project.archivedAt).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          {workspaces.length > 0 && (
            <select value={workspaceFilter} onChange={(event) => setWorkspaceFilter(event.target.value)} aria-label="Filtrar por espacio" className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-[11px]">
              <option value="">Cualquier espacio</option>
              <option value="none">Sin espacio (globales)</option>
              {workspaces.filter((workspace) => !workspace.isArchived).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          )}
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-500">{error}</div>}
        {loading ? (
          <div className="py-20 text-center text-xs text-[var(--muted)]">Cargando notas locales…</div>
        ) : filtered.length === 0 ? (
          <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-[var(--line)] text-center">
            <div>
              <StickyNote className="mx-auto mb-3 size-7 text-amber-500" />
              <h2 className="text-sm font-semibold">{filtering ? "No hay coincidencias" : "Todavía no hay notas"}</h2>
              {!filtering && <p className="mt-1 text-[11px] text-[var(--muted)]">Pulsa ⌥N para capturar una idea desde cualquier aplicación.</p>}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {filtered.map((note) => (
              <article key={note.id} className={`group relative min-h-44 rounded-2xl border border-black/8 p-4 text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${note.isArchived ? "opacity-55" : ""}`} style={{ backgroundColor: note.color }}>
                <button type="button" onClick={() => void flowdeskApi.showNote(note.id)} className="block w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="line-clamp-1 text-sm font-semibold">{note.title || "Nota sin título"}</h2>
                    <span className="flex flex-none items-center gap-1 opacity-50">
                      {note.pinnedGlobal && <Pin className="size-3" aria-label="Fijada en todos los espacios" />}
                      <ExternalLink className="size-3.5" />
                    </span>
                  </div>
                  {note.projectId && projectById.get(note.projectId) && (
                    <span className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                      <span className="size-1.5 flex-none rounded-full" style={{ backgroundColor: projectById.get(note.projectId)?.color }} />
                      <span className="truncate">{projectById.get(note.projectId)?.name}</span>
                    </span>
                  )}
                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">{note.content || "Nota vacía"}</p>
                  <NoteBadges note={note} />
                </button>
                <footer className="absolute inset-x-4 bottom-3 flex items-center justify-between">
                  <time className="text-[9px] text-slate-500">{dateFormatter.format(new Date(note.updatedAt * 1000))}</time>
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <button type="button" onClick={() => void toggleArchive(note)} title={note.isArchived ? "Restaurar" : "Archivar"} className="grid size-6 place-items-center rounded-md bg-black/5 hover:bg-black/10">
                      {note.isArchived ? <ArchiveRestore className="size-3" /> : <Archive className="size-3" />}
                    </button>
                    <button type="button" onClick={() => void remove(note)} title="Eliminar" className="grid size-6 place-items-center rounded-md bg-black/5 hover:bg-red-500/15 hover:text-red-600"><Trash2 className="size-3" /></button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Distintivos de lo asociado a la nota: listas, adjuntos, tareas y eventos. */
function NoteBadges({ note }: { note: Note }) {
  const { checklistTotal, checklistDone, attachmentCount, taskIds, eventIds } = note.links;
  const badges = [
    checklistTotal > 0 && { icon: ListChecks, label: `${checklistDone}/${checklistTotal}`, title: "Lista de verificación" },
    attachmentCount > 0 && { icon: Paperclip, label: String(attachmentCount), title: "Adjuntos" },
    taskIds.length > 0 && { icon: CheckSquare2, label: String(taskIds.length), title: "Tareas vinculadas" },
    eventIds.length > 0 && { icon: CalendarDays, label: String(eventIds.length), title: "Eventos vinculados" },
  ].filter(Boolean) as { icon: typeof Pin; label: string; title: string }[];
  if (badges.length === 0) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1 pb-4">
      {badges.map(({ icon: Icon, label, title }) => (
        <span key={title} title={title} className="inline-flex items-center gap-1 rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
          <Icon className="size-2.5" /> {label}
        </span>
      ))}
    </span>
  );
}
