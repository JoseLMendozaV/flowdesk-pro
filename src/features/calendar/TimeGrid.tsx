import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent, CalendarRange, CalendarTask } from "../../types/calendar";
import {
  DAY_MINUTES,
  eventSpan,
  eventsOnDay,
  minutesLabel,
  moveSpan,
  placeDayItems,
  resizeSpan,
  sameDay,
  snapMinutes,
  startOfDay,
  taskSpan,
  tasksOnDay,
  type Span,
} from "./calendarDates";
import { EventBlock, EventChip, TaskBlock, TaskChip, eventKey } from "./CalendarItems";

const HOUR_HEIGHT = 44;
const PIXELS_PER_MINUTE = HOUR_HEIGHT / 60;
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const dayHeader = new Intl.DateTimeFormat("es-ES", { weekday: "short" });
/** Píxeles que hay que mover el ratón para que un clic pase a ser un arrastre. */
const DRAG_THRESHOLD = 4;
const HOURS_COLUMN = 52;

/** Cambio de horario hecho arrastrando o estirando un bloque. */
export type GridChange =
  | { kind: "event"; event: CalendarEvent; span: Span }
  | { kind: "task"; task: CalendarTask; span: Span };

type DragTarget = { kind: "event"; event: CalendarEvent } | { kind: "task"; task: CalendarTask };

type Drag = {
  mode: "move" | "resize";
  target: DragTarget;
  key: string;
  span: Span;
  originX: number;
  originMinute: number;
  originDay: number;
  started: boolean;
  dayDelta: number;
  minuteDelta: number;
};

function itemKey(target: DragTarget) {
  return target.kind === "event" ? eventKey(target.event) : `task-${target.task.id}`;
}

function draggedSpan(drag: Drag) {
  return drag.mode === "move" ? moveSpan(drag.span, drag.dayDelta, drag.minuteDelta) : resizeSpan(drag.span, drag.minuteDelta);
}

/** Los datos con el bloque arrastrado en su nueva posición, para dibujarlo mientras se mueve. */
function withSpan(data: CalendarRange, target: DragTarget, span: Span): CalendarRange {
  if (target.kind === "event") {
    const key = eventKey(target.event);
    return { ...data, events: data.events.map((event) => (eventKey(event) === key ? { ...event, startsAt: span.start, endsAt: span.end } : event)) };
  }
  const minutes = Math.round((span.end - span.start) / 60);
  return {
    ...data,
    tasks: data.tasks.map((task) => (task.id === target.task.id ? { ...task, dueAt: span.start, dueHasTime: true, estimatedMinutes: minutes } : task)),
  };
}
type TimeGridProps = {
  days: Date[];
  data: CalendarRange;
  now: Date;
  onOpenDay?: (day: Date) => void;
  onCreate: (start: Date) => void;
  onCreateAllDay: (day: Date) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onToggleTask: (task: CalendarTask) => void;
  onOpenTask: (task: CalendarTask) => void;
  /** Hora por defecto de las tareas sin hora; `null`: van a la franja de todo el día. */
  untimedTaskMinute: number | null;
  /** Guarda un bloque arrastrado o estirado; `false` si no se aplicó (se canceló). */
  onChange?: (change: GridChange) => Promise<boolean>;
};

