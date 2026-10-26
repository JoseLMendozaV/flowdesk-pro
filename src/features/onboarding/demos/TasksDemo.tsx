import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { DemoFrame } from "./DemoFrame";

type DemoTask = { id: number; title: string; priority: "high" | "medium" | "low"; due: string; done: boolean };

const priorityColors = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-sky-500" };
const initialTasks: DemoTask[] = [
  { id: 1, title: "Revisar el borrador del informe", priority: "high", due: "Hoy", done: false },
  { id: 2, title: "Preparar clase del jueves", priority: "medium", due: "Mañana", done: false },
  { id: 3, title: "Responder correo del curso", priority: "low", due: "Hoy", done: true },
];

/** Lista de prueba que vive solo en memoria: se puede completar y añadir sin tocar SQLite. */
export function TasksDemo({ paused }: { paused: boolean }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [title, setTitle] = useState("");
  const [view, setView] = useState<"today" | "all">("today");
  const visible = view === "today" ? tasks.filter((task) => task.due === "Hoy") : tasks;

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setTasks((current) => [...current, { id: Date.now(), title: title.trim(), priority: "medium", due: "Hoy", done: false }]);
    setTitle("");
  }

  return (
    <DemoFrame paused={paused} note="Datos de prueba: lo que hagas aquí no se guarda ni cambia tus tareas.">
      <div className="demo-window absolute inset-[7%] flex flex-col p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold">Tareas</span>
          <div role="tablist" aria-label="Vista de prueba" className="flex rounded-md bg-[var(--inset)] p-0.5 text-[9px]">
            {(["today", "all"] as const).map((option) => (
              <button key={option} type="button" role="tab" aria-selected={view === option} onClick={() => setView(option)} className={`rounded px-2 py-0.5 ${view === option ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)]"}`}>
                {option === "today" ? "Hoy" : "Todas"}
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={add} className="mt-2 flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1 focus-within:border-[var(--accent)]">
          <Plus className="size-3 flex-none text-[var(--accent)]" />
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Escribe una tarea de prueba y pulsa Enter" aria-label="Tarea de prueba" className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-[var(--muted)]" />
        </form>
        <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {visible.map((task) => (
            <li key={task.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--hover)]">
              <button
                type="button"
                onClick={() => setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, done: !item.done } : item)))}
                aria-label={task.done ? `Reabrir «${task.title}»` : `Completar «${task.title}»`}
                aria-pressed={task.done}
                className={`grid size-3.5 flex-none place-items-center rounded-full border ${task.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-[var(--line-strong)] text-transparent hover:border-emerald-500"}`}
              >
                <Check className="size-2" strokeWidth={3} />
              </button>
              <span className={`size-1.5 flex-none rounded-full ${priorityColors[task.priority]}`} />
              <span className={`min-w-0 flex-1 truncate text-[10px] ${task.done ? "text-[var(--muted)] line-through" : ""}`}>{task.title}</span>
              <span className="text-[9px] text-[var(--muted)]">{task.due}</span>
            </li>
          ))}
        </ul>
      </div>
    </DemoFrame>
  );
}
