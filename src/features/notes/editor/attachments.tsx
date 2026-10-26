import { useRef } from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { ExternalLink, FileText, ImageOff, Music } from "lucide-react";
import { flowdeskApi } from "../../../services/flowdeskApi";
import type { NoteAttachment } from "../../../types/notes";
import { formatBytes, useAttachmentUrl } from "./attachmentUrl";

/**
 * Nodos de adjunto. El documento guarda solo el id del adjunto y su nombre; el archivo
 * está en el directorio administrado por FlowDesk (ver commands/note_attachments.rs).
 */
const shared = {
  attachmentId: { default: null },
  fileName: { default: "" },
  mimeType: { default: "" },
  byteSize: { default: 0 },
};

const MIN_IMAGE_WIDTH = 60;

function ImageView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const { attachmentId, fileName, mimeType, width } = node.attrs as { attachmentId: string; fileName: string; mimeType: string; width: number | null };
  const { url, failed } = useAttachmentUrl(attachmentId, mimeType);
  const frameRef = useRef<HTMLDivElement>(null);

  // Redimensionar arrastrando la esquina; el ancho se guarda en el documento.
  function startResize(event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const startX = event.clientX;
    const startWidth = frame.getBoundingClientRect().width;
    const maxWidth = frame.parentElement?.getBoundingClientRect().width ?? startWidth;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.round(Math.min(maxWidth, Math.max(MIN_IMAGE_WIDTH, startWidth + moveEvent.clientX - startX)));
      frame.style.width = `${next}px`;
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      updateAttributes({ width: Math.round(frame.getBoundingClientRect().width) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  return (
    <NodeViewWrapper className="note-image-node" data-drag-handle>
      <div ref={frameRef} className={`note-image-frame ${selected ? "is-selected" : ""}`} style={{ width: width ? `${width}px` : undefined }}>
        {url ? (
          <img src={url} alt={fileName} draggable={false} />
        ) : (
          <span className="note-attachment-missing">{failed ? <><ImageOff /> No se encontró la imagen</> : "Cargando imagen…"}</span>
        )}
        <span role="presentation" className="note-image-handle" onPointerDown={startResize} title="Arrastra para cambiar el tamaño" />
      </div>
    </NodeViewWrapper>
  );
}

function FileView({ node, selected }: ReactNodeViewProps) {
  const { attachmentId, fileName, byteSize, mimeType } = node.attrs as { attachmentId: string; fileName: string; byteSize: number; mimeType: string };
  const isAudio = node.type.name === "noteAudio";
  const { url } = useAttachmentUrl(isAudio ? attachmentId : null, mimeType);
  return (
    <NodeViewWrapper className={`note-file-node ${selected ? "is-selected" : ""}`} data-drag-handle contentEditable={false}>
      <span className="note-file-icon">{isAudio ? <Music /> : <FileText />}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{fileName}</span>
        <span className="block text-[0.75em] opacity-60">{formatBytes(byteSize)}</span>
        {isAudio && url && <audio controls src={url} className="mt-1 h-7 w-full" />}
      </span>
      <button type="button" onClick={() => void flowdeskApi.openNoteAttachment(attachmentId).catch(() => undefined)} title="Abrir con la app predeterminada" className="note-file-open">
        <ExternalLink />
      </button>
    </NodeViewWrapper>
  );
}

export const NoteImage = Node.create({
  name: "noteImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { ...shared, width: { default: null } };
  },
  parseHTML() {
    return [{ tag: "figure[data-note-image]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-note-image": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

export const NoteFile = Node.create({
  name: "noteFile",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return shared;
  },
  parseHTML() {
    return [{ tag: "div[data-note-file]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-note-file": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileView);
  },
});

/** Notas de voz: por ahora archivos de audio adjuntos; la transcripción llegará más adelante. */
export const NoteAudio = NoteFile.extend({
  name: "noteAudio",
  parseHTML() {
    return [{ tag: "div[data-note-audio]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-note-audio": "" })];
  },
});

export function attachmentNode(attachment: NoteAttachment) {
  const type = attachment.kind === "image" ? "noteImage" : attachment.kind === "audio" ? "noteAudio" : "noteFile";
  return {
    type,
    attrs: {
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
    },
  };
}
