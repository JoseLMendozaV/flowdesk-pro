import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

export type SpotlightRect = { top: number; left: number; width: number; height: number };

type TourSpotlightProps = {
  rect: SpotlightRect;
  featureTitle: string;
  title: string;
  body: string;
  index: number;
  total: number;
  onPrevious: (() => void) | null;
  onNext: () => void;
  onSkip: () => void;
};

const PADDING = 6;
const GAP = 12;
const POPOVER_WIDTH = 300;
const EDGE = 12;

/** Coloca el globo a la derecha, debajo, encima o a la izquierda, sin salirse de la ventana. */
function placePopover(rect: SpotlightRect, height: number) {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const clampTop = (top: number) => Math.min(Math.max(EDGE, top), viewport.height - height - EDGE);
  const clampLeft = (left: number) => Math.min(Math.max(EDGE, left), viewport.width - POPOVER_WIDTH - EDGE);
  const right = rect.left + rect.width + PADDING + GAP;
  if (right + POPOVER_WIDTH + EDGE <= viewport.width) return { top: clampTop(rect.top), left: right };
  const below = rect.top + rect.height + PADDING + GAP;
  if (below + height + EDGE <= viewport.height) return { top: below, left: clampLeft(rect.left) };
  const above = rect.top - PADDING - GAP - height;
  if (above >= EDGE) return { top: above, left: clampLeft(rect.left) };
  const left = rect.left - PADDING - GAP - POPOVER_WIDTH;
  if (left >= EDGE) return { top: clampTop(rect.top), left };
  // Elementos muy grandes: el globo va dentro, en la esquina inferior derecha.
  return { top: viewport.height - height - EDGE, left: viewport.width - POPOVER_WIDTH - EDGE };
}

/** El hueco con su margen, sin salirse de la ventana (un elemento a todo lo ancho lo haría). */
function spotlightBox(rect: SpotlightRect) {
  const inset = 2;
  const left = Math.max(inset, rect.left - PADDING);
  const top = Math.max(inset, rect.top - PADDING);
  const right = Math.min(window.innerWidth - inset, rect.left + rect.width + PADDING);
  const bottom = Math.min(window.innerHeight - inset, rect.top + rect.height + PADDING);
  return { left, top, width: right - left, height: bottom - top };
}

export function TourSpotlight({ rect, featureTitle, title, body, index, total, onPrevious, onNext, onSkip }: TourSpotlightProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    const height = popoverRef.current?.offsetHeight ?? 180;
    setPosition(placePopover(rect, height));
  }, [rect, title, body]);

  useLayoutEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [index]);

  const last = index + 1 === total;
  return (
    // La capa bloquea los clics: la visita no puede cambiar datos por accidente.
    <div className="fixed inset-0 z-[90]" role="presentation" onMouseDown={(event) => event.preventDefault()}>
      <div className="tour-spotlight" style={spotlightBox(rect)} />
      <div
        ref={popoverRef}
        key={index}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-body"
        className="tour-popover fixed rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-4 text-[var(--text)] shadow-2xl"
        style={{ ...position, width: POPOVER_WIDTH }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">{featureTitle}</span>
          <button type="button" onClick={onSkip} aria-label="Salir de la visita guiada" className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)]">
            <X className="size-3.5" />
          </button>
        </div>
        <h2 id="tour-step-title" className="mt-2.5 text-[14px] font-semibold">{title}</h2>
        <p id="tour-step-body" className="mt-1 text-[12px] leading-5 text-[var(--muted)]">{body}</p>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-[var(--muted)]">{index + 1} de {total}</span>
          <button type="button" onClick={onSkip} className="ml-auto rounded-lg px-2 py-1.5 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]">Saltar</button>
          {onPrevious && (
            <button type="button" onClick={onPrevious} aria-label="Paso anterior" className="grid size-7 place-items-center rounded-lg border border-[var(--line)] hover:bg-[var(--hover)]">
              <ArrowLeft className="size-3.5" />
            </button>
          )}
          <button ref={nextRef} type="button" onClick={onNext} className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-white">
            {last ? "Terminar" : "Siguiente"} {!last && <ArrowRight className="size-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
