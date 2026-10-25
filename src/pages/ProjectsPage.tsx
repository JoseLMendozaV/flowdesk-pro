import { useEffect, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FolderKanban,
  ListTodo,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
} from "lucide-react";
import { DeleteProjectDialog } from "../features/projects/DeleteProjectDialog";
import { ProjectDialog, projectStatusOptions } from "../features/projects/ProjectDialog";
import { useProjects } from "../features/projects/useProjects";
import { TaskWorkspace } from "../features/tasks/TaskWorkspace";
import { useDataChanged } from "../hooks/useDataChanged";
import { flowdeskApi } from "../services/flowdeskApi";
import { errorMessage, formatDate, formatDuration } from "../services/format";
import type { Note } from "../types/dashboard";
import type { ProjectSummary } from "../types/projects";
import type { TaskView } from "../types/tasks";

function statusLabel(project: ProjectSummary) {
  if (project.archivedAt) return "Archivado";
  return projectStatusOptions.find((option) => option.value === project.status)?.label ?? project.status;
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--track)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${value}%`, backgroundColor: color }} />
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={`flex min-h-40 flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-[var(--card-shadow)] transition hover:-translate-y-px hover:border-[var(--line-strong)] ${project.archivedAt ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 size-3 flex-none rounded-[4px]" style={{ backgroundColor: project.color }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold">{project.name}</h2>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">{statusLabel(project)}</p>
        </div>
        {project.overdueTaskCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-500">
            <AlertCircle className="size-3" /> {project.overdueTaskCount}
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 min-h-8 text-[11px] leading-4 text-[var(--muted)]">{project.description || "Sin descripción"}</p>
      <div className="mt-auto pt-3">
        <div className="mb-1.5 flex justify-between text-[10px] text-[var(--muted)]">
          <span>{project.completedTaskCount}/{project.taskCount} tareas</span>
          <span className="font-medium text-[var(--text)]">{Math.round(project.progressPercent)}%</span>
        </div>
        <ProgressBar value={project.progressPercent} color={project.color} />
        <div className="mt-2.5 flex items-center gap-3 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1"><StickyNote className="size-3" /> {project.noteCount}</span>
          <span className="flex items-center gap-1"><Clock3 className="size-3" /> {formatDuration(project.trackedSeconds)}</span>
          {project.targetAt && <span className="ml-auto flex items-center gap-1"><CalendarRange className="size-3" /> {formatDate(project.targetAt)}</span>}
        </div>
      </div>
    </button>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof ListTodo; label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]"><Icon className={`size-3 ${tone}`} /> {label}</div>
      <div className="mt-1 text-lg font-semibold tracking-[-0.03em]">{value}</div>
    </div>
  );
}

