import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { DemoFrame } from "./DemoFrame";

const sessions = [
  { id: "focus", label: "Enfoque", minutes: 25, color: "var(--accent)" },
  { id: "short", label: "Descanso corto", minutes: 5, color: "#10b981" },
  { id: "long", label: "Descanso largo", minutes: 15, color: "#10b981" },
] as const;

/** Temporizador ilustrativo acelerado (un minuto por segundo). No inicia ningún Pomodoro real. */
export function PomodoroDemo({ paused }: { paused: boolean }) {
  const [sessionIndex, setSessionIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  const session = sessions[sessionIndex];
  const total = session.minutes * 60;
  const remaining = Math.max(0, total - elapsed);

  useEffect(() => {
    if (!running || paused) return;
    const interval = window.setInterval(() => setElapsed((value) => (value + 60 >= total ? 0 : value + 60)), 1000);
    return () => window.clearInterval(interval);
  }, [paused, running, total]);

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const progress = elapsed / total;
  const minutes = Math.floor(remaining / 60);

  return (
    <DemoFrame paused={paused} note="Demostración acelerada: no inicia ningún temporizador real.">
      <div className="demo-window absolute inset-[7%] flex flex-col items-center justify-center gap-3 p-3">
        <div role="radiogroup" aria-label="Tipo de sesión de prueba" className="flex rounded-md bg-[var(--inset)] p-0.5 text-[9px]">
          {sessions.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={index === sessionIndex}
              onClick={() => {
                setSessionIndex(index);
                setElapsed(0);
              }}
              className={`rounded px-2 py-0.5 ${index === sessionIndex ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)]"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="relative grid size-32 place-items-center">
          <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--track)" strokeWidth="7" />
            <circle cx="60" cy="60" r={radius} fill="none" stroke={session.color} strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} style={{ transition: paused ? "none" : "stroke-dashoffset 900ms linear" }} />
          </svg>
          <div className="text-center" role="timer" aria-label={`Quedan ${minutes} minutos de ${session.label.toLowerCase()}`}>
            <div className="text-[26px] font-semibold tabular-nums tracking-[-0.04em]">{String(minutes).padStart(2, "0")}:00</div>
            <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--muted)]">{session.label}</div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setRunning((value) => !value)} className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[10px] font-medium text-white">
            {running ? <><Pause className="size-3" /> Pausar</> : <><Play className="size-3" /> Reanudar</>}
          </button>
          <button type="button" onClick={() => setElapsed(0)} className="flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[10px] text-[var(--muted)]">
            <RotateCcw className="size-3" /> Reiniciar
          </button>
        </div>
      </div>
    </DemoFrame>
  );
}
