import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ClipboardList,
  Image as ImageIcon,
  KeyRound,
  Pause,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { ClipboardSettingsDialog } from "../features/clipboard/ClipboardSettingsDialog";
import { useDataChanged } from "../hooks/useDataChanged";
import { flowdeskApi } from "../services/flowdeskApi";
import { describeDue, errorMessage } from "../services/format";
import type { ClipboardItem, ClipboardSettings } from "../types/clipboard";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Miniatura cargada como bytes desde Rust; la URL se libera al desmontar. */
function ImagePreview({ itemId }: { itemId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void flowdeskApi
      .clipboardImage(itemId)
      .then((bytes) => {
        if (cancelled || !bytes?.byteLength) return;
        objectUrl = URL.createObjectURL(new Blob([bytes]));
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId]);
  return url ? (
    <img src={url} alt="Imagen copiada" onError={() => setUrl(null)} className="max-h-24 max-w-full rounded-md border border-[var(--line)] object-contain" />
  ) : (
    <span className="grid h-16 w-24 place-items-center rounded-md bg-[var(--inset)] text-[var(--muted)]"><ImageIcon className="size-4" /></span>
  );
}

function ConsentCard({ onEnable }: { onEnable: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--card-shadow)]">
      <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><ShieldCheck className="size-5" /></span>
      <h2 className="mt-4 text-sm font-semibold">Historial del portapapeles</h2>
      <p className="mt-1.5 text-[11px] leading-5 text-[var(--muted)]">
        FlowDesk guardará en este Mac lo que copies (texto e imágenes) para que puedas buscarlo y volver a copiarlo. Nada sale del equipo.
      </p>
      <ul className="mt-3 space-y-1.5 text-[11px] leading-5">
        <li className="flex gap-2"><Check className="mt-1 size-3 flex-none text-emerald-500" /> No guarda lo que los gestores de contraseñas marcan como oculto.</li>
        <li className="flex gap-2"><Check className="mt-1 size-3 flex-none text-emerald-500" /> Ignora las apps excluidas (Llaveros, Contraseñas, 1Password, Bitwarden, LastPass…).</li>
        <li className="flex gap-2"><Check className="mt-1 size-3 flex-none text-emerald-500" /> Descarta el texto con aspecto de contraseña, token o tarjeta.</li>
        <li className="flex gap-2"><Check className="mt-1 size-3 flex-none text-emerald-500" /> Puedes pausarlo, borrar el historial o desactivarlo cuando quieras.</li>
      </ul>
      <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[10px] leading-4 text-amber-700 dark:text-amber-400">
        La detección de información sensible es una heurística: puede no reconocer algunas credenciales y descartar texto normal. Evita copiar secretos mientras el historial esté activo si no usas un gestor que los marque como ocultos.
      </p>
      <button type="button" onClick={onEnable} className="mt-5 w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white">Activar historial</button>
    </div>
  );
}

