import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppWindow, Pause, Play, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { useWindowVisible } from "../../hooks/useWindowVisible";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage, formatDuration } from "../../services/format";
import type { AppTrackingSettings, AppUsageReport } from "../../types/appTracking";

const idleOptions = [1, 2, 5, 10, 15, 30];
const MAX_APPS = 10;

/** Tiempo de uso por aplicación, medido por Rust con consentimiento previo. */
export function AppUsagePanel() {
  const [settings, setSettings] = useState<AppTrackingSettings | null>(null);
  const [report, setReport] = useState<AppUsageReport | null>(null);
  const [range, setRange] = useState<"today" | "week">("today");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = useWindowVisible();

  const load = useCallback(async () => {
    try {
      const [nextSettings, nextReport] = await Promise.all([flowdeskApi.appTrackingSettings(), flowdeskApi.appUsage()]);
      setSettings(nextSettings);
      setReport(nextReport);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["app-usage"], () => void load());
  // Los puntos de control llegan cada minuto; entre ellos se refresca solo con la ventana visible.
  useEffect(() => {
    if (!visible || !settings?.enabled || settings.paused) return;
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load, settings?.enabled, settings?.paused, visible]);

  async function save(next: AppTrackingSettings) {
    try {
      setSettings(await flowdeskApi.updateAppTrackingSettings(next));
      setError(null);
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function exclude() {
    const path = await openDialog({ directory: false, multiple: false, title: "Excluir una aplicación del seguimiento", defaultPath: "/Applications", filters: [{ name: "Aplicaciones", extensions: ["app"] }] });
    if (typeof path !== "string") return;
    try {
      setSettings(await flowdeskApi.excludeTrackingApp(path));
      void load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (!settings) return null;

  if (!settings.enabled && !report?.weekSeconds) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
        <div className="flex items-start gap-3">
          <span className="grid size-9 flex-none place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><ShieldCheck className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Tiempo por aplicación</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-[var(--muted)]">
              Con tu autorización, FlowDesk anota qué app está en primer plano para calcular cuánto tiempo pasas en cada una. Solo guarda el nombre de la app: nunca títulos de ventanas, documentos ni lo que escribes. Deja de contar cuando no usas el teclado ni el ratón, no necesita permisos de accesibilidad y los datos se borran a los {settings.retentionDays} días.
            </p>
          </div>
          <button type="button" onClick={() => void save({ ...settings, enabled: true, paused: false })} className="flex-none rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white">Activar</button>
        </div>
        {error && <p className="mt-3 text-[11px] text-red-500">{error}</p>}
      </section>
    );
  }

  const apps = [...(report?.apps ?? [])]
    .map((app) => ({ ...app, seconds: range === "today" ? app.todaySeconds : app.weekSeconds }))
    .filter((app) => app.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
  const shown = apps.slice(0, MAX_APPS);
  const others = apps.slice(MAX_APPS).reduce((total, app) => total + app.seconds, 0);
  const max = Math.max(1, ...shown.map((app) => app.seconds), others);
  const total = range === "today" ? report?.todaySeconds ?? 0 : report?.weekSeconds ?? 0;
  const status = !settings.enabled ? "Desactivado" : settings.paused ? "En pausa" : report?.currentApp ? `Midiendo: ${report.currentApp}` : "Esperando actividad";

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Tiempo por aplicación</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <span className={`size-1.5 rounded-full ${settings.enabled && !settings.paused ? "bg-emerald-500" : "bg-[var(--muted)]"}`} />
            {status} · {formatDuration(total)} {range === "today" ? "hoy" : "esta semana"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div role="radiogroup" aria-label="Periodo" className="flex rounded-lg border border-[var(--line)] p-0.5">
            {(["today", "week"] as const).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={range === value} onClick={() => setRange(value)} className={`rounded-md px-2 py-0.5 text-[10px] ${range === value ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "text-[var(--muted)]"}`}>
                {value === "today" ? "Hoy" : "Semana"}
              </button>
            ))}
          </div>
          {settings.enabled ? (
            <>
              <button type="button" onClick={() => void save({ ...settings, paused: !settings.paused })} className="flex items-center gap-1 rounded-lg border border-[var(--line)] px-2 py-1 text-[10px] hover:border-[var(--line-strong)]">
                {settings.paused ? <><Play className="size-3" /> Reanudar</> : <><Pause className="size-3" /> Pausar</>}
              </button>
              <label className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                Inactivo tras
                <select value={settings.idleMinutes} onChange={(event) => void save({ ...settings, idleMinutes: Number(event.target.value) })} className="rounded-md border border-[var(--line)] bg-[var(--input)] px-1 py-0.5 text-[10px] text-[var(--text)]">
                  {idleOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void save({ ...settings, enabled: false, paused: false })} className="rounded-lg px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)]">Desactivar</button>
            </>
          ) : (
            <button type="button" onClick={() => void save({ ...settings, enabled: true, paused: false })} className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[10px] font-medium text-white">Activar</button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] px-3 py-8 text-center text-[11px] text-[var(--muted)]">
          {settings.enabled ? "Aún no hay tiempo registrado en este periodo." : "Sin datos en este periodo."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5" aria-label={`Tiempo por aplicación ${range === "today" ? "hoy" : "esta semana"}`}>
          {[...shown.map((app) => ({ key: app.bundleId, name: app.appName, seconds: app.seconds })), ...(others > 0 ? [{ key: "others", name: `Otras ${apps.length - MAX_APPS} apps`, seconds: others }] : [])].map((row) => (
            <li key={row.key} title={`${row.name}: ${formatDuration(row.seconds)} (${Math.round((row.seconds / Math.max(total, 1)) * 100)} %)`}>
              <div className="mb-1 flex items-center gap-2 text-[11px]">
                <AppWindow className="size-3 flex-none text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="tabular-nums text-[var(--muted)]">{formatDuration(row.seconds)}</span>
              </div>
              <div className="h-2 rounded-r-[4px] bg-[var(--track)]">
                <div className="h-full rounded-r-[4px]" style={{ width: `${(row.seconds / max) * 100}%`, backgroundColor: "var(--series-1)" }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-3 text-[10px]">
        <span className="text-[var(--muted)]">Excluidas:</span>
        {settings.excludedApps.length === 0 && <span className="text-[var(--muted)]">ninguna</span>}
        {settings.excludedApps.map((app) => (
          <span key={app.bundleId} className="flex items-center gap-1 rounded-md bg-[var(--inset)] py-0.5 pl-2 pr-1">
            {app.name}
            <button type="button" onClick={() => void save({ ...settings, excludedApps: settings.excludedApps.filter((other) => other.bundleId !== app.bundleId) })} aria-label={`Dejar de excluir ${app.name}`} className="grid size-4 place-items-center rounded text-[var(--muted)] hover:text-[var(--text)]"><X className="size-2.5" /></button>
          </span>
        ))}
        <button type="button" onClick={() => void exclude()} className="flex items-center gap-1 rounded-md border border-[var(--line)] px-1.5 py-0.5 hover:border-[var(--line-strong)]"><Plus className="size-3" /> Excluir app</button>
        <span className="flex-1" />
        {confirmingClear ? (
          <span className="flex items-center gap-1">
            ¿Borrar todo el historial de uso?
            <button type="button" onClick={() => void flowdeskApi.clearAppTracking().then(() => { setConfirmingClear(false); void load(); }).catch((reason) => setError(errorMessage(reason)))} className="rounded-md bg-red-500 px-2 py-0.5 font-medium text-white">Borrar</button>
            <button type="button" onClick={() => setConfirmingClear(false)} className="rounded-md px-1.5 py-0.5 text-[var(--muted)]">No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmingClear(true)} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[var(--muted)] hover:text-red-500"><Trash2 className="size-3" /> Borrar datos</button>
        )}
      </div>
      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
    </section>
  );
}
