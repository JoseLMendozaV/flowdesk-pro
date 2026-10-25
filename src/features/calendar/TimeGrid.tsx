import { useEffect, useRef } from "react";
import type { CalendarEvent, CalendarRange, CalendarTask } from "../../types/calendar";
import { DAY_MINUTES, eventsOnDay, minutesLabel, placeTimedEvents, sameDay, startOfDay, tasksOnDay } from "./calendarDates";
import { EventBlock, EventChip, TaskChip } from "./CalendarItems";

const HOUR_HEIGHT = 44;
const PIXELS_PER_MINUTE = HOUR_HEIGHT / 60;
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const dayHeader = new Intl.DateTimeFormat("es-ES", { weekday: "short" });

type TimeGridProps = {
  days: Date[];
  data: CalendarRange;
  now: Date;
  onOpenDay?: (day: Date) => void;
  onCreate: (start: Date) => void;
  onCreateAllDay: (day: Date) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onToggleTask: (task: CalendarTask) => void;
};

/** Cuadrícula horaria para las vistas de día y semana. */
export function TimeGrid({ days, data, now, onOpenDay, onCreate, onCreateAllDay, onOpenEvent, onToggleTask }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = `52px repeat(${days.length}, minmax(0, 1fr))`;

  // Al abrir, la jornada empieza visible desde las 7:00.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
  }, []);

  function createAt(day: Date, mouseEvent: React.MouseEvent<HTMLDivElement>) {
    const bounds = mouseEvent.currentTarget.getBoundingClientRect();
    const minutes = Math.floor((mouseEvent.clientY - bounds.top) / PIXELS_PER_MINUTE / 30) * 30;
    const start = startOfDay(day);
    start.setMinutes(Math.min(Math.max(minutes, 0), DAY_MINUTES - 60));
    onCreate(start);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid flex-none border-b border-[var(--line)]" style={{ gridTemplateColumns: columns }}>
        <div className="flex items-end justify-end px-1.5 pb-1 text-[9px] text-[var(--muted)]">Todo el día</div>
        {days.map((day) => {
          const isToday = sameDay(day, now);
          const allDay = eventsOnDay(data.events, day).filter((event) => event.isAllDay);
          const untimed = tasksOnDay(data.tasks, day).filter((task) => !task.dueHasTime);
          return (
            <div key={day.getTime()} className="min-w-0 border-l border-[var(--line)]">
              <button
                type="button"
                disabled={!onOpenDay}
                onClick={() => onOpenDay?.(day)}
                className="flex w-full items-baseline gap-1.5 px-2 pb-1 pt-1.5 text-left enabled:hover:text-[var(--accent)]"
              >
                <span className="text-[10px] capitalize text-[var(--muted)]">{dayHeader.format(day)}</span>
                <span className={`grid min-w-5 place-items-center rounded-full px-1 text-[12px] font-semibold tabular-nums ${isToday ? "bg-[var(--accent)] text-white" : ""}`}>{day.getDate()}</span>
              </button>
              <div role="gridcell" onClick={() => onCreateAllDay(day)} className="min-h-6 space-y-0.5 px-1 pb-1">
                {allDay.map((event) => <EventChip key={event.id} event={event} onOpen={onOpenEvent} />)}
                {untimed.map((task) => <TaskChip key={task.id} task={task} onToggle={onToggleTask} />)}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR_HEIGHT }}>
          <div className="relative">
            {hours.map((hour) => (
              <span key={hour} className="absolute right-1.5 -translate-y-1/2 text-[9px] tabular-nums text-[var(--muted)]" style={{ top: hour * HOUR_HEIGHT }}>
                {hour === 0 ? "" : minutesLabel(hour * 60)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const placed = placeTimedEvents(eventsOnDay(data.events, day), day);
            const timedTasks = tasksOnDay(data.tasks, day).filter((task) => task.dueHasTime);
            const nowMinutes = sameDay(day, now) ? now.getHours() * 60 + now.getMinutes() : null;
            return (
              <div
                key={day.getTime()}
                role="gridcell"
                onClick={(mouseEvent) => createAt(day, mouseEvent)}
                className="relative border-l border-[var(--line)]"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--grid) 0 1px, transparent 1px ${HOUR_HEIGHT}px)`,
                }}
              >
                {placed.map(({ event, top, height, column, columns: count }) => (
                  <div
                    key={event.id}
                    className="absolute px-px"
                    style={{
                      top: top * PIXELS_PER_MINUTE,
                      height: Math.max(height * PIXELS_PER_MINUTE - 1, 16),
                      left: `${(column / count) * 100}%`,
                      width: `${100 / count}%`,
                    }}
                  >
                    <EventBlock event={event} compact={height < 40} onOpen={onOpenEvent} />
                  </div>
                ))}
                {timedTasks.map((task) => {
                  const due = new Date(task.dueAt * 1000);
                  const minutes = due.getHours() * 60 + due.getMinutes();
                  return (
                    <div key={task.id} className="absolute inset-x-1 z-[1] rounded-[5px] bg-[var(--surface)] shadow-sm" style={{ top: minutes * PIXELS_PER_MINUTE }}>
                      <TaskChip task={task} onToggle={onToggleTask} />
                    </div>
                  );
                })}
                {nowMinutes !== null && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-[2] h-px bg-red-500" style={{ top: nowMinutes * PIXELS_PER_MINUTE }}>
                    <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
