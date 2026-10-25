import { useEffect } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import { useWindowVisible } from "../../hooks/useWindowVisible";
import { useUpdateStore } from "./updateStore";

/** Aviso de nueva versión en el dashboard. Solo comprueba con la ventana visible. */
export function UpdateBanner() {
  const visible = useWindowVisible();
  const { status, update, progress, error, dismissedVersion, checkIfDue, install, dismiss } = useUpdateStore();

  useEffect(() => {
    if (!visible) return;
    void checkIfDue();
    const interval = window.setInterval(() => void checkIfDue(), 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [checkIfDue, visible]);

  const busy = status === "downloading" || status === "restarting";
  if (!update || (!busy && status !== "available" && status !== "error")) return null;
  if (!busy && status !== "error" && dismissedVersion === update.version) return null;

  return (
    <div role="status" className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--accent-soft)] px-5 py-2.5 text-[11px]">
      <Download className="size-4 flex-none text-[var(--accent)]" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {status === "downloading"
            ? `Descargando FlowDesk Pro ${update.version}…${progress !== null ? ` ${Math.round(progress * 100)}%` : ""}`
            : status === "restarting"
              ? "Reiniciando con la versión nueva…"
              : status === "error"
                ? `No se pudo actualizar a la versión ${update.version}`
                : `FlowDesk Pro ${update.version} está disponible`}
        </p>
        {status === "error" ? (
          <p className="truncate text-[10px] text-red-500">{error}</p>
        ) : (
          update.body && status === "available" && <p className="truncate text-[10px] text-[var(--muted)]">{update.body}</p>
        )}
      </div>
      {busy ? (
        <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
      ) : (
        <>
          <button type="button" onClick={() => void install()} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-white">
            {status === "error" ? "Reintentar" : "Actualizar y reiniciar"}
          </button>
          <button type="button" onClick={dismiss} aria-label="Recordármelo más tarde" title="Más tarde" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]">
            <X className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
