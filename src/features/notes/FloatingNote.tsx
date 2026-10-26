import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileDown,
  GripVertical,
  ListChecks,
  ListTodo,
  MoreHorizontal,
  Paperclip,
  X,
} from "lucide-react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage } from "../../services/format";
import type { Note } from "../../types/dashboard";
import type { NoteAttachment } from "../../types/notes";
import { EditorToolbar } from "./editor/EditorToolbar";
import { markdownToHtml } from "./editor/legacy";
import { useNoteEditor } from "./editor/useNoteEditor";
import { AppearancePanel } from "./panels/AppearancePanel";
import { AttachmentsPanel } from "./panels/AttachmentsPanel";
import { ContextPanel } from "./panels/ContextPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import "./notes.css";

/** Diario local de lo escrito sin guardar, para recuperarlo tras un cierre inesperado. */
const DRAFT_PREFIX = "flowdesk:note-draft:";
const SAVE_DELAY = 650;
const CONFLICT = "NOTE_CONFLICT";

type Draft = { baseRevision: number; title: string; contentJson: string; at: number };
type Panel = "appearance" | "context" | "attachments" | "history";

const panels: { id: Panel; label: string }[] = [
  { id: "appearance", label: "Apariencia" },
  { id: "context", label: "Contexto" },
  { id: "attachments", label: "Adjuntos" },
  { id: "history", label: "Historial" },
];

