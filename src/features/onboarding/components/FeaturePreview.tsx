import { useState } from "react";
import { Expand, ImageOff, X } from "lucide-react";
import { useEscape } from "../../../hooks/useEscape";
import type { FeatureScreenshot } from "../registry/types";

/** Captura real en el modo de color del sistema; se amplía con un clic. */
export function FeaturePreview({ image }: { image: FeatureScreenshot }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  useEscape(() => setZoomed(false), zoomed);

  if (failed) {
    return (
      <div className="grid h-full min-h-48 place-items-center rounded-xl border border-dashed border-[var(--line)] text-center text-[11px] text-[var(--muted)]">
        <span>
          <ImageOff className="mx-auto mb-2 size-5" />
          No se pudo cargar la captura.
        </span>
      </div>
    );
  }

  const picture = (className: string) => (
    <picture>
      <source srcSet={image.dark} media="(prefers-color-scheme: dark)" />
      <img
        src={image.light}
        alt={image.alt}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={className}
      />
    </picture>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label={`Ampliar captura: ${image.alt}`}
        className="group relative block w-full overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[var(--inset)] shadow-[0_18px_50px_rgba(20,25,45,0.16)]"
        style={{ aspectRatio: image.aspect }}
      >
        {!loaded && <span className="absolute inset-0 animate-pulse bg-[var(--hover)]" aria-hidden="true" />}
        {picture("h-full w-full object-cover object-top")}
        <span className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-lg bg-black/45 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <Expand className="size-3.5" />
        </span>
      </button>
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={image.alt}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
          onMouseDown={(event) => event.target === event.currentTarget && setZoomed(false)}
        >
          <div className="relative max-h-full max-w-full overflow-hidden rounded-xl shadow-2xl">
            {picture("max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] object-contain")}
            <button type="button" autoFocus onClick={() => setZoomed(false)} aria-label="Cerrar captura" className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-black/55 text-white">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
