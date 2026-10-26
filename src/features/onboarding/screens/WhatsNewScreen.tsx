import { CheckCircle2, Sparkles } from "lucide-react";
import { featureIcons, toneClasses } from "../components/featureVisuals";
import type { ReleaseNotes, WhatsNewEntry } from "../registry/registry";

type WhatsNewScreenProps = {
  entries: WhatsNewEntry[];
  history: ReleaseNotes[];
  appVersion: string;
  onOpenFeature: (featureId: string) => void;
};

/** Novedades sin ver arriba; debajo, el historial real de cada versión. */
export function WhatsNewScreen({ entries, history, appVersion, onOpenFeature }: WhatsNewScreenProps) {
  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <div className="mx-auto max-w-2xl">
        {entries.length > 0 ? (
          <>
            <span className="grid size-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><Sparkles className="size-6" /></span>
            <h1 tabIndex={-1} data-step-heading className="mt-4 text-[24px] font-semibold tracking-[-0.03em] outline-none">¡FlowDesk Pro tiene novedades!</h1>
            <p className="mt-1.5 text-[13px] leading-6 text-[var(--muted)]">
              Hemos incorporado nuevas herramientas para mejorar tu experiencia de productividad. Estás usando la versión {appVersion}.
            </p>
            <ul className="mt-5 grid gap-2.5">
              {entries.map(({ feature, kind, changes }) => {
                const Icon = featureIcons[feature.icon];
                return (
                  <li key={feature.id}>
                    <button type="button" onClick={() => onOpenFeature(feature.id)} className="flex w-full items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left shadow-[var(--card-shadow)] transition hover:border-[var(--line-strong)]">
                      <span className={`grid size-9 flex-none place-items-center rounded-xl ${toneClasses[feature.tone]}`}><Icon className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <strong className="text-[13px] font-semibold">{feature.title}</strong>
                          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">{kind === "new" ? "Nuevo" : "Mejorado"}</span>
                        </span>
                        <span className="mt-1 block text-[12px] leading-5 text-[var(--muted)]">
                          {kind === "new" || changes.length === 0 ? feature.summary : changes.map((change) => change.summary).join(" ")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <span className="grid size-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-500"><CheckCircle2 className="size-6" /></span>
            <h1 tabIndex={-1} data-step-heading className="mt-4 text-[24px] font-semibold tracking-[-0.03em] outline-none">Estás al día</h1>
            <p className="mt-1.5 text-[13px] leading-6 text-[var(--muted)]">Ya conoces todo lo que incluye la versión {appVersion}. Este es el historial de cambios visibles de FlowDesk Pro.</p>
          </>
        )}

        <section aria-labelledby="release-history" className="mt-8">
          <h2 id="release-history" className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Historial de versiones</h2>
          <ol className="mt-3 space-y-4 border-l border-[var(--line)] pl-5">
            {history.map((release) => (
              <li key={release.version} className="relative">
                <span className="absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-[var(--bg)] bg-[var(--accent)]" />
                <h3 className="text-[13px] font-semibold">Versión {release.version}</h3>
                <ul className="mt-1.5 space-y-1 text-[12px] leading-5">
                  {release.added.map((feature) => (
                    <li key={feature.id}>
                      <button type="button" onClick={() => onOpenFeature(feature.id)} className="text-left hover:text-[var(--accent)]">
                        <strong className="font-medium">{feature.title}.</strong> <span className="text-[var(--muted)]">{feature.summary}</span>
                      </button>
                    </li>
                  ))}
                  {release.improved.map(({ feature, update }) => (
                    <li key={`${feature.id}-${update.revision}`}>
                      <button type="button" onClick={() => onOpenFeature(feature.id)} className="text-left hover:text-[var(--accent)]">
                        <strong className="font-medium">{feature.title}:</strong> <span className="text-[var(--muted)]">{update.summary}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
