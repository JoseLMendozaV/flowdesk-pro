import type { CalendarEvent, CalendarRange, CalendarTask } from "../../types/calendar";
import { eventsOnDay, sameDay, tasksOnDay } from "./calendarDates";
import { EventChip, TaskChip, eventKey } from "./CalendarItems";

const weekdays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MAX_ITEMS = 3;

type MonthViewProps = {
  anchor: Date;
  days: Date[];
  data: CalendarRange;
  today: Date;
  onOpenDay: (day: Date) => void;
  onCreate: (day: Date) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onToggleTask: (task: CalendarTask) => void;
};

export function MonthView({ anchor, days, data, today, onOpenDay, onCreate, onOpenEvent, onToggleTask }: MonthViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid flex-none grid-cols-7 border-b border-[var(--line)]">
        {weekdays.map((weekday) => (
          <div key={weekday} className="px-2 py-1.5 text-[10px] font-medium text-[var(--muted)]">{weekday}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const events = eventsOnDay(data.events, day);
          const tasks = tasksOnDay(data.tasks, day);
          const outside = day.getMonth() !== anchor.getMonth();
          const isToday = sameDay(day, today);
          const hidden = Math.max(0, events.length + tasks.length - MAX_ITEMS);
          const visibleEvents = events.slice(0, MAX_ITEMS);
          const visibleTasks = tasks.slice(0, MAX_ITEMS - visibleEvents.length);
          return (
            <div
              key={day.getTime()}
              role="gridcell"
              onClick={() => onCreate(day)}
              className={`group flex min-h-0 min-w-0 cursor-default flex-col gap-0.5 overflow-hidden border-b border-r border-[var(--line)] p-1 ${outside ? "bg-[var(--inset)]" : ""}`}
            >
              <button
                type="button"
                onClick={(mouseEvent) => {
                  mouseEvent.stopPropagation();
                  onOpenDay(day);
                }}
                aria-label={`Ver el día ${day.toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`}
                className={`grid size-5 flex-none place-items-center self-end rounded-full text-[10px] tabular-nums hover:bg-[var(--hover)] ${
                  isToday ? "bg-[var(--accent)] font-semibold text-white hover:bg-[var(--accent)]" : outside ? "text-[var(--muted)] opacity-60" : ""
                }`}
              >
                {day.getDate()}
              </button>
              {visibleEvents.map((event) => <EventChip key={eventKey(event)} event={event} onOpen={onOpenEvent} />)}
              {visibleTasks.map((task) => <TaskChip key={task.id} task={task} onToggle={onToggleTask} />)}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={(mouseEvent) => {
                    mouseEvent.stopPropagation();
                    onOpenDay(day);
                  }}
                  className="px-1 text-left text-[9px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
                >
                  {hidden} más
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
