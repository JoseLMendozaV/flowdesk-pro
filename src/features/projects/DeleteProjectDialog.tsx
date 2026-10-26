import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useEscape } from "../../hooks/useEscape";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage } from "../../services/format";
import { useUndoStore } from "../trash/undoStore";
import type { ProjectDeleteMode, ProjectSummary } from "../../types/projects";

type DeleteProjectDialogProps = {
  project: ProjectSummary;
  onClose: () => void;
  onDeleted: () => void;
  onArchive: () => void;
};

export function DeleteProjectDialog({ project, onClose, onDeleted, onArchive }: DeleteProjectDialogProps) {
  const [mode, setMode] = useState<ProjectDeleteMode>("keep_tasks");
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offerUndo = useUndoStore((state) => state.offer);
  useEscape(onClose);

  const hasTasks = project.taskCount > 0;
  const needsConfirmation = mode === "delete_tasks" && hasTasks;
  const confirmed = !needsConfirmation || confirmation.trim() === project.name;

  async function remove() {
    if (!confirmed || deleting) return;
    setDeleting(true);
    try {
      const itemId = await flowdeskApi.deleteProject(project.id, mode);
      offerUndo(`Proyecto “${project.name}” movido a la papelera`, itemId);
      onDeleted();
    } catch (reason) {
      setError(errorMessage(reason));
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" className="w-full max-w-md rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-2xl">
        <header className="flex items-start gap-3">
          <span className="grid size-9 flex-none place-items-center rounded-xl bg-red-500/10 text-red-500"><AlertTriangle className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="delete-project-title" className="text-sm font-semibold">Eliminar “{project.name}”</h2>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
              Contiene {project.taskCount} tareas y {project.noteCount} notas. Las notas y los registros de tiempo nunca se borran: quedan sin proyecto. Podrás recuperarlo todo desde la Papelera durante 30 días.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]"><X className="size-4" /></button>
        </header>

        <div className="mt-4 space-y-2" role="radiogroup" aria-label="Qué hacer con las tareas">
          <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${mode === "keep_tasks" ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]"}`}>
            <input type="radio" name="delete-mode" checked={mode === "keep_tasks"} onChange={() => setMode("keep_tasks")} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <strong className="block text-xs font-medium">Conservar las tareas</strong>
              <small className="text-[10px] text-[var(--muted)]">Pasan a “Sin proyecto” con todo su historial.</small>
            </span>
          </label>
          <label className={`flex gap-3 rounded-xl border p-3 ${hasTasks ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${mode === "delete_tasks" ? "border-red-500/60 bg-red-500/5" : "border-[var(--line)]"}`}>
            <input type="radio" name="delete-mode" disabled={!hasTasks} checked={mode === "delete_tasks"} onChange={() => setMode("delete_tasks")} className="mt-0.5 accent-red-500" />
            <span>
              <strong className="block text-xs font-medium">Eliminar también las tareas</strong>
              <small className="text-[10px] text-[var(--muted)]">Van a la Papelera con sus subtareas y vuelven con el proyecto.</small>
            </span>
          </label>
        </div>

        {needsConfirmation && (
          <label className="mt-3 block text-[10px] text-[var(--muted)]">
            Escribe <strong className="text-[var(--text)]">{project.name}</strong> para confirmar
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--input)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-red-500" />
          </label>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}

        <footer className="mt-5 flex items-center gap-2">
          {!project.archivedAt && (
            <button type="button" onClick={onArchive} className="mr-auto rounded-lg px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--accent-soft)]">Archivar en su lugar</button>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">Cancelar</button>
          <button type="button" onClick={() => void remove()} disabled={!confirmed || deleting} className="rounded-lg bg-red-500 px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50">
            {deleting ? "Eliminando…" : "Eliminar proyecto"}
          </button>
        </footer>
      </section>
    </div>
  );
}
