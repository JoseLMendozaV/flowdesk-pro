import { useState } from "react";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import type { TaskStatus, TaskSummary } from "../../types/tasks";
import { TaskMetaLine } from "./TaskRow";
import { priorityMeta } from "./taskMeta";

const columns: { status: TaskStatus; label: string; accent: string }[] = [
  { status: "pending", label: "Pendiente", accent: "bg-slate-400" },
  { status: "in_progress", label: "En curso", accent: "bg-blue-500" },
  { status: "completed", label: "Completada", accent: "bg-emerald-500" },
];

type KanbanBoardProps = {
  tasks: TaskSummary[];
  selectedId: string | null;
  hideProject?: boolean;
  onSelect: (task: TaskSummary) => void;
  onMove: (task: TaskSummary, status: TaskStatus) => void;
};

export function KanbanBoard({ tasks, selectedId, hideProject, onSelect, onMove }: KanbanBoardProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<TaskStatus | null>(null);

  function drop(status: TaskStatus) {
    const task = tasks.find((candidate) => candidate.id === dragging);
    if (task && task.status !== status) onMove(task, status);
    setDragging(null);
    setTarget(null);
  }

  return (
    <div className="grid min-h-0 grid-cols-3 gap-3">
      {columns.map((column, index) => {
        const columnTasks = tasks.filter((task) => task.status === column.status);
        return (
          <section
            key={column.status}
            aria-label={column.label}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setTarget(column.status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop(column.status);
            }}
            className={`flex min-h-64 flex-col rounded-2xl border p-2.5 transition ${
              target === column.status && dragging
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] bg-[var(--inset)]"
            }`}
          >
            <header className="mb-2 flex items-center gap-2 px-1.5 py-1">
              <span className={`size-2 rounded-full ${column.accent}`} />
              <h3 className="text-[11px] font-semibold">{column.label}</h3>
              <span className="text-[10px] text-[var(--muted)]">{columnTasks.length}</span>
            </header>
            <ul className="flex flex-col gap-2">
              {columnTasks.map((task) => {
                const priority = priorityMeta(task.priority);
                const previous = columns[index - 1];
                const next = columns[index + 1];
                return (
                  <li
                    key={task.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", task.id);
                      setDragging(task.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setTarget(null);
                    }}
                    className={`group rounded-xl border bg-[var(--surface)] p-3 shadow-[var(--card-shadow)] transition ${
                      selectedId === task.id ? "border-[var(--accent)]" : "border-[var(--line)] hover:border-[var(--line-strong)]"
                    } ${dragging === task.id ? "opacity-40" : ""}`}
                  >
                    <button type="button" onClick={() => onSelect(task)} className="block w-full text-left">
                      <div className="flex items-start gap-2">
                        <p className={`min-w-0 flex-1 text-xs font-medium leading-5 ${task.status === "completed" ? "text-[var(--muted)] line-through" : ""}`}>{task.title}</p>
                        {task.priority !== "none" && <Flag className={`mt-1 size-3 flex-none ${priority.className}`} aria-label={`Prioridad ${priority.label}`} />}
                      </div>
                      <TaskMetaLine task={task} hideProject={hideProject} />
                    </button>
                    <div className="mt-2 flex justify-end gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      {previous && (
                        <button type="button" onClick={() => onMove(task, previous.status)} aria-label={`Mover a ${previous.label}`} title={`Mover a ${previous.label}`} className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
                          <ChevronLeft className="size-3.5" />
                        </button>
                      )}
                      {next && (
                        <button type="button" onClick={() => onMove(task, next.status)} aria-label={`Mover a ${next.label}`} title={`Mover a ${next.label}`} className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
                          <ChevronRight className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {columnTasks.length === 0 && (
                <li className="rounded-xl border border-dashed border-[var(--line)] px-3 py-6 text-center text-[10px] text-[var(--muted)]">
                  Arrastra tareas aquí
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
