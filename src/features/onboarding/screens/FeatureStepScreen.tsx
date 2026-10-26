import { useState } from "react";
import { Image, Keyboard, Lightbulb, MousePointerClick, Play, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { FeatureDemo } from "../components/FeatureDemo";
import { FeaturePreview } from "../components/FeaturePreview";
import { categoryLabels, featureIcons, toneClasses } from "../components/featureVisuals";
import type { WhatsNewEntry } from "../registry/registry";
import type { FeatureDefinition } from "../registry/types";
import type { ShortcutStatus } from "../../../types/dashboard";

type FeatureStepScreenProps = {
  feature: FeatureDefinition;
  shortcuts: ShortcutStatus[];
  setupMessage: string | null;
  news?: WhatsNewEntry;
  onShowInApp: (() => void) | null;
};

/** Una funcionalidad: captura o demostración a la izquierda y explicación a la derecha. */
export function FeatureStepScreen({ feature, shortcuts, setupMessage, news, onShowInApp }: FeatureStepScreenProps) {
  const [media, setMedia] = useState<"image" | "demo">(feature.image ? "image" : "demo");
  const Icon = featureIcons[feature.icon];
  const featureShortcuts = (feature.shortcuts ?? [])
    .map((id) => shortcuts.find((shortcut) => shortcut.id === id))
    .filter((shortcut): shortcut is ShortcutStatus => Boolean(shortcut));
  const hasBoth = Boolean(feature.image && feature.animation);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1.3fr)_minmax(270px,1fr)] gap-6 p-6">
      <div className="flex min-h-0 flex-col">
        {hasBoth && (
          <div role="tablist" aria-label="Tipo de vista previa" className="mb-2.5 flex w-fit rounded-lg border border-[var(--line)] bg-[var(--inset)] p-0.5">
            <button type="button" role="tab" aria-selected={media === "image"} onClick={() => setMedia("image")} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] ${media === "image" ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)]"}`}>
              <Image className="size-3" /> Captura
            </button>
            <button type="button" role="tab" aria-selected={media === "demo"} onClick={() => setMedia("demo")} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] ${media === "demo" ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)]"}`}>
              <Play className="size-3" /> Demostración
            </button>
          </div>
        )}
        <div className="min-h-0">
          <div className="w-full" style={media === "demo" || !feature.image ? { aspectRatio: 1180 / 760 } : undefined}>
            {media === "image" && feature.image ? <FeaturePreview image={feature.image} /> : feature.animation ? <FeatureDemo kind={feature.animation} /> : null}
          </div>
        </div>
        {/* Bajo la vista previa, siempre visible: el texto de la derecha puede necesitar desplazarse. */}
        {onShowInApp && (
          <div className="mt-3 flex flex-none items-center gap-3">
            <button type="button" onClick={onShowInApp} className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--hover)]">
              <MousePointerClick className="size-3.5" /> Mostrármelo en FlowDesk
            </button>
            <span className="text-[11px] leading-4 text-[var(--muted)]">Resalta esta función en la app y vuelve aquí al terminar.</span>
          </div>
        )}
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <div className="flex items-center gap-2">
          <span className={`grid size-8 place-items-center rounded-xl ${toneClasses[feature.tone]}`}><Icon className="size-4" /></span>
          <span className="text-[11px] font-medium text-[var(--muted)]">{categoryLabels[feature.category]}</span>
          {news && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
              <Sparkles className="size-3" /> {news.kind === "new" ? "Nuevo" : "Mejorado"}
            </span>
          )}
        </div>
        <h2 tabIndex={-1} data-step-heading className="mt-3 text-[21px] font-semibold tracking-[-0.025em] outline-none">{feature.title}</h2>
        <p className="mt-1.5 text-[13px] leading-6 text-[var(--muted)]">{feature.description}</p>

        {news && news.changes.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl bg-[var(--accent-soft)] p-3 text-[12px] leading-5">
            {news.changes.map((change) => <li key={change.revision}><strong className="font-semibold">Versión {change.version}:</strong> {change.summary}</li>)}
          </ul>
        )}

        {setupMessage && (
          <p className="mt-3 flex gap-2 rounded-xl bg-amber-500/10 p-3 text-[12px] leading-5 text-amber-700 dark:text-amber-400">
            <Wrench className="mt-0.5 size-3.5 flex-none" /> {setupMessage}
          </p>
        )}

        <ul className="mt-4 space-y-1.5">
          {feature.highlights.map((highlight) => (
            <li key={highlight} className="flex gap-2 text-[12px] leading-5">
              <span className="mt-[7px] size-1.5 flex-none rounded-full bg-[var(--accent)]" />
              {highlight}
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Ejemplo</p>
          <p className="mt-1 text-[12px] leading-5">{feature.example}</p>
        </div>

        {feature.tips.map((tip) => (
          <p key={tip} className="mt-2 flex gap-2 text-[11px] leading-5 text-[var(--muted)]">
            <Lightbulb className="mt-0.5 size-3.5 flex-none text-amber-500" /> {tip}
          </p>
        ))}

        {featureShortcuts.map((shortcut) => (
          <p key={shortcut.id} className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <Keyboard className="size-3.5 flex-none" />
            {shortcut.label} desde cualquier app:
            <kbd className={`rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text)] ${shortcut.registered ? "" : "line-through opacity-60"}`}>{shortcut.keys}</kbd>
            {!shortcut.registered && <span className="text-[10px] text-red-500">en uso por otra app</span>}
          </p>
        ))}

        {feature.privacy && (
          <p className="mt-3 flex gap-2 rounded-xl bg-emerald-500/10 p-3 text-[11px] leading-5 text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="mt-0.5 size-3.5 flex-none" /> {feature.privacy}
          </p>
        )}

      </div>
    </div>
  );
}
