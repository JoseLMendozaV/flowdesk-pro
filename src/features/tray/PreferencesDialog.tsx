import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Bell, Download, Keyboard, LoaderCircle, Power, X } from "lucide-react";
import { minutesLabel } from "../calendar/calendarDates";
import { useUpdateStore } from "../updates/updateStore";
import { flowdeskApi } from "../../services/flowdeskApi";
import { useAppStore } from "../../stores/appStore";
import type { ReminderSettings } from "../../types/calendar";
import type { ShortcutStatus, TrayPreferences } from "../../types/dashboard";

const initialPreferences: TrayPreferences = {
  launchAtLogin: false,
  launchHidden: false,
};

function UpdatesSection() {
  const [version, setVersion] = useState("");
  const { status, update, error, autoCheck, lastCheckedAt, setAutoCheck, checkNow, install } = useUpdateStore();
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);
  const lastChecked = lastCheckedAt
    ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(lastCheckedAt)
    : "nunca";

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-500"><Download className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-xs font-medium">Actualizaciones {version && <span className="font-normal text-[var(--muted)]">· versión {version}</span>}</strong>
          <small className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">
            {status === "checking"
              ? "Buscando…"
              : status === "available" && update
                ? `Disponible la versión ${update.version}`
                : status === "up-to-date"
                  ? "Tienes la última versión"
                  : status === "downloading"
                    ? "Descargando…"
                    : status === "error"
                      ? `No se pudo comprobar: ${error}`
                      : `Última comprobación: ${lastChecked}`}
          </small>
        </span>
        {status === "available" ? (
          <button type="button" onClick={() => void install()} className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-medium text-white">Actualizar</button>
        ) : (
          <button type="button" disabled={status === "checking" || status === "downloading"} onClick={() => void checkNow()} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] disabled:opacity-50">
            Buscar ahora
          </button>
        )}
      </div>
      <label className="mt-2.5 flex cursor-pointer items-center justify-between gap-3 border-t border-[var(--line)] pt-2.5 text-[11px]">
        <span>
          Buscar actualizaciones automáticamente
          <small className="block text-[10px] text-[var(--muted)]">Consulta GitHub al abrir FlowDesk y cada 6 horas. No envía datos personales.</small>
        </span>
        <input type="checkbox" checked={autoCheck} onChange={(event) => setAutoCheck(event.target.checked)} className="size-4 accent-[var(--accent)]" />
      </label>
    </div>
  );
}

const leadOptions = [0, 5, 10, 15, 30, 60, 120, 1440];

function parseClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Se guarda con cada cambio, como las actualizaciones: no depende del botón Guardar. */
function RemindersSection() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void flowdeskApi.reminderSettings().then(setSettings).catch((reason) => setError(String(reason)));
  }, []);
  if (!settings) return error ? <p className="text-[10px] text-red-500">{error}</p> : null;

  async function change(changes: Partial<ReminderSettings>) {
    if (!settings) return;
    const next = { ...settings, ...changes };
    setSettings(next);
    try {
      setSettings(await flowdeskApi.updateReminderSettings(next));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const timeClass = "rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5 py-0.5 text-[11px] disabled:opacity-50";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3.5">
      <label className="flex cursor-pointer items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-500"><Bell className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-xs font-medium">Recordatorios</strong>
          <small className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">Tareas con hora, eventos y notas. Funcionan con el dashboard cerrado.</small>
        </span>
        <input type="checkbox" checked={settings.enabled} onChange={(event) => void change({ enabled: event.target.checked })} className="size-4 accent-[var(--accent)]" />
      </label>
      <div className={`mt-2.5 space-y-2 border-t border-[var(--line)] pt-2.5 text-[11px] ${settings.enabled ? "" : "pointer-events-none opacity-50"}`}>
        <label className="flex items-center justify-between gap-3">
          Avisar de las tareas con hora
          <select value={settings.taskLeadMinutes} onChange={(event) => void change({ taskLeadMinutes: Number(event.target.value) })} className={timeClass}>
            {leadOptions.map((minutes) => (
              <option key={minutes} value={minutes}>{minutes === 0 ? "A la hora" : minutes < 60 ? `${minutes} min antes` : minutes === 1440 ? "1 día antes" : `${minutes / 60} h antes`}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <input type="checkbox" checked={settings.dailyDigest} onChange={(event) => void change({ dailyDigest: event.target.checked })} className="accent-[var(--accent)]" />
            Resumen diario de tareas pendientes
          </span>
          <input type="time" value={minutesLabel(settings.digestMinute)} disabled={!settings.dailyDigest} onChange={(event) => event.target.value && void change({ digestMinute: parseClock(event.target.value) })} className={timeClass} />
        </label>
        <div className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={settings.quietHours} onChange={(event) => void change({ quietHours: event.target.checked })} className="accent-[var(--accent)]" />
            Silencio de
          </label>
          <span className="flex items-center gap-1.5">
            <input type="time" aria-label="Inicio del silencio" value={minutesLabel(settings.quietStart)} disabled={!settings.quietHours} onChange={(event) => event.target.value && void change({ quietStart: parseClock(event.target.value) })} className={timeClass} />
            a
            <input type="time" aria-label="Fin del silencio" value={minutesLabel(settings.quietEnd)} disabled={!settings.quietHours} onChange={(event) => event.target.value && void change({ quietEnd: parseClock(event.target.value) })} className={timeClass} />
          </span>
        </div>
        <p className="text-[10px] leading-4 text-[var(--muted)]">Durante el silencio los avisos no se muestran; quedan en la lista de recordatorios del inicio. Los que se pierden con la app cerrada más de 6 horas no se repiten.</p>
      </div>
      {error && <p className="mt-2 text-[10px] text-red-500">{error}</p>}
    </div>
  );
}

export function PreferencesDialog() {
  const open = useAppStore((state) => state.preferencesOpen);
  const close = useAppStore((state) => state.closePreferences);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutStatus[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void Promise.all([flowdeskApi.trayPreferences(), flowdeskApi.shortcutStatus()])
      .then(([trayPreferences, shortcutStatus]) => {
        setPreferences(trayPreferences);
        setShortcuts(shortcutStatus);
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      setPreferences(await flowdeskApi.updateTrayPreferences(preferences));
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        className="max-h-[calc(100vh-40px)] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-2xl"
      >
        <header className="flex items-start justify-between">
          <div>
            <h2 id="preferences-title" className="text-sm font-semibold">Configuración</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Inicio y funcionamiento en segundo plano</p>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]">
            <X className="size-4" />
          </button>
        </header>

        {loading ? (
          <div className="grid min-h-36 place-items-center text-[11px] text-[var(--muted)]">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3.5">
              <span className="grid size-8 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <Power className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-xs font-medium">Iniciar con macOS</strong>
                <small className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">Registra FlowDesk mediante LaunchAgent.</small>
              </span>
              <input
                type="checkbox"
                checked={preferences.launchAtLogin}
                onChange={(event) => setPreferences((value) => ({ ...value, launchAtLogin: event.target.checked }))}
                className="size-4 accent-[var(--accent)]"
              />
            </label>

            <label className={`flex items-center gap-3 rounded-xl border border-[var(--line)] p-3.5 ${preferences.launchAtLogin ? "cursor-pointer bg-[var(--inset)]" : "cursor-not-allowed opacity-50"}`}>
              <span className="min-w-0 flex-1 pl-11">
                <strong className="block text-xs font-medium">Iniciar oculto en la barra de menú</strong>
                <small className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">No muestra el dashboard al iniciar sesión.</small>
              </span>
              <input
                type="checkbox"
                disabled={!preferences.launchAtLogin}
                checked={preferences.launchAtLogin && preferences.launchHidden}
                onChange={(event) => setPreferences((value) => ({ ...value, launchHidden: event.target.checked }))}
                className="size-4 accent-[var(--accent)]"
              />
            </label>

            <RemindersSection />

            <UpdatesSection />

            {shortcuts.length > 0 && (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-violet-500/10 text-violet-500"><Keyboard className="size-3.5" /></span>
                  <strong className="text-xs font-medium">Atajos globales</strong>
                </div>
                <ul className="divide-y divide-[var(--line)]">
                  {shortcuts.map((shortcut) => (
                    <li key={shortcut.id} className="flex items-center gap-3 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px]">{shortcut.label}</span>
                        {!shortcut.registered && <small className="block text-[10px] text-red-500">{shortcut.error || "En uso por otra aplicación"}</small>}
                      </span>
                      <kbd className={`rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[10px] ${shortcut.registered ? "" : "line-through opacity-60"}`}>{shortcut.keys}</kbd>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[10px] text-red-500">{error}</p>}

        <footer className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">Cancelar</button>
          <button type="button" onClick={() => void save()} disabled={loading || saving} className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </footer>
      </section>
    </div>
  );
}
