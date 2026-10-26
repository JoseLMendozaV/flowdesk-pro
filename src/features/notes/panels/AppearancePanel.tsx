import { Archive, Pin, Trash2 } from "lucide-react";
import type { Note } from "../../../types/dashboard";

export const NOTE_COLORS = ["#FFF2A8", "#FFD6DE", "#D9F7D6", "#D9E8FF", "#E8DDFF", "#FFFFFF"];

function toDateTimeLocal(timestamp: number | null) {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

type AppearancePanelProps = {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  onWindowChange: (patch: Partial<Note["window"]>) => void;
  onDisplayMode: (mode: Note["window"]["displayMode"]) => void;
  onPinned: (pinned: boolean) => void;
  onArchive: () => void;
  onDelete: () => void;
};

export function AppearancePanel({ note, onChange, onWindowChange, onDisplayMode, onPinned, onArchive, onDelete }: AppearancePanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {NOTE_COLORS.map((color) => (
          <button key={color} type="button" onClick={() => onChange({ color })} aria-label={`Color ${color}`} aria-pressed={note.color === color} className={`size-5 rounded-full border shadow-sm ${note.color === color ? "ring-2 ring-slate-700/50 ring-offset-1 ring-offset-transparent" : "border-black/10"}`} style={{ backgroundColor: color }} />
        ))}
        <select value={note.window.displayMode} onChange={(event) => onDisplayMode(event.target.value as Note["window"]["displayMode"])} aria-label="Nivel de la ventana" className="note-field ml-auto">
          <option value="normal">Normal</option>
          <option value="always_on_top">Siempre encima</option>
          <option value="desktop">Debajo de ventanas</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="note-label">Transparencia
          <input type="range" min="35" max="100" value={Math.round(note.window.opacity * 100)} onChange={(event) => onWindowChange({ opacity: Number(event.target.value) / 100 })} className="block w-full accent-slate-700" />
        </label>
        <label className="note-label">Texto: {note.window.fontSize}px
          <input type="range" min="10" max="32" value={note.window.fontSize} onChange={(event) => onWindowChange({ fontSize: Number(event.target.value) })} className="block w-full accent-slate-700" />
        </label>
      </div>
      <label className="note-label">Recordatorio
        <input type="datetime-local" value={toDateTimeLocal(note.reminderAt)} onChange={(event) => onChange({ reminderAt: event.target.value ? Math.floor(new Date(event.target.value).getTime() / 1000) : null })} className="note-field mt-0.5 block w-full" />
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-[0.72rem]">
        <input type="checkbox" checked={note.pinnedGlobal} onChange={(event) => onPinned(event.target.checked)} className="mt-0.5 accent-slate-700" />
        <span>
          <span className="flex items-center gap-1 font-medium"><Pin className="size-3" /> Fijar en todos los espacios</span>
          <span className="block text-[0.65rem] text-slate-600">Sigue visible aunque cambies de espacio de trabajo.</span>
        </span>
      </label>
      <div className="flex gap-2 border-t border-black/8 pt-2.5">
        <button type="button" onClick={onArchive} className="note-chip"><Archive className="size-3" /> Archivar</button>
        <button type="button" onClick={onDelete} className="note-chip hover:text-red-600"><Trash2 className="size-3" /> Eliminar</button>
      </div>
    </div>
  );
}
