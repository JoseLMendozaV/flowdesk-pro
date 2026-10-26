import { useState } from "react";
import { Code2, FlaskConical, GraduationCap, ListTodo, StickyNote } from "lucide-react";
import { DemoFrame } from "./DemoFrame";

const spaces = [
  { id: "research", name: "Investigación", color: "#0ea5e9", icon: FlaskConical, tasks: ["Leer artículos del estado del arte", "Analizar resultados del experimento"], notes: ["Bibliografía", "Hipótesis"] },
  { id: "code", name: "Programación", color: "#8b5cf6", icon: Code2, tasks: ["Revisar la PR del calendario", "Corregir prueba inestable"], notes: ["Comandos útiles"] },
  { id: "teaching", name: "Docencia", color: "#f59e0b", icon: GraduationCap, tasks: ["Preparar clase del jueves", "Corregir prácticas"], notes: ["Temario", "Dudas frecuentes"] },
];

/** Cambia de espacio y mira cómo se filtra el contenido. Todo es de ejemplo. */
export function WorkspacesDemo({ paused }: { paused: boolean }) {
  const [activeId, setActiveId] = useState(spaces[0].id);
  const active = spaces.find((space) => space.id === activeId) ?? spaces[0];

  return (
    <DemoFrame paused={paused} note="Espacios de ejemplo: cambiar aquí no cambia tu espacio activo.">
      <div className="demo-window absolute inset-[6%] grid grid-cols-[38%_1fr] gap-3 p-3">
        <div role="radiogroup" aria-label="Espacio de ejemplo" className="space-y-1">
          {spaces.map((space) => {
            const Icon = space.icon;
            const selected = space.id === activeId;
            return (
              <button key={space.id} type="button" role="radio" aria-checked={selected} onClick={() => setActiveId(space.id)} className={`flex w-full items-center gap-1.5 rounded-lg border px-1.5 py-1.5 text-left text-[10px] ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium" : "border-transparent hover:bg-[var(--hover)]"}`}>
                <span className="grid size-4 flex-none place-items-center rounded text-white" style={{ backgroundColor: space.color }}><Icon className="size-2.5" /></span>
                <span className="truncate">{space.name}</span>
              </button>
            );
          })}
        </div>
        <div key={active.id} className="onboarding-step-enter min-w-0 space-y-2">
          <div>
            <p className="mb-1 flex items-center gap-1 text-[9px] font-semibold text-[var(--muted)]"><ListTodo className="size-3" /> Tareas</p>
            {active.tasks.map((task) => <p key={task} className="truncate rounded-md bg-[var(--inset)] px-1.5 py-1 text-[10px]">{task}</p>)}
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 text-[9px] font-semibold text-[var(--muted)]"><StickyNote className="size-3" /> Notas</p>
            <div className="flex flex-wrap gap-1">
              {active.notes.map((note) => <span key={note} className="rounded-md bg-amber-200/70 px-1.5 py-1 text-[9px] text-slate-800">{note}</span>)}
            </div>
          </div>
        </div>
      </div>
    </DemoFrame>
  );
}
