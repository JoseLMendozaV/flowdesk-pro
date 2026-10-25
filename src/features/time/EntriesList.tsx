import { useState } from "react";
import { Check, Pencil, Timer, Trash2, X } from "lucide-react";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage, formatDuration, formatTime } from "../../services/format";
import type { TimeEntry } from "../../types/focus";
import { WorkContextPicker, type WorkSelection } from "../focus/WorkContextPicker";

const dayFormatter = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric" });

function EntryEditor({ entry, onDone }: { entry: TimeEntry; onDone: () => void }) {
  const [work, setWork] = useState<WorkSelection>({ taskId: entry.taskId ?? "", projectId: entry.projectId ?? "" });
  const [description, setDescription] = useState(entry.description);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await flowdeskApi.updateTimeEntry(entry.id, { taskId: work.taskId || null, projectId: work.projectId || null, description });
      onDone();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-[var(--inset)] p-3">
      <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="Descripción" aria-label="Descripción" className="w-full rounded-lg border border-[var(--line)] bg-[var(--input)] px-2.5 py-2 text-[11px] outline-none focus:border-[var(--accent)]" />
      <WorkContextPicker value={work} onChange={setWork} />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]"><X className="size-3" /> Cancelar</button>
        <button type="button" onClick={() => void save()} className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-medium text-white"><Check className="size-3" /> Guardar</button>
      </div>
    </div>
  );
}

type EntriesListProps = {
  entries: TimeEntry[];
  range: "today" | "week";
  onRangeChange: (range: "today" | "week") => void;
  liveEntry: { id: string; elapsed: number } | null;
};

export function EntriesList({ entries, range, onRangeChange, liveEntry }: EntriesListProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(entry: TimeEntry) {
    if (!window.confirm(`¿Eliminar este registro de ${formatDuration(entry.durationSeconds)}?`)) return;
    try {
      await flowdeskApi.deleteTimeEntry(entry.id);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Registros</h2>
        <div role="tablist" aria-label="Periodo" className="flex rounded-lg border border-[var(--line)] bg-[var(--inset)] p-0.5">
          {(["today", "week"] as const).map((option) => (
            <button key={option} type="button" role="tab" aria-selected={range === option} onClick={() => onRangeChange(option)} className={`rounded-md px-2.5 py-1 text-[11px] ${range === option ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)]"}`}>
              {option === "today" ? "Hoy" : "Semana"}
            </button>
          ))}
        </div>
      </header>
      {error && <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line)] px-3 py-8 text-center text-[11px] text-[var(--muted)]">
          No hay registros {range === "today" ? "hoy" : "esta semana"}.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {entries.map((entry) => {
            const active = entry.status !== "completed";
            const duration = liveEntry?.id === entry.id ? liveEntry.elapsed : entry.durationSeconds;
            return (
              <li key={entry.id} className="group py-2.5">
                {editing === entry.id ? (
                  <EntryEditor entry={entry} onDone={() => setEditing(null)} />
                ) : (
                  <div className="flex items-center gap-3">
                    <span className={`flex-none rounded-full px-1.5 py-0.5 text-[9px] font-medium ${entry.source === "pomodoro" ? "bg-orange-500/10 text-orange-600" : "bg-blue-500/10 text-blue-600"}`}>
                      {entry.source === "pomodoro" ? "Pomodoro" : "Manual"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">
                        {entry.description || entry.taskTitle || entry.projectName || "Sin descripción"}
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                        {range === "week" && `${dayFormatter.format(new Date(entry.startedAt * 1000))} · `}
                        {formatTime(entry.startedAt)}
                        {entry.endedAt ? `–${formatTime(entry.endedAt)}` : ""}
                        {entry.projectName && (
                          <>
                            <span className="size-1.5 rounded-full" style={{ backgroundColor: entry.projectColor ?? undefined }} />
                            {entry.projectName}
                          </>
                        )}
                        {active && <span className="flex items-center gap-0.5 text-[var(--accent)]"><Timer className="size-3" /> {entry.status === "running" ? "En curso" : "En pausa"}</span>}
                      </span>
                    </span>
                    <span className="text-[11px] tabular-nums">{formatDuration(duration)}</span>
                    <span className="flex gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      <button type="button" onClick={() => setEditing(entry.id)} aria-label="Editar registro" className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"><Pencil className="size-3" /></button>
                      {!active && <button type="button" onClick={() => void remove(entry)} aria-label="Eliminar registro" className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-red-500/10 hover:text-red-500"><Trash2 className="size-3" /></button>}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
