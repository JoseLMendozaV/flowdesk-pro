import { Check, Flag, Hourglass, ListChecks, Repeat, StickyNote } from "lucide-react";
import { describeDue } from "../../services/format";
import type { TaskSummary } from "../../types/tasks";
import { isClosed, priorityMeta } from "./taskMeta";

type TaskMetaProps = { task: TaskSummary; hideProject?: boolean };

/** Inicio de una tarea que todavía no se puede empezar («Empieza el lunes»), o `null`. */
export function pendingStart(task: TaskSummary, now = new Date()) {
  if (!task.startsAt) return null;
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  if (task.startsAt * 1000 < tomorrow.getTime()) return null;
  return `Empieza ${describeDue(task.startsAt, false, now).label.toLocaleLowerCase("es")}`;
}

export function TaskMetaLine({ task, hideProject }: TaskMetaProps) {
  const due = task.dueAt ? describeDue(task.dueAt, task.dueHasTime) : null;
  const start = isClosed(task.status) ? null : pendingStart(task);
  const closed = isClosed(task.status);
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-[var(--muted)]">
      {due && (
        <span className={!closed && due.overdue ? "font-medium text-red-500" : due.today && !closed ? "text-[var(--accent)]" : ""}>
          {due.label}
        </span>
      )}
      {start && (
        <span className="flex items-center gap-0.5" title="Hasta ese día no aparece en Hoy">
          <Hourglass className="size-3" /> {start}
        </span>
      )}
      {task.recurrence && (
        <span className="flex items-center" title="Se repite" aria-label="Se repite">
          <Repeat className="size-3" />
        </span>
      )}
      {!hideProject && task.projectName && (
        <span className="flex min-w-0 items-center gap-1">
          <span className="size-1.5 flex-none rounded-full" style={{ backgroundColor: task.projectColor ?? undefined }} />
          <span className="truncate">{task.projectName}</span>
        </span>
      )}
      {task.subtaskCount > 0 && (
        <span className="flex items-center gap-0.5">
          <ListChecks className="size-3" /> {task.subtasksCompleted}/{task.subtaskCount}
        </span>
      )}
      {task.noteCount > 0 && (
        <span className="flex items-center gap-0.5">
          <StickyNote className="size-3" /> {task.noteCount}
        </span>
      )}
      {task.tags.map((tag) => (
        <span key={tag.id} className="rounded-full px-1.5 py-px text-[9px] font-medium" style={{ color: tag.color, backgroundColor: `${tag.color}1f` }}>
          #{tag.name}
        </span>
      ))}
    </div>
  );
}

type TaskCheckProps = { task: TaskSummary; onToggle: (task: TaskSummary) => void; size?: "sm" | "md" };

export function TaskCheck({ task, onToggle, size = "md" }: TaskCheckProps) {
  const done = task.status === "completed";
  const dimension = size === "sm" ? "size-3.5" : "size-4";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(task);
      }}
      aria-label={done ? `Marcar “${task.title}” como pendiente` : `Completar “${task.title}”`}
      aria-pressed={done}
      className={`grid ${dimension} flex-none place-items-center rounded-full border transition ${
        done
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-[var(--line-strong)] text-transparent hover:border-emerald-500 hover:text-emerald-500"
      }`}
    >
      <Check className="size-2.5" strokeWidth={3} />
    </button>
  );
}

type TaskRowProps = {
  task: TaskSummary;
  selected: boolean;
  hideProject?: boolean;
  onSelect: (task: TaskSummary) => void;
  onToggle: (task: TaskSummary) => void;
};

export function TaskRow({ task, selected, hideProject, onSelect, onToggle }: TaskRowProps) {
  const priority = priorityMeta(task.priority);
  const closed = isClosed(task.status);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(task)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter") onSelect(task);
          if (event.key === " ") {
            event.preventDefault();
            onToggle(task);
          }
        }}
        className={`group flex cursor-default items-start gap-3 rounded-xl px-3 py-2.5 outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] ${
          selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
        }`}
      >
        <span className="pt-0.5">
          <TaskCheck task={task} onToggle={onToggle} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-xs font-medium ${closed ? "text-[var(--muted)] line-through" : ""}`}>
            {task.title}
            {task.status === "in_progress" && (
              <span className="ml-2 rounded-full bg-blue-500/10 px-1.5 py-px align-middle text-[9px] font-medium text-blue-500 no-underline">En curso</span>
            )}
          </p>
          <TaskMetaLine task={task} hideProject={hideProject} />
        </div>
        {task.priority !== "none" && (
          <Flag className={`mt-0.5 size-3.5 flex-none ${priority.className}`} aria-label={`Prioridad ${priority.label}`} />
        )}
      </div>
    </li>
  );
}
