import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Image, Music, Paperclip, Plus, Trash2 } from "lucide-react";
import { flowdeskApi } from "../../../services/flowdeskApi";
import { errorMessage } from "../../../services/format";
import type { NoteAttachment } from "../../../types/notes";
import { formatBytes } from "../editor/attachmentUrl";

const icons = { image: Image, file: FileText, audio: Music };

type AttachmentsPanelProps = {
  noteId: string;
  /** Cambia al guardar, para refrescar qué adjuntos usa el documento. */
  revision: number;
  onInsert: (attachment: NoteAttachment) => void;
  onUpload: (files: File[]) => void;
  /** Quita del documento los nodos de ese adjunto antes de eliminarlo. */
  onRemoveFromDocument: (attachmentId: string) => void;
};

export function AttachmentsPanel({ noteId, revision, onInsert, onUpload, onRemoveFromDocument }: AttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<NoteAttachment[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    void flowdeskApi.noteAttachments(noteId).then(setAttachments).catch((reason) => setError(errorMessage(reason)));
  }, [noteId]);
  useEffect(load, [load, revision]);

  async function remove(attachment: NoteAttachment) {
    try {
      onRemoveFromDocument(attachment.id);
      await flowdeskApi.deleteNoteAttachment(attachment.id);
      setConfirming(null);
      load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <div className="space-y-2 text-[0.72rem]">
      <div className="flex items-center justify-between">
        <p className="text-slate-600">Arrastra archivos a la nota o pega imágenes. Máximo 50 MB por archivo.</p>
        <button type="button" onClick={() => input.current?.click()} className="note-chip flex-none"><Plus className="size-3" /> Adjuntar</button>
        <input ref={input} type="file" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) onUpload(files); window.setTimeout(load, 600); }} />
      </div>
      {attachments === null ? (
        <p className="text-slate-600">Cargando…</p>
      ) : attachments.length === 0 ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-black/15 px-3 py-4 text-slate-600"><Paperclip className="size-3.5" /> Sin adjuntos.</p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((attachment) => {
            const Icon = icons[attachment.kind];
            return (
              <li key={attachment.id} className="rounded-lg bg-white/35 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Icon className="size-3.5 flex-none text-slate-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{attachment.fileName}</span>
                    <span className="block text-[0.62rem] text-slate-600">{formatBytes(attachment.byteSize)} · {attachment.inUse ? "en la nota" : "no usado en la nota"}</span>
                  </span>
                  {!attachment.inUse && <button type="button" onClick={() => onInsert(attachment)} className="note-chip">Insertar</button>}
                  <button type="button" onClick={() => void flowdeskApi.openNoteAttachment(attachment.id).catch((reason) => setError(errorMessage(reason)))} aria-label={`Abrir ${attachment.fileName}`} title="Abrir" className="note-icon-button"><ExternalLink /></button>
                  <button type="button" onClick={() => setConfirming(attachment.id)} aria-label={`Eliminar ${attachment.fileName}`} title="Eliminar" className="note-icon-button hover:text-red-600"><Trash2 /></button>
                </div>
                {confirming === attachment.id && (
                  <div className="mt-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-[0.65rem]">
                    ¿Eliminar «{attachment.fileName}»? Se quitará de la nota. Durante 30 días se recupera restaurando una versión anterior desde Historial.
                    <span className="mt-1 flex gap-1">
                      <button type="button" onClick={() => void remove(attachment)} className="note-chip bg-red-600 text-white">Eliminar</button>
                      <button type="button" onClick={() => setConfirming(null)} className="note-chip">Cancelar</button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