/** Cuadrícula horaria para las vistas de día y semana. */
export function TimeGrid({ days, data, now, onOpenDay, onCreate, onCreateAllDay, onOpenEvent, onToggleTask, onOpenTask, untimedTaskMinute, onChange }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = `${HOURS_COLUMN}px repeat(${days.length}, minmax(0, 1fr))`;
  const [drag, setDrag] = useState<Drag | null>(null);
  // Tras soltar, el bloque se queda en su sitio nuevo hasta que llegan los datos guardados.
  const [committed, setCommitted] = useState<{ target: DragTarget; span: Span } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  dragRef.current = drag;

  useEffect(() => setCommitted(null), [data]);

  const shown = useMemo(() => {
    if (drag?.started) return withSpan(data, drag.target, draggedSpan(drag));
    if (committed) return withSpan(data, committed.target, committed.span);
    return data;
  }, [committed, data, drag]);

  /** Minuto del día y columna bajo el puntero. */
  function pointerPosition(clientX: number, clientY: number) {
    const bounds = gridRef.current!.getBoundingClientRect();
    const width = (bounds.width - HOURS_COLUMN) / days.length;
    const day = Math.min(days.length - 1, Math.max(0, Math.floor((clientX - bounds.left - HOURS_COLUMN) / width)));
    return { day, minute: (clientY - bounds.top) / PIXELS_PER_MINUTE };
  }

  function startDrag(pointer: React.PointerEvent, target: DragTarget, mode: Drag["mode"]) {
    if (!onChange || pointer.button !== 0 || (pointer.target as HTMLElement).closest("[data-no-drag]")) return;
    pointer.stopPropagation();
    const { day, minute } = pointerPosition(pointer.clientX, pointer.clientY);
    const span = target.kind === "event" ? eventSpan(target.event) : taskSpan(target.task, untimedTaskMinute);
    setDrag({ mode, target, key: itemKey(target), span, originX: pointer.clientX, originMinute: minute, originDay: day, started: false, dayDelta: 0, minuteDelta: 0 });
  }

  useEffect(() => {
    if (!drag) return;
    function move(pointer: PointerEvent) {
      const current = dragRef.current;
      if (!current) return;
      const { day, minute } = pointerPosition(pointer.clientX, pointer.clientY);
      const distance = Math.max(Math.abs(pointer.clientX - current.originX), Math.abs(minute - current.originMinute) * PIXELS_PER_MINUTE);
      if (!current.started && distance < DRAG_THRESHOLD) return;
      setDrag({
        ...current,
        started: true,
        dayDelta: current.mode === "move" ? day - current.originDay : 0,
        minuteDelta: snapMinutes(minute - current.originMinute),
      });
    }
    function finish(pointer: PointerEvent | KeyboardEvent) {
      const current = dragRef.current;
      setDrag(null);
      if (!current?.started) return;
      // El clic que sigue a soltar no debe abrir el bloque ni crear un evento.
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      if (pointer instanceof KeyboardEvent || (current.dayDelta === 0 && current.minuteDelta === 0)) return;
      const span = draggedSpan(current);
      setCommitted({ target: current.target, span });
      const change: GridChange = current.target.kind === "event" ? { kind: "event", event: current.target.event, span } : { kind: "task", task: current.target.task, span };
      void onChange?.(change).then((applied) => !applied && setCommitted(null));
    }
    function cancel(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") {
        keyEvent.stopPropagation();
        finish(keyEvent);
      }
    }
    document.body.style.cursor = drag.mode === "move" ? "grabbing" : "ns-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("keydown", cancel, true);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("keydown", cancel, true);
    };
    // Solo al empezar y terminar: el resto se lee de `dragRef`.
  }, [drag !== null]);

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
    <div
      className="flex h-full min-h-0 flex-col"
      onClickCapture={(clickEvent) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
      }}
    >
      <div className="grid flex-none border-b border-[var(--line)]" style={{ gridTemplateColumns: columns }}>
        <div className="flex items-end justify-end px-1.5 pb-1 text-[9px] text-[var(--muted)]">Todo el día</div>
        {days.map((day) => {
          const isToday = sameDay(day, now);
          const allDay = eventsOnDay(data.events, day).filter((event) => event.isAllDay);
          const untimed = untimedTaskMinute === null ? tasksOnDay(data.tasks, day).filter((task) => !task.dueHasTime) : [];
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
                {allDay.map((event) => <EventChip key={eventKey(event)} event={event} onOpen={onOpenEvent} />)}
                {untimed.map((task) => <TaskChip key={task.id} task={task} onToggle={onToggleTask} />)}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={gridRef} className="relative grid select-none" style={{ gridTemplateColumns: columns, height: 24 * HOUR_HEIGHT }}>
          <div className="relative">
            {hours.map((hour) => (
              <span key={hour} className="absolute right-1.5 -translate-y-1/2 text-[9px] tabular-nums text-[var(--muted)]" style={{ top: hour * HOUR_HEIGHT }}>
                {hour === 0 ? "" : minutesLabel(hour * 60)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const placed = placeDayItems(eventsOnDay(shown.events, day), tasksOnDay(shown.tasks, day), day, untimedTaskMinute);
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
                {placed.map((item) => {
                  const target: DragTarget = item.kind === "event" ? { kind: "event", event: item.event } : { kind: "task", task: item.task };
                  const key = itemKey(target);
                  const dragging = drag?.started && drag.key === key;
                  return (
                    <div
                      key={key}
                      onPointerDown={(pointer) => startDrag(pointer, target, "move")}
                      className={`group/block absolute px-px ${dragging ? "z-[3] opacity-90 drop-shadow-lg" : "z-[1]"} ${onChange ? "cursor-grab" : ""}`}
                      style={{
                        top: item.top * PIXELS_PER_MINUTE,
                        height: Math.max(item.height * PIXELS_PER_MINUTE - 1, 16),
                        left: `${(item.column / item.columns) * 100}%`,
                        width: `${100 / item.columns}%`,
                      }}
                    >
                      {item.kind === "event" ? (
                        <EventBlock event={item.event} compact={item.height < 40} onOpen={onOpenEvent} />
                      ) : (
                        <TaskBlock task={item.task} defaultTime={item.defaultTime && !dragging} compact={item.height < 40} onToggle={onToggleTask} onOpen={onOpenTask} />
                      )}
                      {onChange && (
                        <div
                          aria-hidden
                          onPointerDown={(pointer) => startDrag(pointer, target, "resize")}
                          className="absolute inset-x-1 -bottom-0.5 h-2 cursor-ns-resize rounded-full opacity-0 group-hover/block:opacity-100"
                        >
                          <span className="mx-auto mt-0.5 block h-0.5 w-6 rounded-full bg-[var(--muted)]/60" />
                        </div>
                      )}
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
