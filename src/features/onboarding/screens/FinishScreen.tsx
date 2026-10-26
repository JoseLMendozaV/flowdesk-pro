import { ArrowRight, CircleHelp, MousePointerClick, PartyPopper } from "lucide-react";

type FinishScreenProps = {
  title: string;
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
  onGuidedTour: (() => void) | null;
};

export function FinishScreen({ title, message, primaryLabel, onPrimary, onGuidedTour }: FinishScreenProps) {
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-8 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <PartyPopper className="size-7" />
        </span>
        <h2 tabIndex={-1} data-step-heading className="mt-5 text-[26px] font-semibold tracking-[-0.03em] outline-none">{title}</h2>
        <p className="mt-2 text-[14px] text-[var(--muted)]">{message}</p>
        <div className="mt-7 flex flex-col items-center gap-2.5">
          <button type="button" autoFocus onClick={onPrimary} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-6 py-3 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(97,125,232,0.35)] transition hover:brightness-105">
            {primaryLabel} <ArrowRight className="size-4" />
          </button>
          {onGuidedTour && (
            <button type="button" onClick={onGuidedTour} className="flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--hover)]">
              <MousePointerClick className="size-4" /> Hacer la visita guiada sobre la interfaz
            </button>
          )}
        </div>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted)]">
          <CircleHelp className="size-3.5" /> Vuelve a esta guía desde Ayuda → Recorrido por FlowDesk o desde Configuración.
        </p>
      </div>
    </div>
  );
}
