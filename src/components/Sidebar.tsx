import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  Clipboard,
  Clock3,
  Focus,
  FolderKanban,
  Home,
  Settings,
  StickyNote,
} from "lucide-react";
import { useAppStore, type Section } from "../stores/appStore";

const navigation = [
  { id: "dashboard", label: "Inicio", icon: Home, enabled: true },
  { id: "tasks", label: "Tareas", icon: CheckSquare2, enabled: true },
  { id: "projects", label: "Proyectos", icon: FolderKanban, enabled: true },
  { id: "notes", label: "Notas", icon: StickyNote, enabled: true },
  { id: "focus", label: "Concentración", icon: Focus, enabled: true },
  { id: "time", label: "Tiempo", icon: Clock3, enabled: true },
  { label: "Portapapeles", icon: Clipboard },
  { label: "Calendario", icon: CalendarDays },
  { label: "Espacios", icon: BriefcaseBusiness },
  { label: "IA local", icon: Bot },
];

export function Sidebar() {
  const openPreferences = useAppStore((state) => state.openPreferences);
  const selectedSection = useAppStore((state) => state.selectedSection);
  const selectSection = useAppStore((state) => state.selectSection);
  return (
    // La franja superior y los huecos de la barra lateral mueven la ventana, como una barra de título.
    <aside data-tauri-drag-region className="flex h-full flex-col border-r border-[var(--line)] bg-[var(--sidebar)] px-3 pb-3 pt-12">
      <div data-tauri-drag-region="deep" className="mb-5 flex items-center gap-2.5 px-2">
        <div className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-[#6e8bff] to-[#806ce8] text-sm font-bold text-white shadow-[0_5px_18px_rgba(104,125,239,.32)]">
          F
        </div>
        <div>
          <div className="text-[13px] font-semibold tracking-[-0.01em]">FlowDesk Pro</div>
          <div className="text-[10px] text-[var(--muted)]">Productividad local</div>
        </div>
      </div>

      <button
        className="mb-4 flex w-full items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-left transition hover:border-[var(--line-strong)]"
        type="button"
        aria-label="Espacio de trabajo actual"
      >
        <span className="size-2 rounded-full bg-[#876ef0]" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">Todos los espacios</span>
        <ChevronDown className="size-3.5 text-[var(--muted)]" />
      </button>

      <nav aria-label="Navegación principal" className="space-y-0.5">
        {navigation.map(({ id, label, icon: Icon, enabled }) => {
          const active = id === selectedSection;
          return (
          <button
            key={label}
            type="button"
            onClick={() => enabled && id && selectSection(id as Section)}
            aria-current={active ? "page" : undefined}
            aria-disabled={!enabled}
            title={enabled ? undefined : `${label} se implementará en una fase posterior`}
            className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[12px] transition ${
              active
                ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                : enabled
                  ? "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  : "cursor-default text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            <Icon className="size-[15px]" strokeWidth={active ? 2.2 : 1.8} />
            <span>{label}</span>
          </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-[var(--line)] pt-3">
        <button
          type="button"
          onClick={openPreferences}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
        >
          <Settings className="size-[15px]" strokeWidth={1.8} />
          Configuración
        </button>
        <div className="mt-1 flex items-center gap-2 px-2.5 py-2 text-[10px] text-[var(--muted)]">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Datos locales · Sin conexión
        </div>
      </div>
    </aside>
  );
}