export function ClipboardPage() {
  const [settings, setSettings] = useState<ClipboardSettings | null>(null);
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      setItems(await flowdeskApi.clipboard(search, favoritesOnly));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [favoritesOnly, search]);

  useEffect(() => {
    void flowdeskApi.clipboardSettings().then(setSettings).catch((reason) => setError(errorMessage(reason)));
  }, []);
  useEffect(() => {
    void loadItems();
  }, [loadItems]);
  useDataChanged(["clipboard"], () => void loadItems());

  async function saveSettings(next: ClipboardSettings) {
    setSettings(await flowdeskApi.updateClipboardSettings(next));
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function copy(item: ClipboardItem) {
    await run(async () => {
      await flowdeskApi.copyClipboardItem(item.id);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1500);
    });
  }

  if (!settings) return null;

  const status = !settings.enabled ? "Desactivado" : settings.paused ? "En pausa: no se guarda nada" : "Guardando lo que copias";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header data-tauri-drag-region="deep" className="flex h-[74px] flex-none items-end justify-between gap-4 border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.025em]">Portapapeles</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <span className={`size-1.5 rounded-full ${settings.enabled && !settings.paused ? "bg-emerald-500" : "bg-[var(--muted)]"}`} />
            {status}
          </p>
        </div>
        {settings.enabled && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => void run(() => saveSettings({ ...settings, paused: !settings.paused }))} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-[var(--line-strong)]">
              {settings.paused ? <><Play className="size-3.5" /> Reanudar</> : <><Pause className="size-3.5" /> Pausar</>}
            </button>
            <button type="button" onClick={() => setEditingSettings(true)} aria-label="Preferencias del portapapeles" title="Preferencias" className="grid size-[30px] place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"><Settings2 className="size-3.5" /></button>
            <button type="button" onClick={() => void run(() => saveSettings({ ...settings, enabled: false, paused: false }))} className="rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">Desactivar</button>
          </div>
        )}
      </header>

      {error && <div className="mx-6 mt-3 rounded-xl bg-red-500/10 px-4 py-2 text-xs text-red-500">{error}</div>}

      {!settings.enabled && items.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <ConsentCard onEnable={() => void run(() => saveSettings({ ...settings, enabled: true, paused: false }))} />
        </div>
      ) : (
        <>
          <div className="flex flex-none items-center gap-2 px-6 py-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 focus-within:border-[var(--accent)]">
              <Search className="size-3.5 text-[var(--muted)]" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} placeholder="Buscar en el historial…" aria-label="Buscar en el historial" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda" className="text-[var(--muted)]"><X className="size-3.5" /></button>}
            </label>
            <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${favoritesOnly ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-[var(--line)] bg-[var(--surface)]"}`}>
              <Star className="size-3.5" /> Favoritos
            </button>
            {confirmingClear ? (
              <span className="flex items-center gap-1 text-[11px]">
                ¿Borrar todo salvo favoritos?
                <button type="button" onClick={() => void run(async () => { await flowdeskApi.clearClipboard(); setConfirmingClear(false); })} className="rounded-lg bg-red-500 px-2.5 py-1.5 font-medium text-white">Borrar</button>
                <button type="button" onClick={() => setConfirmingClear(false)} className="rounded-lg px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--hover)]">No</button>
              </span>
            ) : (
              <button type="button" disabled={items.length === 0} onClick={() => setConfirmingClear(true)} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-red-500/40 hover:text-red-500 disabled:opacity-50">
                <Trash2 className="size-3.5" /> Limpiar
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {!settings.enabled && (
              <p className="mb-3 rounded-xl bg-[var(--inset)] px-4 py-2.5 text-[11px] text-[var(--muted)]">
                El historial está desactivado: lo guardado se conserva hasta que lo borres.{" "}
                <button type="button" onClick={() => void run(() => saveSettings({ ...settings, enabled: true, paused: false }))} className="font-medium text-[var(--accent)]">Volver a activar</button>
              </p>
            )}
            {items.length === 0 ? (
              <div className="grid min-h-60 place-items-center rounded-2xl border border-dashed border-[var(--line)] text-center text-[11px] text-[var(--muted)]">
                <div>
                  <ClipboardList className="mx-auto mb-2 size-6 text-[var(--accent)]" />
                  {search || favoritesOnly ? "Nada coincide con el filtro." : "Copia algo en cualquier app y aparecerá aquí."}
                </div>
              </div>
            ) : (
              <ul className="space-y-1.5" aria-label="Historial del portapapeles">
                {items.map((item) => {
                  const when = describeDue(item.createdAt, true).label;
                  return (
                    <li key={item.id} className="group flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 hover:border-[var(--line-strong)]">
                      <button type="button" onClick={() => void copy(item)} title="Copiar de nuevo" className="flex min-w-0 flex-1 items-start gap-3 text-left">
                        <span className="mt-0.5 grid size-6 flex-none place-items-center rounded-md bg-[var(--inset)] text-[var(--muted)]">
                          {item.isSensitive ? <KeyRound className="size-3.5 text-amber-500" /> : item.contentType === "image" ? <ImageIcon className="size-3.5" /> : <Type className="size-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          {item.contentType === "image" ? (
                            <ImagePreview itemId={item.id} />
                          ) : item.isSensitive ? (
                            <span className="block text-[11px] text-[var(--muted)]">Posible credencial oculta</span>
                          ) : (
                            <span className="line-clamp-3 whitespace-pre-wrap break-words text-[11px] leading-[1.45]">{item.preview}</span>
                          )}
                          <span className="mt-1 block text-[9px] text-[var(--muted)]">
                            {copiedId === item.id ? <span className="font-medium text-emerald-500">Copiado</span> : when}
                            {item.sourceApp && ` · ${item.sourceApp}`}
                            {` · ${item.contentType === "image" ? formatBytes(item.byteSize) : `${item.charCount} caracteres`}`}
                          </span>
                        </span>
                      </button>
                      <button type="button" onClick={() => void run(() => flowdeskApi.setClipboardFavorite(item.id, !item.isFavorite))} aria-label={item.isFavorite ? "Quitar de favoritos" : "Marcar como favorito"} aria-pressed={item.isFavorite} className={`grid size-7 flex-none place-items-center rounded-lg hover:bg-[var(--hover)] ${item.isFavorite ? "text-amber-500" : "text-[var(--muted)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}>
                        <Star className="size-3.5" fill={item.isFavorite ? "currentColor" : "none"} />
                      </button>
                      <button type="button" onClick={() => void run(() => flowdeskApi.deleteClipboardItem(item.id))} aria-label="Eliminar del historial" className="grid size-7 flex-none place-items-center rounded-lg text-[var(--muted)] opacity-0 hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100">
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      {editingSettings && <ClipboardSettingsDialog settings={settings} onChange={saveSettings} onClose={() => setEditingSettings(false)} />}
    </div>
  );
}
