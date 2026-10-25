import { useState } from "react";
import { Table2, BarChart3 } from "lucide-react";
import { formatDuration } from "../../services/format";
import type { DayStat } from "../../types/focus";

const shortDay = new Intl.DateTimeFormat("es-ES", { weekday: "short" });
const longDay = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });

/** Escalas cuya mitad también es redonda: 20 min (10), 1 h (30 min), 4 h (2 h)… */
const NICE_MAXIMUMS = [1200, 1800, 3600, 7200, 14400, 21600, 28800, 43200, 57600, 86400];

const series = [
  { key: "trackedSeconds", label: "Registrado", color: "var(--series-1)" },
  { key: "focusSeconds", label: "Concentración", color: "var(--series-2)" },
] as const;

function axisLabel(seconds: number) {
  if (seconds === 0) return "0";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = seconds / 3600;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(".", ",")} h`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function WeeklyChart({ days, todayStart }: { days: DayStat[]; todayStart: number }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<number | null>(null);
  const peak = Math.max(0, ...days.flatMap((day) => [day.trackedSeconds, day.focusSeconds]));
  const max = NICE_MAXIMUMS.find((value) => value >= peak) ?? Math.ceil(peak / 3600) * 3600;
  const ticks = [max, max / 2, 0];

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Tiempo por día</h2>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">Semana actual. Cada sesión de enfoque se suma al tiempo registrado al terminar.</p>
        </div>
        <div className="flex items-center gap-3">
          <ul className="flex gap-3 text-[10px] text-[var(--muted)]" aria-label="Leyenda">
            {series.map((item) => (
              <li key={item.key} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: item.color }} />
                {item.label}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setView(view === "chart" ? "table" : "chart")}
            aria-label={view === "chart" ? "Ver como tabla" : "Ver como gráfico"}
            title={view === "chart" ? "Ver como tabla" : "Ver como gráfico"}
            className="grid size-7 place-items-center rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            {view === "chart" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
          </button>
        </div>
      </header>

      {view === "table" ? (
        <table className="w-full text-[11px]">
          <thead className="text-left text-[10px] text-[var(--muted)]">
            <tr>
              <th className="py-1.5 font-medium">Día</th>
              <th className="py-1.5 text-right font-medium">Registrado</th>
              <th className="py-1.5 text-right font-medium">Concentración</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {days.map((day) => (
              <tr key={day.dayStart} className={day.dayStart === todayStart ? "font-semibold" : ""}>
                <td className="py-1.5">{capitalize(longDay.format(new Date(day.dayStart * 1000)))}</td>
                <td className="py-1.5 text-right tabular-nums">{formatDuration(day.trackedSeconds)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatDuration(day.focusSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex gap-2">
          <div className="relative h-40 w-10 flex-none text-right text-[9px] tabular-nums text-[var(--muted)]" aria-hidden="true">
            {ticks.map((tick, index) => (
              <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}>
                {axisLabel(tick)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-40">
              {ticks.map((tick, index) => (
                <div key={tick} className="absolute inset-x-0 h-px bg-[var(--grid)]" style={{ top: `${(index / (ticks.length - 1)) * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex">
                {days.map((day, index) => {
                  const label = capitalize(longDay.format(new Date(day.dayStart * 1000)));
                  return (
                    <div
                      key={day.dayStart}
                      tabIndex={0}
                      role="img"
                      aria-label={`${label}: ${formatDuration(day.trackedSeconds)} registrado, ${formatDuration(day.focusSeconds)} de concentración`}
                      onPointerEnter={() => setActive(index)}
                      onPointerLeave={() => setActive(null)}
                      onFocus={() => setActive(index)}
                      onBlur={() => setActive(null)}
                      className={`relative flex flex-1 items-end justify-center gap-[2px] rounded-md outline-none transition focus-visible:bg-[var(--hover)] ${active === index ? "bg-[var(--hover)]" : ""}`}
                    >
                      {series.map((item) => {
                        const value = day[item.key];
                        return (
                          <span
                            key={item.key}
                            className="w-3.5 max-w-6 rounded-t-[4px]"
                            style={{
                              backgroundColor: item.color,
                              height: value > 0 ? `max(2px, ${(value / max) * 100}%)` : 0,
                            }}
                          />
                        );
                      })}
                      {active === index && (
                        <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-[10px] shadow-lg">
                          <p className="mb-1 text-[var(--muted)]">{label}</p>
                          {series.map((item) => (
                            <p key={item.key} className="flex items-center gap-2">
                              <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                              <strong className="font-semibold tabular-nums">{formatDuration(day[item.key])}</strong>
                              <span className="text-[var(--muted)]">{item.label.toLowerCase()}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-1.5 flex text-[10px] text-[var(--muted)]" aria-hidden="true">
              {days.map((day) => (
                <span key={day.dayStart} className={`flex-1 text-center ${day.dayStart === todayStart ? "font-semibold text-[var(--text)]" : ""}`}>
                  {shortDay.format(new Date(day.dayStart * 1000)).replace(".", "")}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {peak === 0 && view === "chart" && (
        <p className="mt-3 text-center text-[11px] text-[var(--muted)]">Aún no hay tiempo registrado esta semana.</p>
      )}
    </section>
  );
}
