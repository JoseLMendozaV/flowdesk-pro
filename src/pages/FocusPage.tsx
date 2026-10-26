import { useCallback, useEffect, useState } from "react";
import { Bell, Coffee, Pause, Play, RotateCw, Square, Target } from "lucide-react";
import { WorkContextPicker, type WorkSelection } from "../features/focus/WorkContextPicker";
import { formatClock, sessionLabels, useLiveTimer, useTimer } from "../features/focus/useTimer";
import { useDataChanged } from "../hooks/useDataChanged";
import { flowdeskApi } from "../services/flowdeskApi";
import { formatDuration, formatTime } from "../services/format";
import type { FocusSession, PomodoroSettings, SessionType } from "../types/focus";

const focusPresets = [25, 45, 60];
const sessionOrder: SessionType[] = ["focus", "short_break", "long_break"];

function defaultMinutes(settings: PomodoroSettings, type: SessionType) {
  if (type === "short_break") return settings.shortBreakMinutes;
  if (type === "long_break") return settings.longBreakMinutes;
  return settings.focusMinutes;
}

function ProgressRing({ progress, tone, children }: { progress: number; tone: string; children: React.ReactNode }) {
  const radius = 108;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative mx-auto grid size-64 place-items-center">
      <svg viewBox="0 0 240 240" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="120" cy="120" r={radius} fill="none" stroke="var(--track)" strokeWidth="8" />
        <circle
          cx="120"
          cy="120"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
          className="transition-[stroke-dashoffset] duration-700 ease-linear"
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

function SettingsCard({ settings, onSave }: { settings: PomodoroSettings; onSave: (value: PomodoroSettings) => Promise<boolean> }) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const number = (key: keyof PomodoroSettings, label: string, min: number, max: number) => (
    <label className="block text-[10px] text-[var(--muted)]">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={draft[key] as number}
        onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
        className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--input)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
  const toggle = (key: "autoStartBreaks" | "autoStartFocus" | "notifications", label: string) => (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-[11px]">
      {label}
      <input type="checkbox" checked={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} className="size-3.5 accent-[var(--accent)]" />
    </label>
  );

  return (
    <section data-tour-id="focus-settings" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--card-shadow)]">
      <h2 className="text-xs font-semibold">Preferencias del ciclo</h2>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {number("focusMinutes", "Enfoque (min)", 1, 180)}
        {number("shortBreakMinutes", "Descanso corto (min)", 1, 60)}
        {number("longBreakMinutes", "Descanso largo (min)", 1, 120)}
        {number("longBreakEvery", "Descanso largo cada", 2, 12)}
      </div>
      <div className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)] pt-1">
        {toggle("autoStartBreaks", "Iniciar descansos automáticamente")}
        {toggle("autoStartFocus", "Iniciar enfoque tras el descanso")}
        {toggle("notifications", "Avisos al terminar cada sesión")}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {saved && !dirty && <span className="text-[10px] text-emerald-500">Guardado</span>}
        <button
          type="button"
          disabled={!dirty}
          onClick={() => void onSave(draft).then((ok) => ok && (setSaved(true), window.setTimeout(() => setSaved(false), 1500)))}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
    </section>
  );
}

