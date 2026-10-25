import { useCallback, useEffect, useState } from "react";
import { CalendarRange, Clock3, Pause, Play, RotateCw, Square, Target, Timer } from "lucide-react";
import { MetricCard } from "../components/MetricCard";
import { WorkContextPicker, type WorkSelection } from "../features/focus/WorkContextPicker";
import { formatClock, useLiveTimer, useTimer } from "../features/focus/useTimer";
import { EntriesList } from "../features/time/EntriesList";
import { ProjectTimeBars } from "../features/time/ProjectTimeBars";
import { WeeklyChart } from "../features/time/WeeklyChart";
import { useDataChanged } from "../hooks/useDataChanged";
import { flowdeskApi } from "../services/flowdeskApi";
import { errorMessage, formatDuration } from "../services/format";
import type { TimeEntry, TimeStats } from "../types/focus";

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

export function TimePage() {
  const { snapshot, error: timerError, setError: setTimerError, run } = useTimer();
  const live = useLiveTimer(snapshot);
  const [stats, setStats] = useState<TimeStats | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [range, setRange] = useState<"today" | "week">("today");
  const [error, setError] = useState<string | null>(null);
  const [work, setWork] = useState<WorkSelection>({ taskId: "", projectId: "" });
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextStats, nextEntries] = await Promise.all([flowdeskApi.timeStats(), flowdeskApi.timeEntries(range)]);
      setStats(nextStats);
      setEntries(nextEntries);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["time", "tasks", "projects"], () => void load());

  const entry = snapshot?.entry ?? null;
  const focusRunning = snapshot?.pomodoro?.sessionType === "focus" && snapshot.pomodoro.status === "running";

  async function start() {
    const ok = await run(() =>
      flowdeskApi.startTimeEntry({ taskId: work.taskId || null, projectId: work.projectId || null, description }),
    );
    if (ok) setDescription("");
  }

  return (
    <div className="h-full overflow-y-auto">
      <header data-tauri-drag-region="deep" className="sticky top-0 z-10 flex h-[74px] items-end justify-between border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.025em]">Tiempo</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Registro manual y resumen de tu semana</p>
        </div>
      </header>

      <div className="space-y-5 p-6">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]" aria-label="Cronómetro manual">
          {entry ? (
            <div className="flex items-center gap-5">
              <div className={`grid size-12 flex-none place-items-center rounded-2xl ${entry.status === "running" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--inset)] text-[var(--muted)]"}`}>
                <Timer className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[32px] font-semibold leading-none tracking-[-0.03em]">{formatClock(live.entryElapsed)}</p>
                <p className="mt-1.5 flex items-center gap-1.5 truncate text-[11px] text-[var(--muted)]">
                  {entry.status === "paused" && <span className="font-medium text-amber-600">En pausa ·</span>}
                  {entry.projectColor && <span className="size-1.5 rounded-full" style={{ backgroundColor: entry.projectColor }} />}
                  {entry.description || entry.taskTitle || entry.projectName || "Sin descripción"}
                </p>
              </div>
              {entry.status === "running" ? (
                <button type="button" onClick={() => void run(flowdeskApi.pauseTimeEntry)} className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white"><Pause className="size-3.5" /> Pausar</button>
              ) : (
                <button type="button" onClick={() => void run(flowdeskApi.resumeTimeEntry)} disabled={focusRunning} className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white disabled:opacity-40"><RotateCw className="size-3.5" /> Reanudar</button>
              )}
              <button type="button" onClick={() => void run(flowdeskApi.stopTimeEntry)} className="flex items-center gap-1.5 rounded-xl border border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)] hover:text-[var(--text)]"><Square className="size-3" /> Finalizar</button>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="¿En qué estás trabajando?" aria-label="Descripción" className="min-w-48 flex-[2] rounded-lg border border-[var(--line)] bg-[var(--input)] px-3 py-2 text-xs outline-none focus:border-[var(--accent)]" />
              <WorkContextPicker value={work} onChange={setWork} className="min-w-72 flex-[3]" />
              <button type="submit" disabled={focusRunning} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white disabled:opacity-40"><Play className="size-3.5" /> Iniciar</button>
              {focusRunning && <p className="w-full text-[10px] text-[var(--muted)]">Hay un Pomodoro de enfoque en marcha: ya está registrando este tiempo.</p>}
            </form>
          )}
          {timerError && (
            <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">
              {timerError}
              <button type="button" onClick={() => setTimerError(null)} className="ml-2 underline">Cerrar</button>
            </p>
          )}
        </section>

        {error && <p className="rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-500">{error}</p>}

        {stats && (
          <>
            <section aria-label="Resumen" className="grid grid-cols-4 gap-3">
              <MetricCard label="Registrado hoy" value={formatDuration(stats.todayTrackedSeconds)} hint="Manual y Pomodoro" icon={Clock3} tone="blue" />
              <MetricCard label="Concentración hoy" value={formatDuration(stats.todayFocusSeconds)} hint={`${stats.focusSessionsToday} sesiones completadas`} icon={Target} tone="orange" />
              <MetricCard label="Registrado esta semana" value={formatDuration(stats.weekTrackedSeconds)} hint="De lunes a hoy" icon={CalendarRange} tone="blue" />
              <MetricCard label="Concentración esta semana" value={formatDuration(stats.weekFocusSeconds)} hint="Tiempo en sesiones de enfoque" icon={Target} tone="orange" />
            </section>
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(240px,1fr)] gap-5">
              <WeeklyChart days={stats.days} todayStart={startOfToday()} />
              <ProjectTimeBars projects={stats.projects} />
            </div>
          </>
        )}

        <EntriesList entries={entries} range={range} onRangeChange={setRange} liveEntry={entry ? { id: entry.id, elapsed: live.entryElapsed } : null} />
      </div>
    </div>
  );
}
