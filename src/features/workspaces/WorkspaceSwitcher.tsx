import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Layers, Settings2 } from "lucide-react";
import { useEscape } from "../../hooks/useEscape";
import { useAppStore } from "../../stores/appStore";
import { useWorkspaces } from "./useWorkspaces";
import { workspaceIcons } from "./workspaceMeta";

export function WorkspaceSwitcher() {
  const { workspaces, active, activeId, loaded, activate } = useWorkspaces();
  const selectSection = useAppStore((state) => state.selectSection);
  const setTaskView = useAppStore((state) => state.setTaskView);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousId = useRef<string | null | undefined>(undefined);
  useEscape(() => setOpen(false), open);

  // Al cambiar de espacio (también desde la barra de menú) se aplica su vista de tareas.
  useEffect(() => {
    if (!loaded) return;
    if (previousId.current !== undefined && previousId.current !== activeId && active) setTaskView(active.taskView);
    previousId.current = activeId;
  }, [active, activeId, loaded, setTaskView]);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const choices = workspaces.filter((workspace) => !workspace.isArchived);
  const ActiveIcon = active ? workspaceIcons[active.icon].icon : Layers;

  function choose(workspaceId: string | null) {
    setOpen(false);
    void activate(workspaceId);
  }

  return (
    <div ref={containerRef} data-tour-id="workspace-switcher" className="relative mb-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Espacio de trabajo: ${active?.name ?? "Todos los espacios"}`}
        className="flex w-full items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-left transition hover:border-[var(--line-strong)]"
      >
        <span className="grid size-5 flex-none place-items-center rounded-md text-white" style={{ backgroundColor: active?.color ?? "#876ef0" }}>
          <ActiveIcon className="size-3" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{active?.name ?? "Todos los espacios"}</span>
        <ChevronDown className={`size-3.5 text-[var(--muted)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute inset-x-0 top-[calc(100%+4px)] z-30 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] p-1 shadow-xl">
          {[null, ...choices].map((workspace) => {
            const Icon = workspace ? workspaceIcons[workspace.icon].icon : Layers;
            const selected = (workspace?.id ?? null) === activeId;
            return (
              <button key={workspace?.id ?? "all"} type="button" role="menuitemradio" aria-checked={selected} onClick={() => choose(workspace?.id ?? null)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-[var(--hover)]">
                <span className="grid size-4 flex-none place-items-center rounded text-white" style={{ backgroundColor: workspace?.color ?? "#876ef0" }}>
                  <Icon className="size-2.5" strokeWidth={2.4} />
                </span>
                <span className="min-w-0 flex-1 truncate">{workspace?.name ?? "Todos los espacios"}</span>
                {selected && <Check className="size-3 text-[var(--accent)]" />}
              </button>
            );
          })}
          <div className="my-1 h-px bg-[var(--line)]" />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); selectSection("workspaces"); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
            <Settings2 className="size-3.5" /> Gestionar espacios…
          </button>
        </div>
      )}
    </div>
  );
}
