import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useEscape } from "../../hooks/useEscape";
import { flowdeskApi } from "../../services/flowdeskApi";
import { dateInputValue, errorMessage, timestampFromInputs } from "../../services/format";
import type { ProjectInput, ProjectStatus, ProjectSummary } from "../../types/projects";

export const projectColors = ["#6C8CFF", "#8B6CF0", "#2FB67C", "#E8A33D", "#E5636F", "#3BA7C4", "#D46BB3", "#8B8FA3"];

export const projectStatusOptions: { value: ProjectStatus; label: string }[] = [
  { value: "active", label: "Activo" },
  { value: "paused", label: "En pausa" },
  { value: "completed", label: "Completado" },
];

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--input)] px-3 py-2 text-xs outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]";

type ProjectDialogProps = {
  project: ProjectSummary | null;
  onClose: () => void;
  onSaved: (project: ProjectSummary) => void;
};

export function ProjectDialog({ project, onClose, onSaved }: ProjectDialogProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? projectColors[0]);
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [startsAt, setStartsAt] = useState(dateInputValue(project?.startsAt ?? null));
  const [targetAt, setTargetAt] = useState(dateInputValue(project?.targetAt ?? null));
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
    const input: ProjectInput = {
      name,
      description,
      color,
      status,
      startsAt: timestampFromInputs(startsAt, "").dueAt,
      targetAt: timestampFromInputs(targetAt, "").dueAt,
    };
    setSaving(true);
    setError(null);
    try {
      onSaved(project ? await flowdeskApi.updateProject(project.id, input) : await flowdeskApi.createProject(input));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" className="w-full max-w-md rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 id="project-dialog-title" className="text-sm font-semibold">{project ? "Editar proyecto" : "Nuevo proyecto"}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]">
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-3">
          <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Nombre del proyecto" aria-label="Nombre" className={fieldClass} />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Descripción (opcional)" aria-label="Descripción" className={`${fieldClass} resize-none leading-5`} />
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
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Estado</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)} className={fieldClass}>
                {projectStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Inicio</span>
              <input type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={fieldClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Objetivo</span>
              <input type="date" value={targetAt} min={startsAt || undefined} onChange={(event) => setTargetAt(event.target.value)} className={fieldClass} />
            </label>
          </div>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}

        <footer className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">Cancelar</button>
          <button type="submit" disabled={!name.trim() || saving} className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50">
            {saving ? "Guardando…" : project ? "Guardar cambios" : "Crear proyecto"}
          </button>
        </footer>
      </form>
    </div>
  );
}
