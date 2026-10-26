import { Globe, Keyboard } from "lucide-react";
import type { ShortcutStatus } from "../../../types/dashboard";

/** Atajos de la app por sección. Solo los de funciones disponibles. */
const appShortcuts: { section: string; featureId: string; keys: { keys: string; label: string }[] }[] = [
  {
    section: "Calendario",
    featureId: "calendar",
    keys: [
      { keys: "← →", label: "Periodo anterior o siguiente" },
      { keys: "T", label: "Volver a hoy" },
      { keys: "D · S · M", label: "Vista de día, semana o mes" },
    ],
  },
  {
    section: "Tareas",
    featureId: "tasks",
    keys: [
      { keys: "Enter", label: "Crear la tarea escrita o abrir la seleccionada" },
      { keys: "Espacio", label: "Completar la tarea seleccionada" },
    ],
  },
  {
    section: "Paleta de comandos",
    featureId: "command-palette",
    keys: [
      { keys: "⌘K", label: "Buscar tareas, proyectos y notas, o ir a cualquier sección" },
      { keys: "↑ ↓ · ↵", label: "Elegir un resultado y abrirlo" },
    ],
  },
  {
    section: "Papelera",
    featureId: "trash",
    keys: [{ keys: "⌘Z", label: "Deshacer el último borrado mientras se ve el aviso" }],
  },
  {
    section: "General",
    featureId: "dashboard",
    keys: [
      { keys: "Esc", label: "Cerrar diálogos y paneles" },
      { keys: "⌘W", label: "Cerrar la ventana (FlowDesk sigue en la barra de menús)" },
      { keys: "⌘Q", label: "Salir de FlowDesk" },
    ],
  },
  {
    section: "Esta guía y la visita guiada",
    featureId: "dashboard",
    keys: [
      { keys: "← →", label: "Paso anterior o siguiente" },
      { keys: "Esc", label: "Salir de la guía" },
    ],
  },
];

export function ShortcutsScreen({ shortcuts, featureIds }: { shortcuts: ShortcutStatus[]; featureIds: string[] }) {
  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <h1 tabIndex={-1} data-step-heading className="text-[22px] font-semibold tracking-[-0.03em] outline-none">Atajos de teclado</h1>
      <p className="mt-1 text-[13px] text-[var(--muted)]">Los globales funcionan desde cualquier app, incluso con la ventana cerrada.</p>

      <section aria-labelledby="global-shortcuts" className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 id="global-shortcuts" className="flex items-center gap-2 text-[12px] font-semibold"><Globe className="size-3.5 text-violet-500" /> Globales</h2>
        {shortcuts.length === 0 ? (
          <p className="mt-2 text-[11px] text-[var(--muted)]">No hay atajos globales registrados.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-[12px]">
                  {shortcut.label}
                  {!shortcut.registered && <small className="block text-[10px] text-red-500">{shortcut.error || "En uso por otra aplicación"}</small>}
                </span>
                <kbd className={`rounded-md border border-[var(--line)] bg-[var(--inset)] px-2 py-0.5 text-[11px] ${shortcut.registered ? "" : "line-through opacity-60"}`}>{shortcut.keys}</kbd>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {appShortcuts
          .filter((group) => featureIds.includes(group.featureId))
          .map((group) => (
            <section key={group.section} aria-label={group.section} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <h2 className="flex items-center gap-2 text-[12px] font-semibold"><Keyboard className="size-3.5 text-[var(--accent)]" /> {group.section}</h2>
              <ul className="mt-2 space-y-1.5">
                {group.keys.map((entry) => (
                  <li key={entry.label} className="flex items-center gap-3 text-[11px]">
                    <kbd className="min-w-14 rounded-md border border-[var(--line)] bg-[var(--inset)] px-1.5 py-0.5 text-center text-[10px]">{entry.keys}</kbd>
                    <span className="text-[var(--muted)]">{entry.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}
