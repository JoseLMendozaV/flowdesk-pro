import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AppWindow,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ExternalLink,
  Folder,
  FolderKanban,
  ListTodo,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { WorkspaceDialog } from "../features/workspaces/WorkspaceDialog";
import { useWorkspaces } from "../features/workspaces/useWorkspaces";
import { workspaceIcons } from "../features/workspaces/workspaceMeta";
import { useDataChanged } from "../hooks/useDataChanged";
import { flowdeskApi } from "../services/flowdeskApi";
import { errorMessage } from "../services/format";
import type { Note } from "../types/dashboard";
import type { ProjectSummary } from "../types/projects";
import type { Workspace } from "../types/workspaces";

const buttonClass =
  "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-[var(--line-strong)] disabled:opacity-50";

function WorkspaceBadge({ workspace, size = "md" }: { workspace: Workspace; size?: "md" | "lg" }) {
  const Icon = workspaceIcons[workspace.icon].icon;
  return (
    <span className={`grid flex-none place-items-center rounded-xl text-white shadow-sm ${size === "lg" ? "size-10" : "size-8"}`} style={{ backgroundColor: workspace.color }}>
      <Icon className={size === "lg" ? "size-5" : "size-4"} />
    </span>
  );
}

/** Proyectos y notas de todos los espacios, para elegir los vinculados. */
function useLinkables() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const load = useCallback(() => {
    void flowdeskApi.projects(false, true).then(setProjects).catch(() => setProjects([]));
    void flowdeskApi.notes(false, true).then(setNotes).catch(() => setNotes([]));
  }, []);
  useEffect(load, [load]);
  useDataChanged(["projects", "notes"], load);
  return { projects, notes };
}