function ProjectDetail({ project, projects, onBack }: { project: ProjectSummary; projects: ProjectSummary[]; onBack: () => void }) {
  const [view, setView] = useState<TaskView>("all");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);

  function loadNotes() {
    void flowdeskApi
      .notes(true)
      .then((all) => setNotes(all.filter((note) => note.projectId === project.id)))
      .catch(() => setNotes([]));
  }
  useEffect(loadNotes, [project.id]);
  useDataChanged(["notes"], loadNotes);

  async function toggleArchive() {
    try {
      await flowdeskApi.archiveProject(project.id, !project.archivedAt);
      setDeleting(false);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header data-tauri-drag-region="deep" className="flex-none border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-4 pt-9 backdrop-blur-xl">
        <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]">
          <ArrowLeft className="size-3.5" /> Proyectos
        </button>
        <div className="flex items-start gap-3">
          <span className="mt-1 size-3.5 flex-none rounded-[5px]" style={{ backgroundColor: project.color }} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-[-0.025em]">{project.name}</h1>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {statusLabel(project)}
              {project.startsAt && ` · Inicio ${formatDate(project.startsAt)}`}
              {project.targetAt && ` · Objetivo ${formatDate(project.targetAt)}`}
            </p>
            {project.description && <p className="mt-2 max-w-2xl whitespace-pre-wrap text-[11px] leading-5 text-[var(--muted)]">{project.description}</p>}
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-[var(--line-strong)]"><Pencil className="size-3.5" /> Editar</button>
            <button type="button" onClick={() => void toggleArchive()} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-[var(--line-strong)]">
              {project.archivedAt ? <><ArchiveRestore className="size-3.5" /> Restaurar</> : <><Archive className="size-3.5" /> Archivar</>}
            </button>
            <button type="button" onClick={() => setDeleting(true)} aria-label="Eliminar proyecto" title="Eliminar proyecto" className="grid size-[30px] place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:border-red-500/40 hover:text-red-500"><Trash2 className="size-3.5" /></button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-5 gap-2.5">
          <Stat icon={CheckCircle2} label="Progreso" value={`${Math.round(project.progressPercent)}%`} tone="text-emerald-500" />
          <Stat icon={ListTodo} label="Abiertas" value={project.openTaskCount} tone="text-blue-500" />
          <Stat icon={AlertCircle} label="Vencidas" value={project.overdueTaskCount} tone="text-red-500" />
          <Stat icon={StickyNote} label="Notas" value={project.noteCount} tone="text-amber-500" />
          <Stat icon={Clock3} label="Tiempo" value={formatDuration(project.trackedSeconds)} tone="text-violet-500" />
        </div>
        {notes.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {notes.map((note) => (
              <button key={note.id} type="button" disabled={note.isArchived} onClick={() => void flowdeskApi.showNote(note.id)} className="flex w-44 flex-none items-center gap-2 rounded-lg border border-black/5 px-2.5 py-1.5 text-left text-slate-800 disabled:opacity-60" style={{ backgroundColor: note.color }}>
                <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{note.title || note.content.slice(0, 40) || "Nota sin título"}</span>
                {!note.isArchived && <ExternalLink className="size-3 flex-none opacity-50" />}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}
      </header>
      <TaskWorkspace view={view} onViewChange={setView} projects={projects} fixedProjectId={project.id} />
      {editing && <ProjectDialog project={project} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {deleting && <DeleteProjectDialog project={project} onClose={() => setDeleting(false)} onArchive={() => void toggleArchive()} onDeleted={onBack} />}
    </div>
  );
}

export function ProjectsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { projects, loading, error } = useProjects(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = projects.find((project) => project.id === selectedId);
  if (selected) return <ProjectDetail project={selected} projects={projects} onBack={() => setSelectedId(null)} />;

  const visible = projects.filter((project) => showArchived || !project.archivedAt);
  const archivedCount = projects.length - projects.filter((project) => !project.archivedAt).length;

  return (
    <div className="h-full overflow-y-auto">
      <header data-tauri-drag-region="deep" className="sticky top-0 z-10 flex h-[74px] items-end justify-between border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.025em]">Proyectos</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Agrupa tareas, notas y tiempo por objetivo</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white shadow-sm hover:brightness-105">
          <Plus className="size-3.5" /> Nuevo proyecto
        </button>
      </header>

      <div className="p-6">
        {archivedCount > 0 && (
          <label className="mb-4 flex cursor-pointer items-center gap-2 text-[11px] text-[var(--muted)]">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-[var(--accent)]" />
            Mostrar archivados ({archivedCount})
          </label>
        )}
        {error && <div className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-500">{error}</div>}
        {loading ? (
          <div className="py-20 text-center text-xs text-[var(--muted)]">Cargando proyectos…</div>
        ) : visible.length === 0 ? (
          <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-[var(--line)] text-center">
            <div>
              <FolderKanban className="mx-auto mb-3 size-7 text-violet-500" />
              <h2 className="text-sm font-semibold">Todavía no hay proyectos</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">Crea uno para agrupar tareas y notas relacionadas.</p>
              <button type="button" onClick={() => setCreating(true)} className="mt-4 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[11px] font-medium text-[var(--accent)]">Crear proyecto</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {visible.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => setSelectedId(project.id)} />)}
          </div>
        )}
      </div>
      {creating && <ProjectDialog project={null} onClose={() => setCreating(false)} onSaved={(project) => { setCreating(false); setSelectedId(project.id); }} />}
    </div>
  );
}
