import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { EventDialog, type EventDraft } from "../features/calendar/EventDialog";
import { MonthView } from "../features/calendar/MonthView";
import { TimeGrid } from "../features/calendar/TimeGrid";
import { addDays, rangeTitle, shiftAnchor, startOfDay, unix, visibleDays } from "../features/calendar/calendarDates";
import { useCalendar, useMinuteClock } from "../features/calendar/useCalendar";
import { flowdeskApi } from "../services/flowdeskApi";
import { errorMessage } from "../services/format";
import { useAppStore } from "../stores/appStore";
import type { CalendarEvent, CalendarMode, CalendarTask } from "../types/calendar";

const modes: { value: CalendarMode; label: string; key: string }[] = [
  { value: "day", label: "Día", key: "d" },
  { value: "week", label: "Semana", key: "s" },
  { value: "month", label: "Mes", key: "m" },
];

type Editing = { event: CalendarEvent | null; draft: EventDraft };

function timedDraft(start: Date): EventDraft {
  return { startsAt: unix(start), endsAt: unix(start) + 3600, isAllDay: false };
}

function allDayDraft(day: Date): EventDraft {
  const start = startOfDay(day);
  return { startsAt: unix(start), endsAt: unix(addDays(start, 1)), isAllDay: true };
}

export function CalendarPage() {
  const mode = useAppStore((state) => state.calendarMode);
  const setMode = useAppStore((state) => state.setCalendarMode);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = useMinuteClock();

  const days = useMemo(() => visibleDays(mode, anchor), [mode, anchor]);
  const start = unix(days[0]);
  const end = unix(addDays(days[days.length - 1], 1));
  const { data, loading, error } = useCalendar(start, end);

  function openDay(day: Date) {
    setAnchor(startOfDay(day));
    setMode("day");
  }

  function newEvent() {
    const start = new Date(anchor);
    const current = new Date();
    // Siguiente hora en punto de hoy, o las 9:00 de otro día.
    if (startOfDay(current).getTime() === anchor.getTime()) start.setHours(Math.min(current.getHours() + 1, 23));
    else start.setHours(9);
    setEditing({ event: null, draft: timedDraft(start) });
  }

  async function toggleTask(task: CalendarTask) {
    try {
      await flowdeskApi.setTaskStatus(task.id, task.status === "completed" ? "pending" : "completed");
      setActionError(null);
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  }

  useEffect(() => {
    function handle(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (editing || event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft") setAnchor((value) => shiftAnchor(mode, value, -1));
      else if (event.key === "ArrowRight") setAnchor((value) => shiftAnchor(mode, value, 1));
      else if (event.key.toLowerCase() === "t") setAnchor(startOfDay(new Date()));
      else {
        const match = modes.find((option) => option.key === event.key.toLowerCase());
        if (!match) return;
        setMode(match.value);
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [editing, mode, setMode]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header data-tauri-drag-region="deep" className="flex h-[74px] flex-none items-end justify-between gap-4 border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-[-0.025em]">{rangeTitle(mode, anchor)}</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Eventos y fechas límite de tus tareas · ← → para moverte, T para hoy</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <div data-tour-id="calendar-navigation" className="flex items-center rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <button type="button" onClick={() => setAnchor((value) => shiftAnchor(mode, value, -1))} aria-label="Anterior" className="grid size-7 place-items-center text-[var(--muted)] hover:text-[var(--text)]"><ChevronLeft className="size-4" /></button>
            <button type="button" onClick={() => setAnchor(startOfDay(new Date()))} className="px-2 text-[11px] font-medium">Hoy</button>
            <button type="button" onClick={() => setAnchor((value) => shiftAnchor(mode, value, 1))} aria-label="Siguiente" className="grid size-7 place-items-center text-[var(--muted)] hover:text-[var(--text)]"><ChevronRight className="size-4" /></button>
          </div>
          <div role="radiogroup" aria-label="Vista del calendario" data-tour-id="calendar-modes" className="flex rounded-lg border border-[var(--line)] bg-[var(--surface)] p-0.5">
            {modes.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={mode === option.value}
                title={`${option.label} (${option.key.toUpperCase()})`}
                onClick={() => setMode(option.value)}
                className={`rounded-md px-2.5 py-1 text-[11px] ${mode === option.value ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" data-tour-id="calendar-new" onClick={newEvent} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white shadow-sm hover:brightness-105">
            <Plus className="size-3.5" /> Nuevo evento
          </button>
        </div>
      </header>

      {(error || actionError) && <div className="mx-6 mt-3 rounded-xl bg-red-500/10 px-4 py-2 text-xs text-red-500">{error ?? actionError}</div>}

      <div data-tour-id="calendar-grid" className={`min-h-0 flex-1 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {mode === "month" ? (
          <MonthView
            anchor={anchor}
            days={days}
            data={data}
            today={now}
            onOpenDay={openDay}
            onCreate={(day) => setEditing({ event: null, draft: allDayDraft(day) })}
            onOpenEvent={(event) => setEditing({ event, draft: event })}
            onToggleTask={(task) => void toggleTask(task)}
          />
        ) : (
          <TimeGrid
            days={days}
            data={data}
            now={now}
            onOpenDay={mode === "week" ? openDay : undefined}
            onCreate={(start) => setEditing({ event: null, draft: timedDraft(start) })}
            onCreateAllDay={(day) => setEditing({ event: null, draft: allDayDraft(day) })}
            onOpenEvent={(event) => setEditing({ event, draft: event })}
            onToggleTask={(task) => void toggleTask(task)}
          />
        )}
      </div>

      {editing && <EventDialog key={editing.event?.id ?? "new"} event={editing.event} draft={editing.draft} onClose={() => setEditing(null)} />}
    </div>
  );
}
