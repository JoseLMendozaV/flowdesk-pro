import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { useEscape } from "../../hooks/useEscape";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage, noonTodayUnix } from "../../services/format";
import { useAppStore } from "../../stores/appStore";
import type { ProjectSummary } from "../../types/projects";
import type { TaskPriority } from "../../types/tasks";
import { priorityOptions } from "./taskMeta";

export function QuickTaskDialog() {
  const open = useAppStore((state) => state.quickTaskOpen);
  const close = useAppStore((state) => state.closeQuickTask);
  const refreshDashboard = useAppStore((state) => state.refreshDashboard);
  const [title, setTitle] = useState("");
  const [scheduleToday, setScheduleToday] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 30);
    void flowdeskApi.projects(false).then(setProjects).catch(() => setProjects([]));
  }, [open]);
  useEscape(close, open);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await flowdeskApi.createTask({
        title,
        dueAt: scheduleToday ? noonTodayUnix() : null,
        dueHasTime: false,
        projectId: projectId || null,
        priority,
      });
      setTitle("");
      setPriority("none");
      close();
      refreshDashboard();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start bg-black/25 px-4 pt-[18vh] backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-task-title"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="quick-task-title" className="text-sm font-semibold">
            Nueva tarea
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar"
            className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            <X className="size-4" />
          </button>
        </div>
        <input
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={240}
          placeholder="¿Qué necesitas hacer?"
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--input)] px-3 py-2.5 text-sm outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={scheduleToday}
              onChange={(event) => setScheduleToday(event.target.checked)}
              className="accent-[var(--accent)]"
            />
            <CalendarDays className="size-3.5" />
            Programar para hoy
          </label>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
            aria-label="Prioridad"
            className="rounded-lg border border-[var(--line)] bg-[var(--input)] px-2 py-1.5 text-[11px] outline-none"
          >
            {priorityOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {projects.length > 0 && (
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              aria-label="Proyecto"
              className="max-w-40 rounded-lg border border-[var(--line)] bg-[var(--input)] px-2 py-1.5 text-[11px] outline-none"
            >
              <option value="">Sin proyecto</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          )}
        </div>
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!title.trim() || saving}
            className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Crear tarea"}
          </button>
        </div>
      </form>
    </div>
  );
}
