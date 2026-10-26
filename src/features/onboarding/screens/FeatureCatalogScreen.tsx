import { ArrowRight } from "lucide-react";
import { categoryLabels, featureIcons, toneClasses } from "../components/featureVisuals";
import type { FeatureDefinition } from "../registry/types";

/** Funcionalidades disponibles en esta versión, según el registro y las capacidades de Rust. */
export function FeatureCatalogScreen({ features, onOpenFeature }: { features: FeatureDefinition[]; onOpenFeature: (featureId: string) => void }) {
  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <h1 tabIndex={-1} data-step-heading className="text-[22px] font-semibold tracking-[-0.03em] outline-none">Funcionalidades disponibles</h1>
      <p className="mt-1 text-[13px] text-[var(--muted)]">Todo lo que puedes usar ya en esta versión. Elige una para ver cómo funciona.</p>
      <ul className="mt-5 grid grid-cols-2 gap-3">
        {features.map((feature) => {
          const Icon = featureIcons[feature.icon];
          return (
            <li key={feature.id}>
              <button type="button" onClick={() => onOpenFeature(feature.id)} className="group flex h-full w-full items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-[var(--card-shadow)] transition hover:-translate-y-px hover:border-[var(--line-strong)]">
                <span className={`grid size-9 flex-none place-items-center rounded-xl ${toneClasses[feature.tone]}`}><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] text-[var(--muted)]">{categoryLabels[feature.category]}</span>
                  <strong className="mt-0.5 block text-[13px] font-semibold">{feature.title}</strong>
                  <span className="mt-1 block text-[11px] leading-5 text-[var(--muted)]">{feature.summary}</span>
                </span>
                <ArrowRight className="mt-1 size-3.5 flex-none text-[var(--muted)] transition group-hover:translate-x-0.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
