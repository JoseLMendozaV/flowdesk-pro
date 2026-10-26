import { X } from "lucide-react";
import logo from "../../../assets/flowdesk-logo.png";
import type { OnboardingMode } from "../../../types/onboarding";

const tabs: { mode: OnboardingMode; label: string }[] = [
  { mode: "tour", label: "Recorrido" },
  { mode: "features", label: "Funcionalidades" },
  { mode: "whats-new", label: "Novedades" },
  { mode: "shortcuts", label: "Atajos" },
];

type OnboardingHeaderProps = {
  section: string;
  activeTab: OnboardingMode | null;
  onTab: ((mode: OnboardingMode) => void) | null;
  onClose: () => void;
};

/** Cabecera arrastrable; deja sitio a los botones de ventana de macOS. */
export function OnboardingHeader({ section, activeTab, onTab, onClose }: OnboardingHeaderProps) {
  return (
    <header data-tauri-drag-region className="flex h-[52px] flex-none items-center gap-3 border-b border-[var(--line)] bg-[var(--sidebar)] pl-[84px] pr-3">
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <img src={logo} alt="" className="size-6" draggable={false} />
        <span data-tauri-drag-region className="whitespace-nowrap text-[13px] font-semibold">FlowDesk Pro</span>
        <span data-tauri-drag-region className={`truncate text-[12px] text-[var(--muted)] ${onTab ? "max-[820px]:hidden" : ""}`}>· {section}</span>
      </div>
      {onTab && (
        <nav aria-label="Ayuda" className="ml-auto flex rounded-lg border border-[var(--line)] bg-[var(--inset)] p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.mode}
              type="button"
              onClick={() => onTab(tab.mode)}
              aria-current={activeTab === tab.mode ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 text-[11px] transition ${activeTab === tab.mode ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}
      <button type="button" onClick={onClose} aria-label="Cerrar" className={`grid size-8 flex-none place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] ${onTab ? "" : "ml-auto"}`}>
        <X className="size-4" />
      </button>
    </header>
  );
}
