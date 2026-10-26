import { useCallback, useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import { flowdeskApi } from "../../../services/flowdeskApi";
import { errorMessage } from "../../../services/format";
import type { NoteAttachment } from "../../../types/notes";
import { attachmentNode } from "./attachments";
import { noteExtensions } from "./extensions";

type Options = {
  noteId: string;
  /** Documento (`rich-v1`) o HTML convertido desde Markdown (notas antiguas). */
  initialContent: JSONContent | string;
  onChange: (json: string) => void;
  onSelection: (text: string) => void;
  onError: (message: string) => void;
};

export function useNoteEditor({ noteId, initialContent, onChange, onSelection, onError }: Options) {
  // Las opciones de useEditor se fijan al crearlo: los callbacks se leen de referencias.
  const callbacks = useRef({ onChange, onSelection, onError });
  callbacks.current = { onChange, onSelection, onError };
  const uploadRef = useRef<(files: File[]) => Promise<void>>(async () => undefined);

  const editor = useEditor({
    extensions: noteExtensions(),
    content: initialContent,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: "note-editor", spellcheck: "true" },
      handlePaste: (_view, event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (images.length === 0) return false;
        event.preventDefault();
        void uploadRef.current(images);
        return true;
      },
      // ⌘ + clic abre el enlace en el navegador; un clic normal solo coloca el cursor.
      handleClick: (view, pos, event) => {
        if (!event.metaKey) return false;
        const link = view.state.doc.resolve(pos).marks().find((mark) => mark.type.name === "link");
        const href = link?.attrs.href as string | undefined;
        if (!href) return false;
        void flowdeskApi.openNoteLink(href).catch((reason) => callbacks.current.onError(errorMessage(reason)));
        return true;
      },
    },
    onUpdate: ({ editor: current }) => callbacks.current.onChange(JSON.stringify(current.getJSON())),
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      callbacks.current.onSelection(current.state.doc.textBetween(from, to, " ").trim());
    },
  });

  const insertAttachments = useCallback(
    (attachments: NoteAttachment[]) => {
      if (!editor || attachments.length === 0) return;
      editor.chain().focus().insertContent(attachments.map(attachmentNode)).run();
    },
    [editor],
  );

  /** Imágenes pegadas o archivos elegidos: los bytes viajan a Rust y se insertan como nodos. */
  const upload = useCallback(
    async (files: File[]) => {
      const added: NoteAttachment[] = [];
      for (const file of files) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          added.push(await flowdeskApi.addNoteAttachment(noteId, file.name || "imagen.png", bytes));
        } catch (reason) {
          callbacks.current.onError(errorMessage(reason));
        }
      }
      insertAttachments(added);
    },
    [insertAttachments, noteId],
  );
  uploadRef.current = upload;

  return { editor, upload, insertAttachments };
}
