import { Pause, Play, RotateCw } from "lucide-react";
import { flowdeskApi } from "../../services/flowdeskApi";
import { formatClock, sessionLabels, useLiveTimer, useTimer } from "./useTimer";

/** Temporizador resumido con su control principal (dashboard). */
export function CompactTimer({ onOpen }: { onOpen: () => void }) {
  const { snapshot, error, run } = useTimer();
  const live = useLiveTimer(snapshot);
  if (!snapshot) return null;
  const pomodoro = snapshot.pomodoro;
  const nextMinutes =
    snapshot.nextSessionType === "focus"
      ? snapshot.settings.focusMinutes
      : snapshot.nextSessionType === "short_break"
        ? snapshot.settings.shortBreakMinutes
        : snapshot.settings.longBreakMinutes;

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-center">
      <button type="button" onClick={onOpen} className="block w-full">
        <div className="text-xl font-semibold tabular-nums">{formatClock(pomodoro ? live.remaining : nextMinutes * 60)}</div>
        <p className="mt-1 text-[10px] text-[var(--muted)]">
          {pomodoro
            ? `${sessionLabels[pomodoro.sessionType]}${pomodoro.status === "paused" ? " · en pausa" : ""}`
            : `Siguiente: ${sessionLabels[snapshot.nextSessionType].toLowerCase()}`}
        </p>
      </button>
      <button
        type="button"
        onClick={() => void run(flowdeskApi.togglePomodoro)}
        className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] font-medium text-[var(--accent)]"
      >
        {pomodoro?.status === "running" ? <><Pause className="size-3" /> Pausar</> : pomodoro ? <><RotateCw className="size-3" /> Reanudar</> : <><Play className="size-3" /> Iniciar</>}
      </button>
      {error && <p className="mt-2 text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
