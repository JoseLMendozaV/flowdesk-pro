import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useEscape } from "../../hooks/useEscape";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage } from "../../services/format";
import type { Workspace, WorkspaceIcon, WorkspaceInput, WorkspaceTaskView } from "../../types/workspaces";
import { projectColors } from "../projects/ProjectDialog";
import { workspaceIcons, workspaceTaskViews } from "./workspaceMeta";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--input)] px-3 py-2 text-xs outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]";

type WorkspaceDialogProps = {
  workspace: Workspace | null;
  onClose: () => void;
  onSaved: (workspace: Workspace) => void;
};

export function WorkspaceDialog({ workspace, onClose, onSaved }: WorkspaceDialogProps) {
  const [name, setName] = useState(workspace?.name ?? "");
  const [color, setColor] = useState(workspace?.color ?? projectColors[1]);
  const [icon, setIcon] = useState<WorkspaceIcon>(workspace?.icon ?? "briefcase");
  const [taskView, setTaskView] = useState<WorkspaceTaskView>(workspace?.taskView ?? "today");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.setTimeout(() => nameRef.current?.focus(), 30);
  }, []);
  useEscape(onClose);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    const input: WorkspaceInput = { name, color, icon, taskView };
    setSaving(true);
    setError(null);
    try {
      onSaved(workspace ? await flowdeskApi.updateWorkspace(workspace.id, input) : await flowdeskApi.createWorkspace(input));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title" className="w-full max-w-md rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 id="workspace-dialog-title" className="text-sm font-semibold">{workspace ? "Editar espacio" : "Nuevo espacio de trabajo"}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]">
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-3">
          <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Nombre (Investigación, Docencia…)" aria-label="Nombre" className={fieldClass} />
          <div>
            <span className="mb-1.5 block text-[10px] font-medium text-[var(--muted)]">Icono</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icono">
              {(Object.keys(workspaceIcons) as WorkspaceIcon[]).map((value) => {
                const { icon: Icon, label } = workspaceIcons[value];
                const selected = icon === value;
                return (
                  <button key={value} type="button" role="radio" aria-checked={selected} aria-label={label} title={label} onClick={() => setIcon(value)} className={`grid size-8 place-items-center rounded-lg border transition ${selected ? "border-transparent text-white" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"}`} style={selected ? { backgroundColor: color } : undefined}>
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[10px] font-medium text-[var(--muted)]">Color</span>
            <div className="flex gap-2" role="radiogroup" aria-label="Color">
              {projectColors.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={color === value} aria-label={`Color ${value}`} onClick={() => setColor(value)} className="grid size-6 place-items-center rounded-full text-white shadow-sm" style={{ backgroundColor: value }}>
                  {color === value && <Check className="size-3.5" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Al activarlo, mostrar las tareas de</span>
            <select value={taskView} onChange={(event) => setTaskView(event.target.value as WorkspaceTaskView)} className={fieldClass}>
              {workspaceTaskViews.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}

        <footer className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">Cancelar</button>
          <button type="submit" disabled={!name.trim() || saving} className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50">
            {saving ? "Guardando…" : workspace ? "Guardar cambios" : "Crear espacio"}
          </button>
        </footer>
      </form>
    </div>
  );
}
