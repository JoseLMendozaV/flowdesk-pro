import { useEffect, useState } from "react";
import { Square, Timer } from "lucide-react";
import { DemoFrame } from "./DemoFrame";

const week = [
  { day: "L", hours: 5.5 },
  { day: "M", hours: 6.2 },
  { day: "X", hours: 4.1 },
  { day: "J", hours: 7 },
  { day: "V", hours: 3.4 },
  { day: "S", hours: 1.2 },
  { day: "D", hours: 0 },
];

function clock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Cronómetro y semana de ejemplo. No registra tiempo ni activa el seguimiento por app. */
export function TimeDemo({ paused }: { paused: boolean }) {
  const [seconds, setSeconds] = useState(42 * 60 + 10);
  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [paused]);

  return (
    <DemoFrame paused={paused} note="Datos de ejemplo: no se registra tiempo ni se activa el seguimiento.">
      <div className="demo-window absolute inset-[7%] flex flex-col gap-3 p-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Timer className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-semibold tabular-nums leading-none tracking-[-0.03em]">{clock(seconds)}</span>
            <span className="mt-1 flex items-center gap-1 text-[9px] text-[var(--muted)]"><span className="size-1.5 rounded-full bg-violet-500" /> Correo del curso · Docencia</span>
          </span>
          <span className="flex items-center gap-1 rounded-lg border border-[var(--line)] px-2 py-1 text-[9px] text-[var(--muted)]"><Square className="size-2.5" /> Finalizar</span>
        </div>
        <div className="flex min-h-0 flex-1 items-end gap-2 border-b border-[var(--line)] pb-1" role="img" aria-label="Horas registradas de lunes a domingo: 5,5; 6,2; 4,1; 7; 3,4; 1,2 y 0">
          {week.map((entry, index) => (
            <div key={entry.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="demo-bar w-full max-w-6 rounded-t-md" style={{ height: `${(entry.hours / 7) * 100}%`, backgroundColor: "var(--series-1)", animationDelay: `${index * 80}ms` }} />
              <span className="text-[8px] text-[var(--muted)]">{entry.day}</span>
            </div>
          ))}
        </div>
      </div>
    </DemoFrame>
  );
}
