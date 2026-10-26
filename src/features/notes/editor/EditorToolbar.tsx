import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Redo2,
  Table,
  Underline,
  Undo2,
} from "lucide-react";

type EditorToolbarProps = {
  editor: Editor;
  onUpload: (files: File[]) => void;
};

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`note-tool ${active ? "is-active" : ""}`}
    >
      {children}
    </button>
  );
}

/** Barra compacta: cabe en una nota estrecha y pasa a dos filas si hace falta. */
export function EditorToolbar({ editor, onUpload }: EditorToolbarProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      heading: ([1, 2, 3] as const).find((level) => current.isActive("heading", { level })) ?? 0,
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      taskList: current.isActive("taskList"),
      blockquote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      link: current.isActive("link"),
      linkHref: (current.getAttributes("link").href as string | undefined) ?? "",
      table: current.isActive("table"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  function openLink() {
    setHref(state.linkHref);
    setLinkOpen((open) => !open);
  }

  function applyLink(event: React.FormEvent) {
    event.preventDefault();
    const value = href.trim();
    if (!value) chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: /^[a-z]+:/i.test(value) ? value : `https://${value}` }).run();
    setLinkOpen(false);
  }

  function picked(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) onUpload(files);
  }

  return (
    <div className="flex-none border-b border-black/8">
      <div role="toolbar" aria-label="Formato" className="flex flex-wrap items-center gap-0.5 px-1.5 py-1">
        <select
          value={state.heading}
          onChange={(event) => {
            const level = Number(event.target.value) as 0 | 1 | 2 | 3;
            if (level === 0) chain().setParagraph().run();
            else chain().setHeading({ level }).run();
          }}
          aria-label="Estilo de texto"
          className="note-tool-select"
        >
          <option value={0}>Texto</option>
          <option value={1}>Título 1</option>
          <option value={2}>Título 2</option>
          <option value={3}>Título 3</option>
        </select>
        <ToolButton label="Negrita (⌘B)" active={state.bold} onClick={() => chain().toggleBold().run()}><Bold /></ToolButton>
        <ToolButton label="Cursiva (⌘I)" active={state.italic} onClick={() => chain().toggleItalic().run()}><Italic /></ToolButton>
        <ToolButton label="Subrayado (⌘U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}><Underline /></ToolButton>
        <span className="note-tool-separator" />
        <ToolButton label="Lista" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}><List /></ToolButton>
        <ToolButton label="Lista numerada" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}><ListOrdered /></ToolButton>
        <ToolButton label="Lista de verificación" active={state.taskList} onClick={() => chain().toggleTaskList().run()}><ListChecks /></ToolButton>
        <span className="note-tool-separator" />
        <ToolButton label="Enlace" active={state.link || linkOpen} onClick={openLink}><Link2 /></ToolButton>
        <ToolButton label="Cita" active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}><Quote /></ToolButton>
        <ToolButton label="Bloque de código" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}><Code2 /></ToolButton>
        <ToolButton label="Separador" onClick={() => chain().setHorizontalRule().run()}><Minus /></ToolButton>
        <ToolButton label="Tabla" active={state.table} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></ToolButton>
        <ToolButton label="Insertar imagen" onClick={() => imageInput.current?.click()}><ImagePlus /></ToolButton>
        <ToolButton label="Adjuntar archivo" onClick={() => fileInput.current?.click()}><Paperclip /></ToolButton>
        <span className="note-tool-separator" />
        <ToolButton label="Deshacer (⌘Z)" disabled={!state.canUndo} onClick={() => chain().undo().run()}><Undo2 /></ToolButton>
        <ToolButton label="Rehacer (⇧⌘Z)" disabled={!state.canRedo} onClick={() => chain().redo().run()}><Redo2 /></ToolButton>
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={picked} />
        <input ref={fileInput} type="file" multiple hidden onChange={picked} />
      </div>
      {linkOpen && (
        <form onSubmit={applyLink} className="flex items-center gap-1 px-2 pb-1.5">
          <input autoFocus value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://… (vacío para quitar el enlace)" aria-label="Dirección del enlace" className="note-field min-w-0 flex-1" />
          <button type="submit" className="note-chip">Aplicar</button>
        </form>
      )}
      {state.table && (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 text-[0.7rem]" aria-label="Tabla">
          <button type="button" className="note-chip" onClick={() => chain().addRowAfter().run()}>+ fila</button>
          <button type="button" className="note-chip" onClick={() => chain().addColumnAfter().run()}>+ columna</button>
          <button type="button" className="note-chip" onClick={() => chain().deleteRow().run()}>− fila</button>
          <button type="button" className="note-chip" onClick={() => chain().deleteColumn().run()}>− columna</button>
          <button type="button" className="note-chip" onClick={() => chain().deleteTable().run()}>Quitar tabla</button>
        </div>
      )}
    </div>
  );
}