function Checklist<T extends { id: string }>({ items, selected, label, render, empty, onChange }: {
  items: T[];
  selected: string[];
  label: string;
  render: (item: T) => React.ReactNode;
  empty: string;
  onChange: (ids: string[]) => void;
}) {
  if (items.length === 0) return <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center text-[11px] text-[var(--muted)]">{empty}</p>;
  return (
    <ul aria-label={label} className="max-h-72 divide-y divide-[var(--line)] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      {items.map((item) => {
        const checked = selected.includes(item.id);
        return (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[11px] hover:bg-[var(--hover)]">
              <input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((id) => id !== item.id) : [...selected, item.id])} className="accent-[var(--accent)]" />
              {render(item)}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function WorkspaceDetail({ workspace, active, onBack, onActivate }: { workspace: Workspace; active: boolean; onBack: () => void; onActivate: (id: string | null) => void }) {
  const { projects, notes } = useLinkables();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function addResource(kind: "folder" | "app") {
    const path = await openDialog(
      kind === "folder"
        ? { directory: true, multiple: false, title: "Añadir carpeta al espacio" }
        : { directory: false, multiple: false, title: "Añadir aplicación al espacio", defaultPath: "/Applications", filters: [{ name: "Aplicaciones", extensions: ["app"] }] },
    );
    if (typeof path === "string") await run(() => flowdeskApi.addWorkspaceResource(workspace.id, kind, path));
  }

  return (
    <div className="h-full overflow-y-auto">
      <header data-tauri-drag-region="deep" className="border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-4 pt-9 backdrop-blur-xl">
        <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]">
          <ArrowLeft className="size-3.5" /> Espacios
        </button>
        <div className="flex items-center gap-3">
          <WorkspaceBadge workspace={workspace} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-[-0.025em]">{workspace.name}</h1>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {workspace.isArchived ? "Archivado" : active ? "Espacio activo" : "Inactivo"} · {workspace.openTaskCount} tareas abiertas
            </p>
          </div>
          <div className="flex gap-1.5">
            {!workspace.isArchived && (active ? (
              <button type="button" onClick={() => onActivate(null)} className={buttonClass}><X className="size-3.5" /> Desactivar</button>
            ) : (
              <button type="button" onClick={() => onActivate(workspace.id)} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11px] font-medium text-white"><CheckCircle2 className="size-3.5" /> Activar</button>
            ))}
            <button type="button" onClick={() => setEditing(true)} className={buttonClass}><Pencil className="size-3.5" /> Editar</button>
            <button type="button" onClick={() => void run(() => flowdeskApi.archiveWorkspace(workspace.id, !workspace.isArchived))} className={buttonClass}>
              {workspace.isArchived ? <><ArchiveRestore className="size-3.5" /> Restaurar</> : <><Archive className="size-3.5" /> Archivar</>}
            </button>
            {confirmingDelete ? (
              <span className="flex items-center gap-1 text-[11px]">
                <button type="button" onClick={() => void run(async () => { await flowdeskApi.deleteWorkspace(workspace.id); onBack(); })} className="rounded-lg bg-red-500 px-2.5 py-1.5 font-medium text-white">Eliminar</button>
                <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-lg px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--hover)]">No</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmingDelete(true)} aria-label="Eliminar espacio" title="Eliminar espacio (conserva tareas, proyectos y notas)" className="grid size-[30px] place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:border-red-500/40 hover:text-red-500"><Trash2 className="size-3.5" /></button>
            )}
          </div>
        </div>
        {confirmingDelete && <p className="mt-3 text-[11px] text-[var(--muted)]">Se borran el espacio y sus vínculos. Las tareas, proyectos y notas se conservan.</p>}
        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}
      </header>

      <div className="grid grid-cols-2 gap-5 p-6">
        <section>
          <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><FolderKanban className="size-3.5 text-violet-500" /> Proyectos</h2>
          <p className="mb-2.5 text-[10px] text-[var(--muted)]">Sus tareas, notas y eventos aparecen en este espacio.</p>
          <Checklist
            items={projects}
            selected={workspace.projectIds}
            label="Proyectos del espacio"
            empty="Todavía no hay proyectos."
            onChange={(ids) => void run(() => flowdeskApi.setWorkspaceProjects(workspace.id, ids))}
            render={(project) => (
              <>
                <span className="size-2.5 flex-none rounded-[3px]" style={{ backgroundColor: project.color }} />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="text-[10px] text-[var(--muted)]">{project.openTaskCount} {project.openTaskCount === 1 ? "abierta" : "abiertas"}</span>
              </>
            )}
          />
        </section>

        <section>
          <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><StickyNote className="size-3.5 text-amber-500" /> Notas flotantes</h2>
          <p className="mb-2.5 text-[10px] text-[var(--muted)]">Se muestran solo en este espacio. Las notas sin espacio se ven en todos.</p>
          <Checklist
            items={notes}
            selected={workspace.noteIds}
            label="Notas del espacio"
            empty="Todavía no hay notas."
            onChange={(ids) => void run(() => flowdeskApi.setWorkspaceNotes(workspace.id, ids))}
            render={(note) => (
              <>
                <span className="size-2.5 flex-none rounded-full border border-black/10" style={{ backgroundColor: note.color }} />
                <span className="min-w-0 flex-1 truncate">{note.title || note.content.slice(0, 60) || "Nota sin título"}</span>
              </>
            )}
          />
        </section>

        <section className="col-span-2">
          <div className="mb-2.5 flex items-end justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-xs font-semibold"><Folder className="size-3.5 text-sky-500" /> Carpetas y aplicaciones</h2>
              <p className="mt-1 text-[10px] text-[var(--muted)]">FlowDesk solo guarda la ruta; las abre macOS cuando lo pides.</p>
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => void addResource("folder")} className={buttonClass}><Folder className="size-3.5" /> Añadir carpeta</button>
              <button type="button" onClick={() => void addResource("app")} className={buttonClass}><AppWindow className="size-3.5" /> Añadir aplicación</button>
              <button type="button" disabled={workspace.resources.length === 0} onClick={() => void run(() => flowdeskApi.openWorkspaceResources(workspace.id))} className={buttonClass}><ExternalLink className="size-3.5" /> Abrir todo</button>
            </div>
          </div>
          {workspace.resources.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center text-[11px] text-[var(--muted)]">Añade las carpetas y apps con las que trabajas en este espacio.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface)]">
              {workspace.resources.map((resource) => (
                <li key={resource.id} className="flex items-center gap-2.5 px-3 py-2">
                  {resource.kind === "app" ? <AppWindow className="size-3.5 flex-none text-[var(--muted)]" /> : <Folder className="size-3.5 flex-none text-[var(--muted)]" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium">{resource.label}</span>
                    <span className={`block truncate text-[10px] ${resource.exists ? "text-[var(--muted)]" : "text-red-500"}`}>{resource.exists ? resource.path : `No encontrada: ${resource.path}`}</span>
                  </span>
                  <button type="button" disabled={!resource.exists} onClick={() => void run(() => flowdeskApi.openWorkspaceResources(workspace.id, resource.id))} className={buttonClass}>Abrir</button>
                  <button type="button" onClick={() => void run(() => flowdeskApi.removeWorkspaceResource(resource.id))} aria-label={`Quitar ${resource.label}`} className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-red-500/10 hover:text-red-500"><X className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {editing && <WorkspaceDialog workspace={workspace} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  );
}

export function WorkspacesPage() {
  const { workspaces, activeId, activate, error } = useWorkspaces();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = workspaces.find((workspace) => workspace.id === selectedId);
  if (selected) return <WorkspaceDetail workspace={selected} active={selected.id === activeId} onBack={() => setSelectedId(null)} onActivate={(id) => void activate(id)} />;

  return (
    <div className="h-full overflow-y-auto">
      <header data-tauri-drag-region="deep" className="sticky top-0 z-10 flex h-[74px] items-end justify-between border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.025em]">Espacios de trabajo</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Perfiles que filtran tareas, proyectos, notas y agenda sin duplicar datos</p>
        </div>
        <button type="button" data-tour-id="workspaces-new" onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white shadow-sm hover:brightness-105">
          <Plus className="size-3.5" /> Nuevo espacio
        </button>
      </header>

      <div data-tour-id="workspaces-list" className="p-6">
        {error && <div className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-500">{error}</div>}
        {workspaces.length === 0 ? (
          <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-[var(--line)] text-center">
            <div>
              <BriefcaseBusiness className="mx-auto mb-3 size-7 text-violet-500" />
              <h2 className="text-sm font-semibold">Todavía no hay espacios</h2>
              <p className="mx-auto mt-1 max-w-xs text-[11px] leading-5 text-[var(--muted)]">Crea uno por contexto (Investigación, Programación, Docencia) y vincula sus proyectos, notas, carpetas y apps.</p>
              <button type="button" onClick={() => setCreating(true)} className="mt-4 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[11px] font-medium text-[var(--accent)]">Crear espacio</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {workspaces.map((workspace) => (
              <article key={workspace.id} className={`flex flex-col rounded-2xl border bg-[var(--surface)] p-4 shadow-[var(--card-shadow)] ${workspace.id === activeId ? "border-[var(--accent)]" : "border-[var(--line)]"} ${workspace.isArchived ? "opacity-60" : ""}`}>
                <button type="button" onClick={() => setSelectedId(workspace.id)} className="flex items-center gap-2.5 text-left">
                  <WorkspaceBadge workspace={workspace} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{workspace.name}</span>
                    <span className="block text-[10px] text-[var(--muted)]">{workspace.isArchived ? "Archivado" : workspace.id === activeId ? "Activo" : workspaceIcons[workspace.icon].label}</span>
                  </span>
                </button>
                <div className="mt-3 flex items-center gap-3 text-[10px] text-[var(--muted)]">
                  <span className="flex items-center gap-1"><ListTodo className="size-3" /> {workspace.openTaskCount}</span>
                  <span className="flex items-center gap-1"><FolderKanban className="size-3" /> {workspace.projectIds.length}</span>
                  <span className="flex items-center gap-1"><StickyNote className="size-3" /> {workspace.noteIds.length}</span>
                  <span className="flex items-center gap-1"><Folder className="size-3" /> {workspace.resources.length}</span>
                </div>
                <div className="mt-3 flex gap-1.5">
                  {!workspace.isArchived && (
                    <button type="button" onClick={() => void activate(workspace.id === activeId ? null : workspace.id)} className={`flex-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${workspace.id === activeId ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "border border-[var(--line)] hover:border-[var(--line-strong)]"}`}>
                      {workspace.id === activeId ? "Activo · desactivar" : "Activar"}
                    </button>
                  )}
                  <button type="button" onClick={() => setSelectedId(workspace.id)} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] hover:border-[var(--line-strong)]">Configurar</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      {creating && <WorkspaceDialog workspace={null} onClose={() => setCreating(false)} onSaved={(workspace) => { setCreating(false); setSelectedId(workspace.id); }} />}
    </div>
  );
}
