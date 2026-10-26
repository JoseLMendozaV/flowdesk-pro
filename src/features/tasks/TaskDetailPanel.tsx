import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Link2, Plus, Repeat, SkipForward, Target, Timer, Trash2, Unlink, X } from "lucide-react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { useEscape } from "../../hooks/useEscape";
import { useAppStore } from "../../stores/appStore";
import { flowdeskApi } from "../../services/flowdeskApi";
import {
  dateInputValue,
  errorMessage,
  formatDate,
  formatDuration,
  timeInputValue,
  timestampFromInputs,
} from "../../services/format";
import type { Note } from "../../types/dashboard";
import type { ProjectSummary } from "../../types/projects";
import type { RecurrenceRule } from "../../types/recurrence";
import type { TaskDetail, TaskInput, TaskPriority, TaskStatus } from "../../types/tasks";
import { RecurrenceField } from "../recurrence/RecurrenceField";
import { followStart } from "../recurrence/recurrenceRules";
import { useUndoStore } from "../trash/undoStore";
import { TaskCheck } from "./TaskRow";
import { priorityOptions, statusOptions } from "./taskMeta";

type Draft = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  dueTime: string;
  startDate: string;
  projectId: string;
  estimatedMinutes: string;
  tags: string[];
  recurrence: RecurrenceRule | null;
};

function draftFrom(task: TaskDetail): Draft {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: dateInputValue(task.dueAt),
    dueTime: timeInputValue(task.dueAt, task.dueHasTime),
    startDate: dateInputValue(task.startsAt),
    projectId: task.projectId ?? "",
    estimatedMinutes: task.estimatedMinutes === null ? "" : String(task.estimatedMinutes),
    tags: task.tags.map((tag) => tag.name),
    recurrence: task.recurrence,
  };
}

