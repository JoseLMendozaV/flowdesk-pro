import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { NoteAudio, NoteFile, NoteImage } from "./attachments";

/**
 * Extensiones del editor de notas. StarterKit aporta negrita, cursiva, subrayado,
 * tachado, títulos, listas, enlaces, código, citas, separadores y deshacer.
 */
export function noteExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Los enlaces se abren con ⌘ + clic (src/features/notes/editor/RichEditor.tsx).
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer", target: null } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder: "Escribe una idea…  # título, - lista, [] tarea" }),
    NoteImage,
    NoteFile,
    NoteAudio,
  ];
}