function TodaySessions() {
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const load = useCallback(() => {
    void flowdeskApi.focusSessions().then(setSessions).catch(() => setSessions([]));
  }, []);
  useEffect(load, [load]);
  useDataChanged(["time"], load);

  return (
    <section data-tour-id="focus-sessions" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--card-shadow)]">
      <h2 className="text-xs font-semibold">Sesiones de hoy</h2>
      {sessions.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-[var(--line)] px-3 py-6 text-center text-[11px] text-[var(--muted)]">Todavía no hay sesiones hoy.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-2.5 py-2 text-[11px]">
              {session.sessionType === "focus" ? <Target className="size-3.5 flex-none text-[var(--accent)]" /> : <Coffee className="size-3.5 flex-none text-emerald-500" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{session.taskTitle ?? sessionLabels[session.sessionType]}</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {formatTime(session.startedAt)} · {session.status === "completed" ? "Completada" : session.status === "cancelled" ? "Interrumpida" : session.status === "paused" ? "En pausa" : "En curso"}
                </span>
              </span>
              <span className="tabular-nums text-[var(--muted)]">{formatDuration(session.elapsedSeconds)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FocusPage() {
  const { snapshot, error, setError, run } = useTimer();
  const live = useLiveTimer(snapshot);
  const [sessionType, setSessionType] = useState<SessionType | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [work, setWork] = useState<WorkSelection>({ taskId: "", projectId: "" });

  if (!snapshot) {
    return <div className="grid h-full place-items-center text-xs text-[var(--muted)]">{error ?? "Cargando temporizador…"}</div>;
  }

  const pomodoro = snapshot.pomodoro;
  const type = pomodoro?.sessionType ?? sessionType ?? snapshot.nextSessionType;
  const chosenMinutes = minutes ?? defaultMinutes(snapshot.settings, type);
  const isFocus = type === "focus";
  const tone = isFocus ? "var(--accent)" : "#10b981";
  const progress = pomodoro ? live.pomodoroElapsed / pomodoro.plannedSeconds : 0;
  const manualRunning = snapshot.entry?.status === "running";

  async function start() {
    const ok = await run(() =>
      flowdeskApi.startPomodoro({
        sessionType: type,
        minutes: chosenMinutes,
        taskId: isFocus ? work.taskId || null : null,
        projectId: isFocus ? work.projectId || null : null,
      }),
    );
    if (ok) {
      setSessionType(null);
      setMinutes(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <header data-tauri-drag-region="deep" className="sticky top-0 z-10 flex h-[74px] items-end justify-between border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.025em]">Concentración</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">El temporizador sigue en marcha aunque cierres esta ventana · ⌥⇧P</p>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5 p-6">
        <section data-tour-id="focus-timer" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--card-shadow)]">
          {!pomodoro && (
            <div role="tablist" aria-label="Tipo de sesión" className="mx-auto mb-6 flex w-fit rounded-lg border border-[var(--line)] bg-[var(--inset)] p-0.5">
              {sessionOrder.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={type === option}
                  onClick={() => {
                    setSessionType(option);
                    setMinutes(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-[11px] transition ${type === option ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                >
                  {sessionLabels[option]}
                  {option === snapshot.nextSessionType && <span className="ml-1 text-[9px] text-[var(--accent)]">· siguiente</span>}
                </button>
              ))}
            </div>
          )}

          <ProgressRing progress={progress} tone={tone}>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">{sessionLabels[type]}</p>
            <p className="mt-1 text-[52px] font-semibold leading-none tracking-[-0.04em]" aria-live="off">
              {formatClock(pomodoro ? live.remaining : chosenMinutes * 60)}
            </p>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {pomodoro?.status === "paused"
                ? "En pausa"
                : pomodoro?.expectedEndAt
                  ? `Termina a las ${formatTime(pomodoro.expectedEndAt)}`
                  : "Listo para empezar"}
            </p>
          </ProgressRing>

          {pomodoro && (pomodoro.taskTitle || pomodoro.projectName) && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-[var(--muted)]">
              {pomodoro.projectColor && <span className="size-1.5 rounded-full" style={{ backgroundColor: pomodoro.projectColor }} />}
              {pomodoro.taskTitle ?? pomodoro.projectName}
            </p>
          )}

          {!pomodoro && (
            <div className="mx-auto mt-6 max-w-md space-y-3">
              <div className="flex items-center justify-center gap-2">
                {(isFocus ? focusPresets : [defaultMinutes(snapshot.settings, type)]).map((preset) => (
                  <button key={preset} type="button" onClick={() => setMinutes(preset)} aria-pressed={chosenMinutes === preset} className={`rounded-lg border px-3 py-1.5 text-[11px] ${chosenMinutes === preset ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"}`}>
                    {preset} min
                  </button>
                ))}
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                  Otro
                  <input type="number" min={1} max={180} value={chosenMinutes} onChange={(event) => setMinutes(Math.max(1, Math.min(180, Number(event.target.value) || 1)))} aria-label="Minutos personalizados" className="w-14 rounded-lg border border-[var(--line)] bg-[var(--input)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                </label>
              </div>
              {isFocus && <WorkContextPicker value={work} onChange={setWork} />}
              {isFocus && manualRunning && <p className="text-center text-[10px] text-amber-600">El cronómetro manual está en marcha; páusalo para no contar el tiempo dos veces.</p>}
            </div>
          )}

          <div className="mt-6 flex justify-center gap-2">
            {!pomodoro ? (
              <button type="button" onClick={() => void start()} disabled={isFocus && manualRunning} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-medium text-white shadow-sm hover:brightness-105 disabled:opacity-40">
                <Play className="size-4" /> Iniciar {sessionLabels[type].toLowerCase()}
              </button>
            ) : (
              <>
                {pomodoro.status === "running" ? (
                  <button type="button" onClick={() => void run(flowdeskApi.pausePomodoro)} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-medium text-white shadow-sm">
                    <Pause className="size-4" /> Pausar
                  </button>
                ) : (
                  <button type="button" onClick={() => void run(flowdeskApi.resumePomodoro)} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-medium text-white shadow-sm">
                    <RotateCw className="size-4" /> Reanudar
                  </button>
                )}
                <button type="button" onClick={() => void run(flowdeskApi.stopPomodoro)} className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-xs text-[var(--muted)] hover:text-[var(--text)]">
                  <Square className="size-3.5" /> Finalizar
                </button>
              </>
            )}
          </div>

          <div className="mt-6 flex items-center justify-center gap-3 text-[10px] text-[var(--muted)]">
            <span className="flex gap-1" aria-label={`${snapshot.cyclePosition} de ${snapshot.settings.longBreakEvery} sesiones hasta el descanso largo`}>
              {Array.from({ length: snapshot.settings.longBreakEvery }, (_, index) => (
                <span key={index} className={`size-2 rounded-full ${index < snapshot.cyclePosition ? "bg-[var(--accent)]" : "bg-[var(--track)]"}`} />
              ))}
            </span>
            {snapshot.focusCompletedToday} {snapshot.focusCompletedToday === 1 ? "sesión de enfoque completada" : "sesiones de enfoque completadas"} hoy
            {snapshot.settings.notifications && <Bell className="size-3" aria-label="Avisos activados" />}
          </div>

          {error && (
            <p role="alert" className="mx-auto mt-4 max-w-md rounded-lg bg-red-500/10 px-3 py-2 text-center text-[11px] text-red-500">
              {error}
              <button type="button" onClick={() => setError(null)} className="ml-2 underline">Cerrar</button>
            </p>
          )}
        </section>

        <div className="space-y-5">
          <SettingsCard settings={snapshot.settings} onSave={(value) => run(() => flowdeskApi.updatePomodoroSettings(value))} />
          <TodaySessions />
        </div>
      </div>
    </div>
  );
}

