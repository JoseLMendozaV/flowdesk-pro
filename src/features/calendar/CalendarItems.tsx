import { Check, MapPin, Repeat } from "lucide-react";
import { formatTime } from "../../services/format";
import type { CalendarEvent, CalendarTask } from "../../types/calendar";

const fallbackColor = "#6C8CFF";

export function eventColor(event: CalendarEvent) {
  return event.projectColor ?? fallbackColor;
}

/** Las repeticiones de un evento comparten `id`: la clave incluye su inicio. */
export function eventKey(event: CalendarEvent) {
  return `${event.id}-${event.startsAt}`;
}

/** Fila compacta para la vista de mes y la franja de todo el día. */
export function EventChip({ event, onOpen }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void }) {
  const color = eventColor(event);
  return (
    <button
      type="button"
      onClick={(mouseEvent) => {
        mouseEvent.stopPropagation();
        onOpen(event);
      }}
      title={event.title}
      className="flex w-full min-w-0 items-center gap-1 rounded-[5px] px-1 py-[1px] text-left text-[10px] leading-4 hover:brightness-95"
      style={event.isAllDay ? { backgroundColor: `${color}26`, color: "var(--text)" } : undefined}
    >
      {!event.isAllDay && <span className="size-1.5 flex-none rounded-full" style={{ backgroundColor: color }} />}
      {!event.isAllDay && <span className="flex-none text-[9px] tabular-nums text-[var(--muted)]">{formatTime(event.startsAt)}</span>}
      <span className="truncate">{event.title}</span>
      {event.recurrence && <Repeat className="size-2.5 flex-none text-[var(--muted)]" aria-label="Se repite" />}
    </button>
  );
}

export function TaskChip({ task, onToggle }: { task: CalendarTask; onToggle: (task: CalendarTask) => void }) {
  const done = task.status === "completed";
  return (
    <button
      type="button"
      onClick={(mouseEvent) => {
        mouseEvent.stopPropagation();
        onToggle(task);
      }}
      title={done ? `Marcar como pendiente: ${task.title}` : `Completar: ${task.title}`}
      aria-label={done ? `Marcar como pendiente: ${task.title}` : `Completar: ${task.title}`}
      className="group flex w-full min-w-0 items-center gap-1 rounded-[5px] px-1 py-[1px] text-left text-[10px] leading-4 hover:bg-[var(--hover)]"
    >
      <span
        className={`grid size-3 flex-none place-items-center rounded-full border ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-[var(--line-strong)] group-hover:border-emerald-500"}`}
        style={!done && task.projectColor ? { borderColor: task.projectColor } : undefined}
      >
        {done && <Check className="size-2" strokeWidth={3.5} />}
      </span>
      {task.dueHasTime && <span className="flex-none text-[9px] tabular-nums text-[var(--muted)]">{formatTime(task.dueAt)}</span>}
      <span className={`truncate ${done ? "text-[var(--muted)] line-through" : ""}`}>{task.title}</span>
    </button>
  );
}

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

/**
 * Bloque de una tarea en la cuadrícula: el círculo la completa y el resto abre su
 * detalle. Las colocadas en la hora por defecto llevan borde discontinuo.
 */
export function TaskBlock({ task, defaultTime, compact, onToggle, onOpen }: { task: CalendarTask; defaultTime: boolean; compact: boolean; onToggle: (task: CalendarTask) => void; onOpen: (task: CalendarTask) => void }) {
  const done = task.status === "completed";
  const color = task.projectColor ?? fallbackColor;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(mouseEvent) => {
        mouseEvent.stopPropagation();
        onOpen(task);
      }}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter") onOpen(task);
      }}
      title={defaultTime ? `${task.title} · sin hora fija` : task.title}
      aria-label={`Tarea: ${task.title}${defaultTime ? ", sin hora fija" : `, ${formatTime(task.dueAt)}`}`}
      className={`flex h-full w-full cursor-pointer gap-1 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[10px] leading-[14px] shadow-sm transition hover:brightness-95 ${defaultTime ? "border-dashed" : ""}`}
      style={{ borderColor: `color-mix(in srgb, ${color} 60%, transparent)`, backgroundColor: `color-mix(in srgb, ${color} 9%, var(--surface))` }}
    >
      <button
        type="button"
        onClick={(mouseEvent) => {
          mouseEvent.stopPropagation();
          onToggle(task);
        }}
        aria-label={done ? `Marcar como pendiente: ${task.title}` : `Completar: ${task.title}`}
        className={`mt-px grid size-3 flex-none place-items-center rounded-full border ${done ? "border-emerald-500 bg-emerald-500 text-white" : "hover:border-emerald-500"}`}
        style={!done ? { borderColor: color } : undefined}
      >
        {done && <Check className="size-2" strokeWidth={3.5} />}
      </button>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-medium ${done ? "text-[var(--muted)] line-through" : ""}`}>{task.title}</span>
        {!compact && (
          <span className="truncate text-[9px] text-[var(--muted)]">
            {defaultTime ? "Sin hora fija" : formatTime(task.dueAt)}
            {task.estimatedMinutes ? ` · ${durationLabel(task.estimatedMinutes)}` : ""}
          </span>
        )}
      </span>
    </div>
  );
}

/** Bloque de un evento con hora dentro de la cuadrícula del día o la semana. */
export function EventBlock({ event, compact, onOpen }: { event: CalendarEvent; compact: boolean; onOpen: (event: CalendarEvent) => void }) {
  const color = eventColor(event);
  return (
    <button
      type="button"
      onClick={(mouseEvent) => {
        mouseEvent.stopPropagation();
        onOpen(event);
      }}
      className="flex h-full w-full flex-col overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[10px] leading-[14px] shadow-sm transition hover:brightness-95"
      style={{ borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 16%, var(--surface))` }}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-medium">{event.title}</span>
        {event.recurrence && <Repeat className="size-2.5 flex-none opacity-60" aria-label="Se repite" />}
      </span>
      {!compact && (
        <span className="truncate text-[9px] text-[var(--muted)]">
          {formatTime(event.startsAt)} – {formatTime(event.endsAt)}
        </span>
      )}
      {!compact && event.location && (
        <span className="flex items-center gap-0.5 truncate text-[9px] text-[var(--muted)]">
          <MapPin className="size-2.5 flex-none" /> {event.location}
        </span>
      )}
    </button>
  );
}
