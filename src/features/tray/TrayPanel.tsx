import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ListTodo,
  LoaderCircle,
  LogOut,
  Plus,
  Settings,
  StickyNote,
  Timer,
} from "lucide-react";
import { useDashboard } from "../dashboard/useDashboard";
import { formatClock, sessionLabels, useLiveTimer, useTimer } from "../focus/useTimer";
import { useDataChanged } from "../../hooks/useDataChanged";
import { flowdeskApi } from "../../services/flowdeskApi";
import { describeDue, errorMessage, noonTodayUnix } from "../../services/format";
import { useAppStore } from "../../stores/appStore";

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const timeFormatter = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
});

export function TrayPanel() {
  const { data, error, loading } = useDashboard();
  const refreshDashboard = useAppStore((state) => state.refreshDashboard);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const timer = useTimer();
  const live = useLiveTimer(timer.snapshot);
  const pomodoro = timer.snapshot?.pomodoro ?? null;

  // El panel vive oculto entre usos: se refresca al cambiar los datos y cada vez que se muestra.
  useDataChanged(["tasks", "projects", "notes"], refreshDashboard);
  useEffect(() => {
    window.addEventListener("focus", refreshDashboard);
    return () => window.removeEventListener("focus", refreshDashboard);
  }, [refreshDashboard]);

  async function completeTask(taskId: string) {
    try {
      await flowdeskApi.setTaskStatus(taskId, "completed");
    } catch (reason) {
      setTaskError(errorMessage(reason));
    }
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setTaskError(null);
    try {
      await flowdeskApi.createTask({ title, dueAt: noonTodayUnix(), dueHasTime: false });
      setTitle("");
      refreshDashboard();
    } catch (reason) {
      setTaskError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tray-panel-root h-screen bg-transparent p-2">
      <section className="flex h-full flex-col overflow-hidden rounded-[18px] border border-[var(--line-strong)] bg-[var(--surface)] shadow-2xl">
        <header data-tauri-drag-region className="flex items-start justify-between border-b border-[var(--line)] px-4 pb-3 pt-4">
          <div data-tauri-drag-region className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-[#6e8bff] to-[#806ce8] text-sm font-bold text-white">F</div>
            <div>
              <h1 className="text-[13px] font-semibold">FlowDesk Pro</h1>
              <p className="mt-0.5 text-[9px] text-[var(--muted)]">{dateFormatter.format(new Date())}</p>
            </div>
          </div>
          <span className="mt-1 flex items-center gap-1.5 text-[9px] text-emerald-500">
            <span className="size-1.5 rounded-full bg-emerald-500" /> activo
          </span>
        </header>

        {loading && !data ? (
          <div className="grid flex-1 place-items-center text-[10px] text-[var(--muted)]">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="m-4 rounded-xl bg-red-500/10 p-3 text-[10px] text-red-500">{error}</div>
        ) : data ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="tray-stat"><CheckCircle2 className="text-emerald-500" /><strong>{data.todayTasks}</strong><span>pendientes</span></div>
              <div className="tray-stat"><Clock3 className="text-blue-500" /><strong>{Math.floor(data.trackedSecondsToday / 60)}m</strong><span>registrados</span></div>
              <div className="tray-stat"><Timer className="text-violet-500" /><strong>{pomodoro ? formatClock(live.remaining) : "—"}</strong><span>{pomodoro ? `${sessionLabels[pomodoro.sessionType].toLowerCase()}${pomodoro.status === "paused" ? " (pausa)" : ""}` : "sin sesión"}</span></div>
            </div>

            <div className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--inset)] px-2.5 py-2 text-[9px] text-[var(--muted)]">
              <span className="size-1.5 rounded-full bg-violet-500" />
              Ámbito: <strong className="font-medium text-[var(--text)]">Todos los espacios</strong>
            </div>

            <form onSubmit={createTask} className="mt-4">
              <label htmlFor="tray-task" className="mb-2 block text-[10px] font-semibold">Captura rápida</label>
              <div className="flex gap-2">
                <input
                  id="tray-task"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={240}
                  placeholder="Nueva tarea para hoy…"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--input)] px-3 py-2 text-[11px] outline-none focus:border-[var(--accent)]"
                />
                <button type="submit" disabled={!title.trim() || saving} aria-label="Crear tarea" className="grid size-8 flex-none place-items-center rounded-lg bg-[var(--accent)] text-white disabled:opacity-40">
                  {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-4" />}
                </button>
              </div>
              {(taskError ?? timer.error) && <p className="mt-1.5 text-[9px] text-red-500">{taskError ?? timer.error}</p>}
            </form>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[10px] font-semibold">Próximo</h2>
                <button type="button" onClick={() => void flowdeskApi.openMain("tasks")} className="text-[9px] text-[var(--accent)]">Tareas de hoy</button>
              </div>
              {data.upcomingTasks.length > 0 ? (
                <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3">
                  {data.upcomingTasks.slice(0, 3).map((task) => {
                    const due = task.dueAt ? describeDue(task.dueAt, task.dueHasTime) : null;
                    return (
                      <li key={task.id} className="flex items-center gap-2 py-2.5">
                        <button type="button" onClick={() => void completeTask(task.id)} aria-label={`Completar “${task.title}”`} className="grid size-3.5 flex-none place-items-center rounded-full border border-[var(--line-strong)] text-transparent hover:border-emerald-500 hover:text-emerald-500">
                          <Check className="size-2" strokeWidth={3} />
                        </button>
                        <span className="min-w-0 flex-1 truncate text-[10px]">{task.title}</span>
                        {due && <time className={`text-[9px] ${due.overdue ? "text-red-500" : "text-[var(--muted)]"}`}>{due.label}</time>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--line)] px-3 py-5 text-center text-[10px] text-[var(--muted)]">No hay tareas próximas.</div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2.5">
              <CalendarDays className="size-3.5 flex-none text-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[9px] text-[var(--muted)]">Próximo evento</p>
                <p className="truncate text-[10px] font-medium">{data.nextEvent ? data.nextEvent.title : "Sin compromisos próximos"}</p>
              </div>
              {data.nextEvent && <time className="text-[9px] text-[var(--muted)]">{timeFormatter.format(new Date(data.nextEvent.startsAt * 1000))}</time>}
            </div>

            <button type="button" onClick={() => void flowdeskApi.openMain("dashboard")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-soft)] px-3 py-2.5 text-[11px] font-medium text-[var(--accent)]">
              Abrir FlowDesk <ArrowUpRight className="size-3.5" />
            </button>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => void flowdeskApi.createNote()} className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-2 py-2 text-[9px] text-[var(--muted)] hover:bg-[var(--hover)]"><StickyNote className="size-3" /> Nueva nota</button>
              <button type="button" onClick={() => void flowdeskApi.openMain("tasks")} className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-2 py-2 text-[9px] text-[var(--muted)] hover:bg-[var(--hover)]"><ListTodo className="size-3" /> Hoy</button>
              <button type="button" onClick={() => void timer.run(flowdeskApi.togglePomodoro)} className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-2 py-2 text-[9px] text-[var(--muted)] hover:bg-[var(--hover)]"><Timer className="size-3" /> {pomodoro?.status === "running" ? "Pausar" : pomodoro ? "Reanudar" : "Pomodoro"}</button>
            </div>
          </div>
        ) : null}

        <footer className="flex items-center justify-between border-t border-[var(--line)] px-3 py-2">
          <button type="button" disabled title="Disponible en la fase de calendario" className="tray-footer-action opacity-50"><CalendarDays /> Agenda</button>
          <button type="button" onClick={() => void flowdeskApi.openMain("settings")} className="tray-footer-action"><Settings /> Configuración</button>
          <button type="button" onClick={() => void flowdeskApi.quit()} className="tray-footer-action hover:text-red-500"><LogOut /> Salir</button>
        </footer>
      </section>
    </div>
  );
}
