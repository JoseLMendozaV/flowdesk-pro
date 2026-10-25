import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Plus, X } from "lucide-react";
import { useEscape } from "../../hooks/useEscape";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage } from "../../services/format";
import type { ClipboardSettings } from "../../types/clipboard";

const capacities = [50, 100, 200, 500, 1000];

type Props = {
  settings: ClipboardSettings;
  onChange: (settings: ClipboardSettings) => Promise<void>;
  onClose: () => void;
};

export function ClipboardSettingsDialog({ settings, onChange, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  async function update(changes: Partial<ClipboardSettings>) {
    try {
      await onChange({ ...settings, ...changes });
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function excludeApp() {
    const path = await openDialog({ directory: false, multiple: false, title: "Excluir una aplicación", defaultPath: "/Applications", filters: [{ name: "Aplicaciones", extensions: ["app"] }] });
    if (typeof path !== "string") return;
    try {
      await onChange(await flowdeskApi.excludeClipboardApp(path));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="clipboard-settings-title" className="max-h-[calc(100vh-40px)] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 id="clipboard-settings-title" className="text-sm font-semibold">Preferencias del portapapeles</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]">
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-3 text-[11px]">
          <label className="flex items-center justify-between gap-3">
            Capacidad máxima
            <select value={settings.maxItems} onChange={(event) => void update({ maxItems: Number(event.target.value) })} className="rounded-md border border-[var(--line)] bg-[var(--input)] px-2 py-1">
              {capacities.map((value) => <option key={value} value={value}>{value} elementos</option>)}
            </select>
          </label>
          <p className="-mt-2 text-[10px] text-[var(--muted)]">Los favoritos no cuentan y nunca se borran solos.</p>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            Guardar imágenes
            <input type="checkbox" checked={settings.captureImages} onChange={(event) => void update({ captureImages: event.target.checked })} className="size-4 accent-[var(--accent)]" />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span>
              No guardar posibles credenciales
              <small className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">Contraseñas, tokens de API, claves privadas, JWT y números de tarjeta. Si lo desactivas se guardan ocultos.</small>
            </span>
            <input type="checkbox" checked={settings.skipSensitive} onChange={(event) => void update({ skipSensitive: event.target.checked })} className="mt-0.5 size-4 accent-[var(--accent)]" />
          </label>

          <div className="border-t border-[var(--line)] pt-3">
            <div className="mb-2 flex items-center justify-between">
              <strong className="font-medium">Aplicaciones excluidas</strong>
              <button type="button" onClick={() => void excludeApp()} className="flex items-center gap-1 rounded-lg border border-[var(--line)] px-2 py-1 text-[10px] hover:border-[var(--line-strong)]"><Plus className="size-3" /> Añadir</button>
            </div>
            {settings.excludedApps.length === 0 ? (
              <p className="text-[10px] text-[var(--muted)]">Ninguna.</p>
            ) : (
              <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
                {settings.excludedApps.map((app) => (
                  <li key={app.bundleId} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{app.name}</span>
                      <span className="block truncate text-[9px] text-[var(--muted)]">{app.bundleId}</span>
                    </span>
                    <button type="button" onClick={() => void update({ excludedApps: settings.excludedApps.filter((other) => other.bundleId !== app.bundleId) })} aria-label={`Dejar de excluir ${app.name}`} className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)]"><X className="size-3" /></button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">La app de origen es la que estaba en primer plano al copiar; una copia hecha en segundo plano puede atribuirse a otra.</p>
          </div>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}
      </section>
    </div>
  );
}
