import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { AlertTriangle, ArchiveRestore, FolderOpen, HardDriveDownload, LoaderCircle, RotateCcw } from "lucide-react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { flowdeskApi } from "../../services/flowdeskApi";
import type { BackupEntry, BackupOverview } from "../../types/backups";

const keepOptions = [7, 14, 30, 60, 90];
const kindLabels: Record<BackupEntry["kind"], string> = {
  automatic: "Diaria",
  manual: "Manual",
  "before-restore": "Antes de restaurar",
};

function when(seconds: number) {
  return new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(seconds * 1000);
}

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** «…/iCloud Drive/Copias FlowDesk» en lugar de la ruta completa de Mobile Documents. */
function folderLabel(path: string) {
  const icloud = path.match(/Mobile Documents\/com~apple~CloudDocs\/?(.*)$/);
  if (icloud) return `iCloud Drive${icloud[1] ? ` › ${icloud[1].split("/").join(" › ")}` : ""}`;
  return path.replace(/^\/Users\/[^/]+/, "~");
}

/**
 * Copias de seguridad: una al día en la carpeta elegida, las últimas N, y restaurar con un
 * clic (FlowDesk guarda antes el estado actual y se reinicia con la copia).
 */
export function BackupsSection() {
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    void flowdeskApi.backups().then(setOverview).catch((reason) => setError(String(reason)));
  }, []);
  useEffect(load, [load]);
  useDataChanged(["backups"], load);

  if (!overview) return error ? <p className="text-[10px] text-red-500">{error}</p> : null;
  const { settings, backups, folderAvailable } = overview;

  async function change(folder: string | null, enabled: boolean, keep: number) {
    try {
      setOverview(await flowdeskApi.updateBackupSettings(folder, enabled, keep));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function chooseFolder() {
    const folder = await open({ directory: true, title: "Carpeta para las copias de FlowDesk", defaultPath: settings.folder ?? undefined });
    if (typeof folder === "string") await change(folder, settings.enabled, settings.keep);
  }

  async function backupNow() {
    setBusy("backup");
    setError(null);
    try {
      await flowdeskApi.backupNow();
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function restore(path: string, label: string) {
    if (!confirm(`¿Restaurar la copia del ${label}?\n\nFlowDesk guardará antes una copia del estado actual («Antes de restaurar») y se reiniciará con los datos de esa copia.`)) return;
    setBusy("restore");
    setError(null);
    try {
      await flowdeskApi.restoreBackup(path);
      await invoke("prepare_restart");
      await relaunch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(null);
    }
  }

  async function restoreFromFile() {
    const path = await open({ title: "Copia de FlowDesk para restaurar", filters: [{ name: "Copia de FlowDesk", extensions: ["sqlite3"] }], defaultPath: settings.folder ?? undefined });
    if (typeof path === "string") await restore(path, path.split("/").pop() ?? "archivo elegido");
  }

  const listed = showAll ? backups : backups.slice(0, 5);
  const buttonClass = "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] disabled:opacity-50";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3.5" data-tour-id="settings-backups">
      <label className="flex cursor-pointer items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-sky-500/10 text-sky-500"><HardDriveDownload className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-xs font-medium">Copias de seguridad</strong>
          <small className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">Una copia diaria de todo FlowDesk (también notas, calificaciones y asistencia) en la carpeta que elijas.</small>
        </span>
        <input type="checkbox" checked={settings.enabled} onChange={(event) => void change(settings.folder, event.target.checked, settings.keep)} className="size-4 accent-[var(--accent)]" aria-label="Copia diaria automática" />
      </label>

      <div className="mt-2.5 space-y-2 border-t border-[var(--line)] pt-2.5 text-[11px]">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            Carpeta
            <small className={`block truncate text-[10px] ${settings.folder && !folderAvailable ? "text-red-500" : "text-[var(--muted)]"}`} title={settings.folder ?? undefined}>
              {settings.folder ? `${folderLabel(settings.folder)}${folderAvailable ? "" : " · no disponible"}` : "Elige una; en iCloud Drive las copias quedan también en la nube."}
            </small>
          </span>
          <button type="button" onClick={() => void chooseFolder()} className={buttonClass}>
            <FolderOpen className="size-3.5" /> {settings.folder ? "Cambiar…" : "Elegir carpeta…"}
          </button>
        </div>
        <label className="flex items-center justify-between gap-3">
          Conservar
          <select value={settings.keep} onChange={(event) => void change(settings.folder, settings.enabled, Number(event.target.value))} className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5 py-0.5 text-[11px]">
            {[...new Set([...keepOptions, settings.keep])].sort((a, b) => a - b).map((value) => (
              <option key={value} value={value}>Las últimas {value}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between gap-3">
          <small className="text-[10px] text-[var(--muted)]">
            {settings.lastBackupAt ? `Última copia: ${when(settings.lastBackupAt)}` : "Aún no hay copias"}
          </small>
          <span className="flex gap-1.5">
            {settings.folder && folderAvailable && (
              <button type="button" onClick={() => void flowdeskApi.revealBackupFolder()} className={buttonClass} title="Mostrar en el Finder">
                <FolderOpen className="size-3.5" />
              </button>
            )}
            <button type="button" disabled={!settings.folder || !folderAvailable || busy != null} onClick={() => void backupNow()} className={buttonClass}>
              {busy === "backup" ? <LoaderCircle className="size-3.5 animate-spin" /> : <HardDriveDownload className="size-3.5" />}
              Hacer copia ahora
            </button>
          </span>
        </div>
        {settings.lastError && (
          <p className="flex items-start gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[10px] text-red-500">
            <AlertTriangle className="mt-px size-3 shrink-0" /> La última copia falló: {settings.lastError}
          </p>
        )}
      </div>

      {backups.length > 0 && (
        <div className="mt-2.5 border-t border-[var(--line)] pt-2.5">
          <strong className="mb-1 block text-[11px] font-medium">Restaurar</strong>
          <ul className="divide-y divide-[var(--line)]" aria-label="Copias disponibles">
            {listed.map((backup) => (
              <li key={backup.path} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px]">{when(backup.createdAt)}</span>
                  <small className="block text-[10px] text-[var(--muted)]">{kindLabels[backup.kind]} · {size(backup.size)}</small>
                </span>
                <button type="button" disabled={busy != null} onClick={() => void restore(backup.path, when(backup.createdAt))} className={buttonClass}>
                  <RotateCcw className="size-3.5" /> Restaurar
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex items-center justify-between">
            {backups.length > 5 ? (
              <button type="button" onClick={() => setShowAll((value) => !value)} className="text-[10px] text-[var(--accent)]">
                {showAll ? "Ver menos" : `Ver las ${backups.length} copias`}
              </button>
            ) : <span />}
            <button type="button" disabled={busy != null} onClick={() => void restoreFromFile()} className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50">
              <ArchiveRestore className="size-3" /> Desde otro archivo…
            </button>
          </div>
        </div>
      )}
      {backups.length === 0 && (
        <button type="button" disabled={busy != null} onClick={() => void restoreFromFile()} className="mt-2 flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50">
          <ArchiveRestore className="size-3" /> Restaurar desde un archivo…
        </button>
      )}
      {busy === "restore" && <p className="mt-2 text-[10px] text-[var(--muted)]">Preparando la copia… FlowDesk se reiniciará.</p>}
      {error && <p className="mt-2 text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
