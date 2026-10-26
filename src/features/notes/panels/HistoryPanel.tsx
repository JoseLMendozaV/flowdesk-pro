import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { flowdeskApi } from "../../../services/flowdeskApi";
import { errorMessage } from "../../../services/format";
import type { NoteVersionReason, NoteVersionSummary } from "../../../types/notes";

const reasons: Record<NoteVersionReason, string> = {
  legacy: "Original (editor anterior)",
  snapshot: "Copia automática",
  "before-restore": "Antes de restaurar",
  conflict: "Copia de un conflicto",
};
const dateFormatter = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type HistoryPanelProps = {
  noteId: string;
  revision: number;
  /** Guarda lo pendiente antes de restaurar, para no perderlo. */
  beforeRestore: () => Promise<void>;
  onRestored: () => void;
};

/** Copias completas recuperables: la actual se guarda como versión antes de restaurar. */
export function HistoryPanel({ noteId, revision, beforeRestore, onRestored }: HistoryPanelProps) {
  const [versions, setVersions] = useState<NoteVersionSummary[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void flowdeskApi.noteVersions(noteId).then(setVersions).catch((reason) => setError(errorMessage(reason)));
  }, [noteId]);
  useEffect(load, [load, revision]);

  async function restore(versionId: string) {
    try {
      await beforeRestore();
      await flowdeskApi.restoreNoteVersion(noteId, versionId);
      setConfirming(null);
      onRestored();
      load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <div className="space-y-2 text-[0.72rem]">
      <p className="text-slate-600">Copia automática cada 10 minutos de edición (hasta 20). El original de las notas antiguas se conserva siempre.</p>
      {versions === null ? (
        <p className="text-slate-600">Cargando…</p>
      ) : versions.length === 0 ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-black/15 px-3 py-4 text-slate-600"><History className="size-3.5" /> Aún no hay versiones guardadas.</p>
      ) : (
        <ul className="space-y-1">
          {versions.map((version) => (
            <li key={version.id} className="rounded-lg bg-white/35 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{reasons[version.reason]}</span>
                  <span className="block text-[0.62rem] text-slate-600">{dateFormatter.format(new Date(version.createdAt * 1000))}{version.format === "markdown" ? " · Markdown" : ""}</span>
                </span>
                <button type="button" onClick={() => setConfirming(version.id)} className="note-chip"><RotateCcw className="size-3" /> Restaurar</button>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[0.65rem] text-slate-700">{version.title ? `${version.title} — ` : ""}{version.preview || "Nota vacía"}</p>
              {confirming === version.id && (
                <div className="mt-1.5 rounded-md bg-black/5 px-2 py-1.5 text-[0.65rem]">
                  El contenido actual se guardará como versión antes de restaurar.
                  <span className="mt-1 flex gap-1">
                    <button type="button" onClick={() => void restore(version.id)} className="note-chip bg-slate-800 text-white">Restaurar</button>
                    <button type="button" onClick={() => setConfirming(null)} className="note-chip">Cancelar</button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
