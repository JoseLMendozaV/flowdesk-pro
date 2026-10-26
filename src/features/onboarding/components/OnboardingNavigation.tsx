import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

type PreferenceCheckbox = { label: string; checked: boolean; onChange: (checked: boolean) => void };

type OnboardingNavigationProps = {
  progress?: ReactNode;
  preference?: PreferenceCheckbox;
  onPrevious?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  onSkip?: () => void;
  skipLabel?: string;
};

export function OnboardingNavigation({ progress, preference, onPrevious, onNext, nextLabel = "Siguiente", onSkip, skipLabel = "Saltar recorrido" }: OnboardingNavigationProps) {
  return (
    <footer className="flex flex-none items-center gap-4 border-t border-[var(--line)] bg-[var(--panel)] px-6 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        {progress}
        {preference && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[11px] text-[var(--muted)]">
            <input type="checkbox" checked={preference.checked} onChange={(event) => preference.onChange(event.target.checked)} className="size-3.5 accent-[var(--accent)]" />
            {preference.label}
          </label>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">
        {onSkip && (
          <button type="button" onClick={onSkip} className="rounded-lg px-3 py-2 text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
            {skipLabel}
          </button>
        )}
        {onPrevious && (
          <button type="button" onClick={onPrevious} className="flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3.5 py-2 text-[12px] font-medium hover:bg-[var(--hover)]">
            <ArrowLeft className="size-3.5" /> Anterior
          </button>
        )}
        {onNext && (
          <button type="button" onClick={onNext} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-[12px] font-semibold text-white shadow-sm hover:brightness-105">
            {nextLabel} <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
    </footer>
  );
}