function readDraft(noteId: string): Draft | null {
  try {
    const stored = localStorage.getItem(DRAFT_PREFIX + noteId);
    return stored ? (JSON.parse(stored) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(noteId: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(DRAFT_PREFIX + noteId, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_PREFIX + noteId);
  } catch {
    // Sin almacenamiento local se pierde solo la recuperación, no el guardado normal.
  }
}

/** Documento enriquecido, o el Markdown de una nota antigua convertido para el editor. */
function editorContent(note: Note): JSONContent | string {
  if (note.contentFormat === "rich-v1" && note.contentJson) {
    try {
      return JSON.parse(note.contentJson) as JSONContent;
    } catch {
      // Un documento ilegible se muestra como texto: nunca se pierde lo guardado.
    }
  }
  return markdownToHtml(note.content);
}

/** El documento que se guarda: `null` mientras una nota antigua no se edite (sigue en Markdown). */
function storedDocument(note: Note) {
  return note.contentFormat === "rich-v1" ? note.contentJson : null;
}

function signatureOf(note: Note, document: string | null) {
  return JSON.stringify([note.title, note.color, note.window.opacity, note.window.fontSize, note.reminderAt, note.projectId, document ?? note.content]);
}

export function FloatingNote({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void flowdeskApi.note(noteId).then(setNote).catch((reason) => setError(errorMessage(reason)));
  }, [noteId]);

  if (error && !note) {
    return <div className="grid h-screen place-items-center bg-red-50 p-5 text-center text-xs text-red-600">{error}</div>;
  }
  if (!note) return <div className="grid h-screen place-items-center bg-[#FFF2A8] text-xs text-slate-500">Cargando nota…</div>;
  return <NoteWindow initial={note} />;
}

function NoteWindow({ initial }: { initial: Note }) {
  const noteId = initial.id;
  const [note, setNoteState] = useState(initial);
  const noteRef = useRef(initial);
  const documentRef = useRef<string | null>(storedDocument(initial));
  const baseRevision = useRef(initial.revision);
  const savedSignature = useRef(signatureOf(initial, storedDocument(initial)));
  const savingRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef<Note | null>(null);
  const [changes, setChanges] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [selection, setSelection] = useState("");
  const [taskCreated, setTaskCreated] = useState(false);
  const [conflict, setConflict] = useState<Note | null>(null);
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setNote = useCallback((update: (current: Note) => Note) => {
    noteRef.current = update(noteRef.current);
    setNoteState(noteRef.current);
  }, []);

  const journal = useCallback(() => {
    const document = documentRef.current;
    if (document) writeDraft(noteId, { baseRevision: baseRevision.current, title: noteRef.current.title, contentJson: document, at: Date.now() });
  }, [noteId]);

  const { editor, upload, insertAttachments } = useNoteEditor({
    noteId,
    initialContent: editorContent(initial),
    onChange: (json) => {
      documentRef.current = json;
      journal();
      setChanges((value) => value + 1);
    },
    onSelection: setSelection,
    onError: setError,
  });

  /** Guarda si hay cambios. Una sola escritura a la vez; la siguiente usa la revisión nueva. */
  const save = useCallback(async () => {
    if (savingRef.current) await savingRef.current;
    const current = noteRef.current;
    const document = documentRef.current;
    const signature = signatureOf(current, document);
    if (signature === savedSignature.current || conflictRef.current) return;
    const run = (async () => {
      setSaveState("saving");
      try {
        const saved = await flowdeskApi.updateNote({
          id: current.id,
          title: current.title,
          content: current.content,
          color: current.color,
          opacity: current.window.opacity,
          fontSize: current.window.fontSize,
          reminderAt: current.reminderAt,
          projectId: current.projectId,
          contentJson: document,
          baseRevision: baseRevision.current,
        });
        baseRevision.current = saved.revision;
        savedSignature.current = signature;
        setNote((value) => ({ ...value, revision: saved.revision, contentFormat: saved.contentFormat, links: saved.links, updatedAt: saved.updatedAt }));
        if (signatureOf(noteRef.current, documentRef.current) === signature) writeDraft(noteId, null);
        setSaveState("saved");
        window.setTimeout(() => setSaveState((state) => (state === "saved" ? "idle" : state)), 1200);
      } catch (reason) {
        if (errorMessage(reason) === CONFLICT) {
          const latest = await flowdeskApi.note(noteId);
          conflictRef.current = latest;
          setConflict(latest);
          setSaveState("idle");
        } else {
          setSaveState("error");
          setError(errorMessage(reason));
        }
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }, [noteId, setNote]);

  // Autoguardado tras una pausa en la escritura.
  useEffect(() => {
    if (changes === 0) return;
    const timeout = window.setTimeout(() => void save(), SAVE_DELAY);
    return () => window.clearTimeout(timeout);
  }, [changes, save]);

  // Guardado inmediato al cerrar (⌘W o el botón) y al perder el foco.
  useEffect(() => {
    const flush = () => void save();
    const unlisten = listen("flowdesk://note-flush", flush);
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("blur", flush);
      void unlisten.then((dispose) => dispose());
    };
  }, [save]);

  /** Carga en el editor lo que hay en SQLite (restaurar una versión o aceptar otra ventana). */
  const applyStored = useCallback(
    (stored: Note) => {
      editor?.commands.setContent(editorContent(stored), { emitUpdate: false });
      documentRef.current = storedDocument(stored);
      baseRevision.current = stored.revision;
      setNote((value) => ({ ...value, title: stored.title, content: stored.content, contentFormat: stored.contentFormat, contentJson: stored.contentJson, revision: stored.revision, links: stored.links, pinnedGlobal: stored.pinnedGlobal }));
      savedSignature.current = signatureOf(noteRef.current, documentRef.current);
      writeDraft(noteId, null);
    },
    [editor, noteId, setNote],
  );

  // Otra ventana o la app cambió la nota: sin cambios propios pendientes, se sincroniza.
  useDataChanged(["notes"], () => {
    void flowdeskApi
      .note(noteId)
      .then((stored) => {
        const clean = signatureOf(noteRef.current, documentRef.current) === savedSignature.current;
        if (stored.revision > baseRevision.current && clean && !conflictRef.current) applyStored(stored);
        else setNote((value) => ({ ...value, links: stored.links, pinnedGlobal: stored.pinnedGlobal }));
      })
      .catch(() => undefined);
  });

  // Recuperación: lo escrito después del último guardado (cierre inesperado).
  useEffect(() => {
    const draft = readDraft(noteId);
    if (!draft) return;
    const stored = storedDocument(initial);
    if (draft.contentJson !== stored || draft.title !== initial.title) setRecovery(draft);
    else writeDraft(noteId, null);
  }, [initial, noteId]);

  // Archivos arrastrados desde el Finder: Tauri entrega sus rutas.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") setDropActive(true);
      else if (event.payload.type === "leave") setDropActive(false);
      else if (event.payload.type === "drop") {
        setDropActive(false);
        void flowdeskApi
          .attachNoteFiles(noteId, event.payload.paths)
          .then(insertAttachments)
          .catch((reason) => setError(errorMessage(reason)));
      }
    });
    return () => void unlisten.then((dispose) => dispose());
  }, [insertAttachments, noteId]);

  useEffect(() => {
    // Una nota recién creada (⌥N) queda lista para escribir sin hacer clic.
    if (editor && !initial.title && !initial.content) window.setTimeout(() => editor.commands.focus(), 30);
  }, [editor, initial.content, initial.title]);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [error]);

  function update(patch: Partial<Note>) {
    setNote((value) => ({ ...value, ...patch }));
    if ("title" in patch) journal();
    setChanges((value) => value + 1);
  }

  function updateWindow(patch: Partial<Note["window"]>) {
    setNote((value) => ({ ...value, window: { ...value.window, ...patch } }));
    setChanges((value) => value + 1);
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function close() {
    await save();
    await run(() => flowdeskApi.hideNote(noteId));
  }

  async function toggleCollapsed() {
    await save();
    await run(async () => {
      const updated = await flowdeskApi.setNoteCollapsed(noteId, !noteRef.current.window.isCollapsed);
      setNote((value) => ({ ...value, window: updated.window }));
    });
  }

  async function changeMode(displayMode: Note["window"]["displayMode"]) {
    await run(async () => {
      const updated = await flowdeskApi.setNoteDisplayMode(noteId, displayMode);
      setNote((value) => ({ ...value, window: { ...value.window, displayMode: updated.window.displayMode } }));
    });
  }

  async function convertSelection() {
    if (!selection) return;
    await run(() => flowdeskApi.createTask({ title: selection.replace(/\s+/g, " ").slice(0, 240), noteId, projectId: noteRef.current.projectId }));
    setTaskCreated(true);
    window.setTimeout(() => setTaskCreated(false), 1400);
  }

  async function archive() {
    await save();
    await run(() => flowdeskApi.archiveNote(noteId, true));
  }

  async function remove() {
    if (!window.confirm("¿Eliminar esta nota y sus adjuntos definitivamente?")) return;
    writeDraft(noteId, null);
    await run(() => flowdeskApi.deleteNote(noteId));
  }

  /** Quita del documento los nodos de un adjunto que se va a eliminar. */
  function removeFromDocument(attachmentId: string) {
    if (!editor) return;
    const { tr } = editor.state;
    const ranges: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.attrs.attachmentId === attachmentId) ranges.push({ from: position, to: position + node.nodeSize });
    });
    ranges.reverse().forEach(({ from, to }) => tr.delete(from, to));
    if (ranges.length) editor.view.dispatch(tr);
  }

  async function resolveConflict(keepMine: boolean) {
    const theirs = conflictRef.current;
    if (!theirs) return;
    conflictRef.current = null;
    setConflict(null);
    if (keepMine) {
      // La de la otra ventana no se pierde: queda en Historial antes de sobrescribirla.
      await run(() => flowdeskApi.preserveNoteVersion(noteId));
      baseRevision.current = theirs.revision;
      await save();
    } else {
      // La mía no se pierde: se guarda como versión antes de cargar la otra.
      if (documentRef.current) await run(() => flowdeskApi.saveNoteConflictCopy(noteId, noteRef.current.title, documentRef.current ?? ""));
      applyStored(theirs);
    }
  }

  function recover(accept: boolean) {
    const draft = recovery;
    setRecovery(null);
    if (!accept || !draft) {
      writeDraft(noteId, null);
      return;
    }
    try {
      editor?.commands.setContent(JSON.parse(draft.contentJson) as JSONContent, { emitUpdate: true });
      update({ title: draft.title });
    } catch {
      setError("No se pudo recuperar el borrador");
    }
  }

  const legacy = note.contentFormat === "markdown" && documentRef.current === null;
  const { checklistTotal, checklistDone, attachmentCount } = note.links;

  return (
    <div className="floating-note relative flex h-screen flex-col overflow-hidden text-slate-800" style={{ backgroundColor: note.color, opacity: note.window.opacity }}>
      {/* "deep": toda la cabecera mueve la nota salvo sus campos y botones. */}
      <header data-tauri-drag-region="deep" className="flex h-[46px] flex-none cursor-grab items-center gap-1.5 border-b border-black/8 pl-1 pr-2.5 active:cursor-grabbing">
        <span title="Arrastra para mover" className="grid h-full w-5 flex-none place-items-center text-slate-500/60 hover:text-slate-700">
          <GripVertical className="size-3.5" />
        </span>
        <input
          value={note.title}
          onChange={(event) => update({ title: event.target.value })}
          maxLength={120}
          placeholder="Título de la nota"
          aria-label="Título de la nota"
          className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold outline-none placeholder:text-slate-500/65"
        />
        <span className="min-w-10 text-right text-[8px] text-slate-500/80" aria-live="polite">
          {saveState === "saving" ? "Guardando…" : saveState === "saved" ? "Guardado" : saveState === "error" ? "Error" : ""}
        </span>
        <button type="button" onClick={() => setPanel((value) => (value ? null : "appearance"))} aria-label="Opciones de la nota" aria-expanded={panel !== null} className="note-header-button"><MoreHorizontal /></button>
        <button type="button" onClick={() => void toggleCollapsed()} aria-label={note.window.isCollapsed ? "Expandir" : "Minimizar"} className="note-header-button">
          {note.window.isCollapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
        <button type="button" onClick={() => void close()} aria-label="Cerrar nota" className="note-header-button hover:bg-red-500/15"><X /></button>
      </header>

      {!note.window.isCollapsed && editor && (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <EditorToolbar editor={editor} onUpload={(files) => void upload(files)} />

          {conflict && (
            <div role="alert" className="note-banner bg-amber-200/70">
              Otra ventana guardó cambios en esta nota.
              <span className="flex gap-1">
                <button type="button" onClick={() => void resolveConflict(true)} className="note-chip">Conservar la mía</button>
                <button type="button" onClick={() => void resolveConflict(false)} className="note-chip">Usar la otra</button>
              </span>
            </div>
          )}
          {recovery && (
            <div role="alert" className="note-banner bg-sky-200/70">
              Hay cambios sin guardar de la última sesión.
              <span className="flex gap-1">
                <button type="button" onClick={() => recover(true)} className="note-chip">Recuperar</button>
                <button type="button" onClick={() => recover(false)} className="note-chip">Descartar</button>
              </span>
            </div>
          )}
          {legacy && (
            <p className="note-banner justify-start bg-black/5 text-[0.65rem]">
              <FileDown className="size-3 flex-none" /> Nota del editor anterior: se convertirá al editarla. El original queda en Historial.
            </p>
          )}

          <EditorContent editor={editor} className="note-editor-scroll min-h-0 flex-1 overflow-y-auto" style={{ fontSize: note.window.fontSize }} />

          <footer className="flex flex-none items-center gap-2 border-t border-black/8 px-2 py-1 text-[0.62rem] text-slate-600">
            {checklistTotal > 0 && <span className="flex items-center gap-1" title="Listas de verificación"><ListChecks className="size-3" /> {checklistDone}/{checklistTotal}</span>}
            {attachmentCount > 0 && (
              <button type="button" onClick={() => setPanel("attachments")} className="flex items-center gap-1 hover:text-slate-900"><Paperclip className="size-3" /> {attachmentCount}</button>
            )}
            <button type="button" disabled={!selection} onClick={() => void convertSelection()} className="note-mode-button ml-auto disabled:opacity-35">
              {taskCreated ? <Check /> : <ListTodo />} {taskCreated ? "Tarea creada" : "Convertir selección"}
            </button>
          </footer>

          {panel && (
            <section aria-label="Opciones de la nota" className="note-panel absolute inset-0 z-20 flex flex-col">
              <div role="tablist" aria-label="Secciones" className="flex flex-none items-center gap-0.5 border-b border-black/8 px-1.5 py-1">
                {panels.map((option) => (
                  <button key={option.id} type="button" role="tab" aria-selected={panel === option.id} onClick={() => setPanel(option.id)} className={`note-tab ${panel === option.id ? "is-active" : ""}`}>
                    {option.label}
                  </button>
                ))}
                <button type="button" onClick={() => setPanel(null)} aria-label="Cerrar opciones" className="note-icon-button ml-auto"><X /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {panel === "appearance" && (
                  <AppearancePanel
                    note={note}
                    onChange={update}
                    onWindowChange={updateWindow}
                    onDisplayMode={(mode) => void changeMode(mode)}
                    onPinned={(pinned) => void run(async () => {
                      const updated = await flowdeskApi.setNotePinnedGlobal(noteId, pinned);
                      setNote((value) => ({ ...value, pinnedGlobal: updated.pinnedGlobal }));
                    })}
                    onArchive={() => void archive()}
                    onDelete={() => void remove()}
                  />
                )}
                {panel === "context" && <ContextPanel noteId={noteId} projectId={note.projectId} onProjectChange={(projectId) => update({ projectId })} />}
                {panel === "attachments" && (
                  <AttachmentsPanel
                    noteId={noteId}
                    revision={note.revision}
                    onInsert={(attachment: NoteAttachment) => { insertAttachments([attachment]); setPanel(null); }}
                    onUpload={(files) => void upload(files)}
                    onRemoveFromDocument={removeFromDocument}
                  />
                )}
                {panel === "history" && (
                  <HistoryPanel
                    noteId={noteId}
                    revision={note.revision}
                    beforeRestore={save}
                    onRestored={() => void flowdeskApi.note(noteId).then(applyStored).catch((reason) => setError(errorMessage(reason)))}
                  />
                )}
              </div>
            </section>
          )}

          {dropActive && (
            <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-slate-600/50 bg-white/40 text-[0.75rem] font-medium backdrop-blur-sm">
              Suelta para adjuntar a la nota
            </div>
          )}
        </div>
      )}
      {error && <div role="alert" className="absolute inset-x-2 bottom-2 z-40 rounded-lg bg-red-600 px-2 py-1.5 text-[9px] text-white shadow-lg">{error}</div>}
    </div>
  );
}
