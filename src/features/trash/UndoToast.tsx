import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useUndoStore } from "./undoStore";

const VISIBLE_MS = 8000;

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

/** Aviso tras borrar: Deshacer (o ⌘Z) restaura desde la papelera. */
export function UndoToast() {
  const entry = useUndoStore((state) => state.entry);
  const error = useUndoStore((state) => state.error);
  const undo = useUndoStore((state) => state.undo);
  const dismiss = useUndoStore((state) => state.dismiss);
  const selectSection = useAppStore((state) => state.selectSection);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!entry || hovered || error) return;
    const timeout = window.setTimeout(dismiss, VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [dismiss, entry, error, hovered]);

  useEffect(() => {
    if (!entry) return;
    function handle(event: KeyboardEvent) {
      // En un campo de texto, ⌘Z deshace lo escrito, no el borrado.
      if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "z" && !isEditable(event.target)) {
        event.preventDefault();
        void undo();
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [entry, undo]);

  if (!entry) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] py-2 pl-3.5 pr-2 text-[11px] shadow-2xl"
      >
        <Trash2 className="size-3.5 flex-none text-[var(--muted)]" />
        <span className="min-w-0 flex-1 truncate">{error ?? entry.message}</span>
        <button type="button" onClick={() => void undo()} title="Deshacer (⌘Z)" className="rounded-lg px-2.5 py-1 font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]">
          Deshacer
        </button>
        <button
          type="button"
          onClick={() => {
            dismiss();
            selectSection("trash");
          }}
          className="rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
        >
          Ver papelera
        </button>
        <button type="button" onClick={dismiss} aria-label="Cerrar aviso" className="grid size-6 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)]">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
