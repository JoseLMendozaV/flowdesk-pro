import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  GripVertical,
  ListTodo,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { flowdeskApi } from "../../services/flowdeskApi";
import type { Note } from "../../types/dashboard";
import type { ProjectSummary } from "../../types/projects";

const colors = ["#FFF2A8", "#FFD6DE", "#D9F7D6", "#D9E8FF", "#E8DDFF", "#FFFFFF"];

function inlineMarkdown(text: string) {
  return text.split(/(\*\*.*?\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function MarkdownPreview({ content, fontSize }: { content: string; fontSize: number }) {
  if (!content.trim()) return <p className="text-slate-500/70">Escribe algo para ver la vista previa.</p>;
  return (
    <div className="space-y-1.5 whitespace-pre-wrap text-slate-800" style={{ fontSize }}>
      {content.split("\n").map((line, index) => {
        if (line.startsWith("## ")) return <h2 key={index} className="text-[1.15em] font-bold">{inlineMarkdown(line.slice(3))}</h2>;
        if (line.startsWith("# ")) return <h1 key={index} className="text-[1.3em] font-bold">{inlineMarkdown(line.slice(2))}</h1>;
        if (line.startsWith("- ")) return <div key={index} className="flex gap-2"><span>•</span><span>{inlineMarkdown(line.slice(2))}</span></div>;
        return <p key={index} className="min-h-[1em]">{inlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

function toDateTimeLocal(timestamp: number | null) {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function FloatingNote({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [selection, setSelection] = useState("");
  const [taskCreated, setTaskCreated] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const lastSaved = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void flowdeskApi
      .note(noteId)
      .then((value) => {
        setNote(value);
        lastSaved.current = JSON.stringify(value);
        // Una nota recién creada (⌥N) queda lista para escribir sin hacer clic.
        if (!value.title && !value.content) window.setTimeout(() => textareaRef.current?.focus(), 30);
      })
      .catch((reason) => setError(String(reason)));
  }, [noteId]);

  useEffect(() => {
    if (!settingsOpen) return;
    void flowdeskApi.projects(false, true).then(setProjects).catch(() => setProjects([]));
  }, [settingsOpen]);

  const save = useCallback(async (value: Note) => {
    const signature = JSON.stringify(value);
    if (signature === lastSaved.current) return;
    setSaveState("saving");
    try {
      await flowdeskApi.updateNote({
        id: value.id,
        title: value.title,
        content: value.content,
        color: value.color,
        opacity: value.window.opacity,
        fontSize: value.window.fontSize,
        reminderAt: value.reminderAt,
        projectId: value.projectId,
      });
      lastSaved.current = signature;
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch (reason) {
      setSaveState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    if (!note || JSON.stringify(note) === lastSaved.current) return;
    const timeout = window.setTimeout(() => void save(note), 650);
    return () => window.clearTimeout(timeout);
  }, [note, save]);

  const selectedText = useMemo(() => selection.trim().replace(/\s+/g, " "), [selection]);

  function update(patch: Partial<Note>) {
    setNote((value) => (value ? { ...value, ...patch } : value));
  }

  function updateWindow(patch: Partial<Note["window"]>) {
    setNote((value) => (value ? { ...value, window: { ...value.window, ...patch } } : value));
  }

  async function close() {
    if (note) await save(note);
    await flowdeskApi.hideNote(noteId);
  }

  async function toggleCollapsed() {
    if (!note) return;
    await save(note);
    const updated = await flowdeskApi.setNoteCollapsed(note.id, !note.window.isCollapsed);
    setNote(updated);
    lastSaved.current = JSON.stringify(updated);
  }

  async function changeMode(displayMode: Note["window"]["displayMode"]) {
    if (!note) return;
    const updated = await flowdeskApi.setNoteDisplayMode(note.id, displayMode);
    setNote(updated);
    lastSaved.current = JSON.stringify(updated);
  }

  async function convertSelection() {
    if (!selectedText) return;
    try {
      await flowdeskApi.createTask({
        title: selectedText.slice(0, 240),
        noteId: note?.id ?? null,
        projectId: note?.projectId ?? null,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    setTaskCreated(true);
    window.setTimeout(() => setTaskCreated(false), 1400);
  }

  async function archive() {
    if (!note) return;
    await save(note);
    await flowdeskApi.archiveNote(note.id, true);
  }

  async function remove() {
    if (!note || !window.confirm("¿Eliminar esta nota definitivamente?")) return;
    await flowdeskApi.deleteNote(note.id);
  }

  if (error && !note) {
    return <div className="grid h-screen place-items-center bg-red-50 p-5 text-center text-xs text-red-600">{error}</div>;
  }
  if (!note) return <div className="grid h-screen place-items-center bg-[#FFF2A8] text-xs text-slate-500">Cargando nota…</div>;

  return (
    <div className="floating-note flex h-screen flex-col overflow-hidden text-slate-800" style={{ backgroundColor: note.color, opacity: note.window.opacity }}>
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
          className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold outline-none placeholder:text-slate-500/65"
        />
        <span className="min-w-10 text-right text-[8px] text-slate-500/80">
          {saveState === "saving" ? "Guardando…" : saveState === "saved" ? "Guardado" : saveState === "error" ? "Error" : ""}
        </span>
        <button type="button" onClick={() => setSettingsOpen((value) => !value)} aria-label="Opciones de nota" className="note-header-button"><Settings2 /></button>
        <button type="button" onClick={() => void toggleCollapsed()} aria-label={note.window.isCollapsed ? "Expandir" : "Minimizar"} className="note-header-button">
          {note.window.isCollapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
        <button type="button" onClick={() => void close()} aria-label="Cerrar nota" className="note-header-button hover:bg-red-500/15"><X /></button>
      </header>

      {!note.window.isCollapsed && (
        <>
          {settingsOpen && (
            <div className="border-b border-black/8 bg-white/25 px-3 py-2.5 backdrop-blur-md">
              <div className="flex items-center gap-2">
                {colors.map((color) => (
                  <button key={color} type="button" onClick={() => update({ color })} aria-label={`Color ${color}`} className={`size-5 rounded-full border shadow-sm ${note.color === color ? "ring-2 ring-slate-700/50 ring-offset-1 ring-offset-transparent" : "border-black/10"}`} style={{ backgroundColor: color }} />
                ))}
                <select value={note.window.displayMode} onChange={(event) => void changeMode(event.target.value as Note["window"]["displayMode"])} className="ml-auto rounded-md border border-black/10 bg-white/45 px-1.5 py-1 text-[9px] outline-none">
                  <option value="normal">Normal</option>
                  <option value="always_on_top">Siempre encima</option>
                  <option value="desktop">Debajo de ventanas</option>
                </select>
              </div>
              <div className="mt-2 grid grid-cols-[1fr_1fr] gap-3">
                <label className="text-[8px] text-slate-600">Transparencia
                  <input type="range" min="35" max="100" value={Math.round(note.window.opacity * 100)} onChange={(event) => updateWindow({ opacity: Number(event.target.value) / 100 })} className="block w-full accent-slate-700" />
                </label>
                <label className="text-[8px] text-slate-600">Texto: {note.window.fontSize}px
                  <input type="range" min="10" max="32" value={note.window.fontSize} onChange={(event) => updateWindow({ fontSize: Number(event.target.value) })} className="block w-full accent-slate-700" />
                </label>
              </div>
              <label className="mt-2 block text-[8px] text-slate-600">Proyecto
                <select value={note.projectId ?? ""} onChange={(event) => update({ projectId: event.target.value || null })} className="mt-0.5 block w-full rounded-md border border-black/10 bg-white/40 px-1.5 py-1 text-[9px] outline-none">
                  <option value="">Sin proyecto</option>
                  {note.projectId && !projects.some((project) => project.id === note.projectId) && <option value={note.projectId}>Proyecto actual</option>}
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <div className="mt-2 flex items-end gap-2">
                <label className="min-w-0 flex-1 text-[8px] text-slate-600">Recordatorio
                  <input type="datetime-local" value={toDateTimeLocal(note.reminderAt)} onChange={(event) => update({ reminderAt: event.target.value ? Math.floor(new Date(event.target.value).getTime() / 1000) : null })} className="mt-0.5 block w-full rounded-md border border-black/10 bg-white/40 px-1.5 py-1 text-[9px] outline-none" />
                </label>
                <button type="button" onClick={() => void archive()} className="note-tool-button" title="Archivar"><Archive /></button>
                <button type="button" onClick={() => void remove()} className="note-tool-button hover:text-red-600" title="Eliminar"><Trash2 /></button>
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-1 border-b border-black/8 px-2 py-1.5">
              <button type="button" onClick={() => setPreview(false)} className={`note-mode-button ${!preview ? "bg-black/8" : ""}`}><FileText /> Editar</button>
              <button type="button" onClick={() => setPreview(true)} className={`note-mode-button ${preview ? "bg-black/8" : ""}`}><Eye /> Vista previa</button>
              <button type="button" disabled={!selectedText} onClick={() => void convertSelection()} className="note-mode-button ml-auto disabled:opacity-35">
                {taskCreated ? <Check /> : <ListTodo />} {taskCreated ? "Tarea creada" : "Convertir selección"}
              </button>
            </div>
            {preview ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4"><MarkdownPreview content={note.content} fontSize={note.window.fontSize} /></div>
            ) : (
              <textarea
                ref={textareaRef}
                value={note.content}
                onChange={(event) => update({ content: event.target.value })}
                onSelect={(event) => {
                  const target = event.currentTarget;
                  setSelection(target.value.slice(target.selectionStart, target.selectionEnd));
                }}
                placeholder="Escribe una idea…\n\nMarkdown básico: # título, **negrita**, - lista"
                spellCheck
                className="min-h-0 flex-1 resize-none bg-transparent p-4 leading-relaxed outline-none placeholder:text-slate-500/60"
                style={{ fontSize: note.window.fontSize }}
              />
            )}
          </div>
        </>
      )}
      {error && note && <div className="absolute inset-x-2 bottom-2 rounded-lg bg-red-600 px-2 py-1.5 text-[9px] text-white shadow-lg">{error}</div>}
    </div>
  );
}
