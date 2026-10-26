type OnboardingProgressProps = {
  current: number;
  labels: string[];
  noun: string;
  onGo: (index: number) => void;
};

/** «Paso 3 de 8» y un punto por paso; cada punto lleva a su paso. */
export function OnboardingProgress({ current, labels, noun, onGo }: OnboardingProgressProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="whitespace-nowrap text-[11px] font-medium tabular-nums text-[var(--muted)]">
        {noun} {current + 1} de {labels.length}
      </span>
      <ol className="flex items-center gap-1" aria-label="Progreso">
        {labels.map((label, index) => (
          <li key={label} className="flex">
            <button
              type="button"
              onClick={() => onGo(index)}
              aria-label={`Ir al paso ${index + 1}: ${label}`}
              aria-current={index === current ? "step" : undefined}
              title={label}
              className="grid h-4 place-items-center rounded-full px-0.5"
            >
              <span className="onboarding-dot block" data-state={index < current ? "done" : index === current ? "current" : "pending"} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