function inputFrom(draft: Draft): TaskInput {
  const due = timestampFromInputs(draft.dueDate, draft.dueTime);
  const minutes = draft.estimatedMinutes.trim();
  return {
    title: draft.title,
    description: draft.description,
    status: draft.status,
    priority: draft.priority,
    dueAt: due.dueAt,
    dueHasTime: due.dueHasTime,
    startsAt: draft.startDate ? timestampFromInputs(draft.startDate, "").dueAt : null,
    projectId: draft.projectId || null,
    estimatedMinutes: minutes ? Math.max(0, Math.round(Number(minutes))) : null,
    tags: draft.tags,
    recurrence: due.dueAt === null ? null : draft.recurrence,
  };
}

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--input)] px-2.5 py-1.5 text-[11px] outline-none transition focus:border-[var(--accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

type TaskDetailPanelProps = {
  taskId: string;
  projects: ProjectSummary[];
  onClose: () => void;
};

export function TaskDetailPanel({ taskId, projects, onClose }: TaskDetailPanelProps) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [availableNotes, setAvailableNotes] = useState<Note[]>([]);
  const lastSaved = useRef("");
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  const isClean = () => draftRef.current !== null && JSON.stringify(draftRef.current) === lastSaved.current;

  const applyServer = useCallback((task: TaskDetail) => {
    const next = draftFrom(task);
    setDetail(task);
    setDraft(next);
    lastSaved.current = JSON.stringify(next);
  }, []);

  useEffect(() => {
    setDetail(null);
    setDraft(null);
    setError(null);
    draftRef.current = null;
    void flowdeskApi
      .task(taskId)
      .then(applyServer)
      .catch((reason) => setError(errorMessage(reason)));
  }, [applyServer, taskId]);

  // Cambios hechos en otra vista (lista, Kanban, barra de menú) solo se aplican si no hay edición pendiente.
  useDataChanged(["tasks", "projects"], () => {
    if (!isClean()) return;
    void flowdeskApi
      .task(taskId)
      .then((task) => {
        if (isClean()) applyServer(task);
      })
      .catch(() => onClose());
  });

  useEffect(() => {
    void flowdeskApi.notes(false).then(setAvailableNotes).catch(() => setAvailableNotes([]));
  }, [taskId]);

  useEffect(() => {
    if (!draft) return;
    const signature = JSON.stringify(draft);
    if (signature === lastSaved.current || !draft.title.trim()) return;
    const timeout = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const saved = await flowdeskApi.updateTask(taskId, inputFrom(draft));
        lastSaved.current = signature;
        // Completar una tarea que se repite le quita la regla (pasa a la siguiente): se refleja si no hay más cambios.
        if (JSON.stringify(draftRef.current) === signature) applyServer(saved);
        else setDetail(saved);
        setError(null);
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1200);
      } catch (reason) {
        setSaveState("idle");
        setError(errorMessage(reason));
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [applyServer, draft, taskId]);

  useEscape(onClose);
  const selectSection = useAppStore((state) => state.selectSection);
  const focusTask = useAppStore((state) => state.focusTask);
  const offerUndo = useUndoStore((state) => state.offer);

  async function startTimer(kind: "focus" | "manual") {
    try {
      if (kind === "focus") await flowdeskApi.startPomodoro({ sessionType: "focus", taskId });
      else await flowdeskApi.startTimeEntry({ taskId });
      selectSection(kind === "focus" ? "focus" : "time");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function update(patch: Partial<Draft>) {
    setDraft((value) => (value ? { ...value, ...patch } : value));
  }

  async function run(action: () => Promise<TaskDetail>) {
    try {
      const task = await action();
      // Subtareas y notas no forman parte del borrador: se actualizan sin pisar la edición.
      setDetail(task);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function addTag(raw: string) {
    if (!draft) return;
    const names = raw.split(",").map((name) => name.trim().replace(/^#/, "")).filter(Boolean);
    const next = [...draft.tags];
    for (const name of names) {
      if (!next.some((tag) => tag.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) next.push(name);
    }
    update({ tags: next });
    setTagInput("");
  }

  async function addSubtask(event: React.FormEvent) {
    event.preventDefault();
    const title = subtaskTitle.trim();
    if (!title) return;
    setSubtaskTitle("");
    await run(() => flowdeskApi.addSubtask(taskId, title));
  }

  async function remove() {
    if (!detail) return;
    try {
      const itemId = await flowdeskApi.deleteTask(taskId);
      offerUndo(`Tarea “${detail.title}” movida a la papelera`, itemId);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function skip() {
    try {
      applyServer(await flowdeskApi.skipTaskOccurrence(taskId));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (!detail || !draft) {
    return (
      <aside className="grid border-l border-[var(--line)] bg-[var(--panel)] p-5 text-[11px] text-[var(--muted)]">
        {error ?? "Cargando tarea…"}
      </aside>
    );
  }

  const selectableProjects = projects.filter((project) => !project.archivedAt || project.id === draft.projectId);
  const linkedIds = new Set(detail.notes.map((note) => note.id));
  const linkableNotes = availableNotes.filter((note) => !linkedIds.has(note.id));

  return (
    <aside aria-label="Detalle de la tarea" className="flex min-h-0 flex-col border-l border-[var(--line)] bg-[var(--panel)]">
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <TaskCheck
          task={{ ...detail, status: draft.status }}
          onToggle={() => update({ status: draft.status === "completed" ? "pending" : "completed" })}
        />
        <span className="flex-1 text-[10px] text-[var(--muted)]">
          {saveState === "saving" ? "Guardando…" : saveState === "saved" ? "Guardado" : "Los cambios se guardan solos"}
        </span>
        <button type="button" onClick={() => void remove()} aria-label="Eliminar tarea" title="Eliminar tarea (se puede deshacer)" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-red-500/10 hover:text-red-500">
          <Trash2 className="size-3.5" />
        </button>
        <button type="button" onClick={onClose} aria-label="Cerrar detalle" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]">
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <textarea
          value={draft.title}
          onChange={(event) => update({ title: event.target.value.replace(/\n/g, " ") })}
          maxLength={240}
          rows={2}
          aria-label="Título"
          className="w-full resize-none bg-transparent text-sm font-semibold leading-5 outline-none"
        />
        {!draft.title.trim() && <p className="-mt-3 text-[10px] text-red-500">El título no puede quedar vacío.</p>}

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Estado">
            <select value={draft.status} onChange={(event) => update({ status: event.target.value as TaskStatus })} className={fieldClass}>
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Prioridad">
            <select value={draft.priority} onChange={(event) => update({ priority: event.target.value as TaskPriority })} className={fieldClass}>
              {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Fecha límite">
            <input
              type="date"
              value={draft.dueDate}
              onChange={(event) => {
                const dueDate = event.target.value;
                update({
                  dueDate,
                  dueTime: dueDate ? draft.dueTime : "",
                  // El inicio nunca queda después de la fecha límite (las fechas ISO se comparan como texto).
                  startDate: dueDate && draft.startDate > dueDate ? dueDate : draft.startDate,
                  recurrence: dueDate
                    ? followStart(draft.recurrence, timestampFromInputs(draft.dueDate, "").dueAt, timestampFromInputs(dueDate, "").dueAt)
                    : null,
                });
              }}
              className={fieldClass}
            />
          </Field>
          <Field label="Hora (opcional)">
            <input type="time" value={draft.dueTime} disabled={!draft.dueDate} onChange={(event) => update({ dueTime: event.target.value })} className={`${fieldClass} disabled:opacity-50`} />
          </Field>
          <Field label="Empieza (opcional)">
            <input
              type="date"
              value={draft.startDate}
              max={draft.dueDate || undefined}
              onChange={(event) => update({ startDate: event.target.value })}
              className={fieldClass}
            />
          </Field>
          <p className="self-end pb-1.5 text-[10px] leading-4 text-[var(--muted)]">
            {draft.startDate ? "Hasta ese día no aparece en Hoy." : "Sin fecha de inicio: se puede empezar ya."}
          </p>
          <Field label="Proyecto">
            <select value={draft.projectId} onChange={(event) => update({ projectId: event.target.value })} className={fieldClass}>
              <option value="">Sin proyecto</option>
              {selectableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </Field>
          <Field label="Estimado (min)">
            <input type="number" min={0} max={10000} step={5} value={draft.estimatedMinutes} onChange={(event) => update({ estimatedMinutes: event.target.value })} placeholder="—" className={fieldClass} />
          </Field>
        </div>

        <div data-tour-id="task-recurrence">
          <RecurrenceField
            value={draft.recurrence}
            onChange={(recurrence) => update({ recurrence })}
            start={timestampFromInputs(draft.dueDate, draft.dueTime).dueAt}
            kind="task"
            fieldClass={fieldClass}
            disabledReason={draft.dueDate ? undefined : "Pon una fecha límite para poder repetirla."}
          />
          {detail.recurrence && draft.recurrence && draft.status !== "completed" && draft.status !== "cancelled" && (
            <button type="button" onClick={() => void skip()} className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--accent)]">
              <SkipForward className="size-3" /> Saltar esta vez y pasar a la siguiente fecha
            </button>
          )}
          {draft.status === "completed" && detail.recurrenceNextId && (
            <p className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-[10px] text-[var(--accent)]">
              <Repeat className="size-3 flex-none" />
              <span className="flex-1">La siguiente repetición ya está en tus tareas.</span>
              <button type="button" onClick={() => focusTask(detail.recurrenceNextId!)} className="font-medium hover:underline">Abrir</button>
            </p>
          )}
        </div>

        <Field label="Etiquetas">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--input)] px-2 py-1.5 focus-within:border-[var(--accent)]">
            {draft.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-[var(--accent-soft)] py-0.5 pl-2 pr-1 text-[10px] text-[var(--accent)]">
                #{tag}
                <button type="button" onClick={() => update({ tags: draft.tags.filter((value) => value !== tag) })} aria-label={`Quitar etiqueta ${tag}`} className="grid size-3.5 place-items-center rounded-full hover:bg-black/10">
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(event) => (event.target.value.endsWith(",") ? addTag(event.target.value) : setTagInput(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(tagInput);
                }
                if (event.key === "Backspace" && !tagInput && draft.tags.length) update({ tags: draft.tags.slice(0, -1) });
              }}
              onBlur={() => tagInput.trim() && addTag(tagInput)}
              maxLength={40}
              placeholder={draft.tags.length ? "" : "Añadir y pulsar Enter"}
              className="min-w-16 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[var(--muted)]"
            />
          </div>
        </Field>

        <Field label="Descripción">
          <textarea value={draft.description} onChange={(event) => update({ description: event.target.value })} rows={4} maxLength={20000} placeholder="Detalles, contexto o enlaces…" className={`${fieldClass} resize-y leading-5`} />
        </Field>

        <section>
          <h3 className="mb-1.5 text-[10px] font-medium text-[var(--muted)]">
            Subtareas {detail.subtaskCount > 0 && `· ${detail.subtasksCompleted}/${detail.subtaskCount}`}
          </h3>
          <ul className="space-y-1">
            {detail.subtasks.map((subtask) => (
              <li key={subtask.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--hover)]">
                <input
                  type="checkbox"
                  checked={subtask.isCompleted}
                  onChange={(event) => void run(() => flowdeskApi.updateSubtask(subtask.id, { isCompleted: event.target.checked }))}
                  aria-label={`Completar subtarea ${subtask.title}`}
                  className="size-3.5 accent-emerald-500"
                />
                <input
                  defaultValue={subtask.title}
                  key={`${subtask.id}-${subtask.title}`}
                  onBlur={(event) => {
                    const title = event.target.value.trim();
                    if (title && title !== subtask.title) void run(() => flowdeskApi.updateSubtask(subtask.id, { title }));
                    else event.target.value = subtask.title;
                  }}
                  onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                  maxLength={240}
                  aria-label="Título de la subtarea"
                  className={`min-w-0 flex-1 bg-transparent text-[11px] outline-none ${subtask.isCompleted ? "text-[var(--muted)] line-through" : ""}`}
                />
                <button type="button" onClick={() => void run(() => flowdeskApi.deleteSubtask(subtask.id))} aria-label={`Eliminar subtarea ${subtask.title}`} className="grid size-5 place-items-center rounded text-[var(--muted)] opacity-0 hover:text-red-500 group-hover:opacity-100 focus:opacity-100">
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={(event) => void addSubtask(event)} className="mt-1 flex items-center gap-2 px-1.5">
            <Plus className="size-3.5 text-[var(--muted)]" />
            <input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} maxLength={240} placeholder="Añadir subtarea" className="min-w-0 flex-1 bg-transparent py-1 text-[11px] outline-none placeholder:text-[var(--muted)]" />
          </form>
        </section>

        <section>
          <h3 className="mb-1.5 text-[10px] font-medium text-[var(--muted)]">Notas vinculadas</h3>
          {detail.notes.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {detail.notes.map((note) => (
                <li key={note.id} className="flex items-center gap-2 rounded-lg border border-black/5 px-2.5 py-2 text-slate-800" style={{ backgroundColor: note.color }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">{note.title || "Nota sin título"}</span>
                    <span className="block truncate text-[10px] text-slate-600">{note.isArchived ? "Archivada" : note.preview || "Nota vacía"}</span>
                  </span>
                  {!note.isArchived && (
                    <button type="button" onClick={() => void flowdeskApi.showNote(note.id)} aria-label="Abrir nota" title="Abrir nota" className="grid size-6 place-items-center rounded-md hover:bg-black/10">
                      <ExternalLink className="size-3" />
                    </button>
                  )}
                  <button type="button" onClick={() => void run(() => flowdeskApi.linkTaskNote(taskId, note.id, false))} aria-label="Desvincular nota" title="Desvincular" className="grid size-6 place-items-center rounded-md hover:bg-black/10">
                    <Unlink className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {linkableNotes.length > 0 ? (
            <label className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <Link2 className="size-3.5 flex-none" />
              <select
                value=""
                onChange={(event) => event.target.value && void run(() => flowdeskApi.linkTaskNote(taskId, event.target.value, true))}
                className={fieldClass}
              >
                <option value="">Vincular una nota…</option>
                {linkableNotes.map((note) => <option key={note.id} value={note.id}>{note.title || note.content.slice(0, 40) || "Nota sin título"}</option>)}
              </select>
            </label>
          ) : (
            detail.notes.length === 0 && <p className="text-[10px] text-[var(--muted)]">No hay notas disponibles para vincular.</p>
          )}
        </section>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void startTimer("focus")} className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-2 py-2 text-[11px] hover:border-[var(--accent)] hover:text-[var(--accent)]">
            <Target className="size-3.5" /> Enfocarme
          </button>
          <button type="button" onClick={() => void startTimer("manual")} className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-2 py-2 text-[11px] hover:border-[var(--accent)] hover:text-[var(--accent)]">
            <Timer className="size-3.5" /> Cronometrar
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--inset)] p-3 text-[10px]">
          <div>
            <dt className="text-[var(--muted)]">Tiempo registrado</dt>
            <dd className="mt-0.5 font-medium">{formatDuration(detail.trackedSeconds)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Creada</dt>
            <dd className="mt-0.5 font-medium">{formatDate(detail.createdAt)}</dd>
          </div>
          {detail.completedAt && (
            <div>
              <dt className="text-[var(--muted)]">Completada</dt>
              <dd className="mt-0.5 font-medium">{formatDate(detail.completedAt)}</dd>
            </div>
          )}
        </dl>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[10px] text-red-500">{error}</p>}
      </div>
    </aside>
  );
}
