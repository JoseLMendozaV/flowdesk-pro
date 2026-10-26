import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { useEscape } from "../../hooks/useEscape";
import { flowdeskApi } from "../../services/flowdeskApi";
import { dateInputValue, errorMessage, formatDate, timeInputValue } from "../../services/format";
import type { CalendarEvent, EventInput, EventScope } from "../../types/calendar";
import type { RecurrenceRule } from "../../types/recurrence";
import { useProjects } from "../projects/useProjects";
import { RecurrenceField } from "../recurrence/RecurrenceField";
import { followStart } from "../recurrence/recurrenceRules";
import { useUndoStore } from "../trash/undoStore";
import { addDays, fromUnix, unix } from "./calendarDates";
import { ScopeChoices } from "./ScopeChoices";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--input)] px-3 py-2 text-xs outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]";
const labelClass = "mb-1 block text-[10px] font-medium text-[var(--muted)]";

const timedReminders = [
  { value: "", label: "Sin aviso" },
  { value: "0", label: "A la hora de inicio" },
  { value: "5", label: "5 min antes" },
  { value: "10", label: "10 min antes" },
  { value: "15", label: "15 min antes" },
  { value: "30", label: "30 min antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 día antes" },
];

// Los avisos de eventos de todo el día se cuentan desde las 9:00 del primer día.
const allDayReminders = [
  { value: "", label: "Sin aviso" },
  { value: "0", label: "El mismo día a las 9:00" },
  { value: "1440", label: "El día anterior a las 9:00" },
  { value: "10080", label: "Una semana antes a las 9:00" },
];

export type EventDraft = { startsAt: number; endsAt: number; isAllDay: boolean };

/** Cambio pendiente de decidir a qué repeticiones se aplica. */
type PendingScope = { action: "save"; input: EventInput; ruleChanged: boolean } | { action: "delete" };

function sameRule(left: RecurrenceRule | null, right: RecurrenceRule | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseDate(value: string, time = "00:00") {
  const [year, month, day] = value.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

type EventDialogProps = {
  event: CalendarEvent | null;
  draft: EventDraft;
  onClose: () => void;
};

export function EventDialog({ event, draft, onClose }: EventDialogProps) {
  const initial = event ?? draft;
  // En todo el día la fecha final visible es la del último día (el fin guardado es exclusivo).
  const initialEnd = initial.isAllDay ? addDays(fromUnix(initial.endsAt), -1) : fromUnix(initial.endsAt);
  const [title, setTitle] = useState(event?.title ?? "");
  const [isAllDay, setIsAllDay] = useState(initial.isAllDay);
  const [startDate, setStartDate] = useState(dateInputValue(initial.startsAt));
  const [startTime, setStartTime] = useState(timeInputValue(initial.startsAt, true) || "09:00");
  const [endDate, setEndDate] = useState(dateInputValue(unix(initialEnd)));
  const [endTime, setEndTime] = useState(timeInputValue(unix(initialEnd), true) || "10:00");
  const [projectId, setProjectId] = useState(event?.projectId ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [reminder, setReminder] = useState(event?.reminderMinutes == null ? "" : String(event.reminderMinutes));
  const [description, setDescription] = useState(event?.description ?? "");
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(event?.recurrence ?? null);
  const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const { projects } = useProjects();
  const offerUndo = useUndoStore((state) => state.offer);
  // Editar una repetición de una serie pregunta a cuáles se aplica el cambio.
  const repeating = Boolean(event?.recurrence);
  const isFirstOccurrence = !event || event.startsAt === event.seriesStartsAt;

  useEffect(() => {
    window.setTimeout(() => titleRef.current?.focus(), 30);
  }, []);
  useEscape(() => (pendingScope ? setPendingScope(null) : onClose()));
  useEffect(() => {
    if (pendingScope) scopeRef.current?.scrollIntoView({ block: "nearest" });
  }, [pendingScope]);

  const reminderOptions = isAllDay ? allDayReminders : timedReminders;
  const reminderValue = reminderOptions.some((option) => option.value === reminder) ? reminder : "";

  function changeStartDate(value: string) {
    // Mantiene la duración al mover el inicio.
    if (value && startDate && endDate) {
      const shift = parseDate(value).getTime() - parseDate(startDate).getTime();
      setEndDate(dateInputValue(unix(new Date(parseDate(endDate).getTime() + shift))));
      setRecurrence((rule) => followStart(rule, unix(parseDate(startDate)), unix(parseDate(value))));
    }
    setStartDate(value);
  }

  const startPreview = startDate ? unix(isAllDay ? parseDate(startDate) : parseDate(startDate, startTime || "00:00")) : null;

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!title.trim() || !startDate || !endDate || saving) return;
    const startsAt = isAllDay ? parseDate(startDate) : parseDate(startDate, startTime);
    const endsAt = isAllDay ? addDays(parseDate(endDate), 1) : parseDate(endDate, endTime);
    const input: EventInput = {
      title,
      description,
      projectId: projectId || null,
      startsAt: unix(startsAt),
      endsAt: unix(endsAt),
      isAllDay,
      location: location.trim() || null,
      reminderMinutes: reminderValue === "" ? null : Number(reminderValue),
      recurrence,
    };
    if (event && repeating) {
      setPendingScope({ action: "save", input, ruleChanged: !sameRule(recurrence, event.recurrence) });
      return;
    }
    await save(input);
  }

  async function save(input: EventInput, scope?: EventScope) {
    setSaving(true);
    setError(null);
    try {
      if (event) await flowdeskApi.updateEvent(event.id, input, scope, repeating ? event.startsAt : undefined);
      else await flowdeskApi.createEvent(input);
      onClose();
    } catch (reason) {
      setPendingScope(null);
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function remove(scope?: EventScope) {
    if (!event) return;
    try {
      const itemId = await flowdeskApi.deleteEvent(event.id, scope, repeating ? event.startsAt : undefined);
      const message =
        scope === "this"
          ? `Repetición del ${formatDate(event.startsAt)} eliminada`
          : scope === "following" && !isFirstOccurrence
            ? `Repeticiones de “${event.title}” eliminadas desde el ${formatDate(event.startsAt)}`
            : `Evento “${event.title}” movido a la papelera`;
      offerUndo(message, itemId);
      onClose();
    } catch (reason) {
      setPendingScope(null);
      setError(errorMessage(reason));
    }
  }

  function applyScope(scope: EventScope) {
    if (!pendingScope) return;
    if (pendingScope.action === "delete") void remove(scope);
    else void save(pendingScope.input, scope);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5 backdrop-blur-[2px]" role="presentation" onMouseDown={(mouseEvent) => mouseEvent.target === mouseEvent.currentTarget && onClose()}>
      <form onSubmit={(formEvent) => void submit(formEvent)} role="dialog" aria-modal="true" aria-labelledby="event-dialog-title" className="max-h-[calc(100vh-40px)] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 id="event-dialog-title" className="text-sm font-semibold">{event ? "Editar evento" : "Nuevo evento"}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]">
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-3">
          <input ref={titleRef} value={title} onChange={(changeEvent) => setTitle(changeEvent.target.value)} maxLength={200} placeholder="Título del evento" aria-label="Título" className={fieldClass} />
          <label className="flex cursor-pointer items-center gap-2 text-[11px]">
            <input type="checkbox" checked={isAllDay} onChange={(changeEvent) => setIsAllDay(changeEvent.target.checked)} className="accent-[var(--accent)]" />
            Todo el día
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelClass}>Inicio</span>
              <input type="date" required value={startDate} onChange={(changeEvent) => changeStartDate(changeEvent.target.value)} className={fieldClass} />
            </label>
            {!isAllDay && (
              <label className="block">
                <span className={labelClass}>Hora de inicio</span>
                <input type="time" required value={startTime} onChange={(changeEvent) => setStartTime(changeEvent.target.value)} className={fieldClass} />
              </label>
            )}
            <label className="block">
              <span className={labelClass}>{isAllDay ? "Último día" : "Fin"}</span>
              <input type="date" required value={endDate} min={startDate || undefined} onChange={(changeEvent) => setEndDate(changeEvent.target.value)} className={fieldClass} />
            </label>
            {!isAllDay && (
              <label className="block">
                <span className={labelClass}>Hora de fin</span>
                <input type="time" required value={endTime} onChange={(changeEvent) => setEndTime(changeEvent.target.value)} className={fieldClass} />
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelClass}>Aviso</span>
              <select value={reminderValue} onChange={(changeEvent) => setReminder(changeEvent.target.value)} className={fieldClass}>
                {reminderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Proyecto</span>
              <select value={projectId} onChange={(changeEvent) => setProjectId(changeEvent.target.value)} className={fieldClass}>
                <option value="">Sin proyecto</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                {event?.projectId && !projects.some((project) => project.id === event.projectId) && <option value={event.projectId}>{event.projectName ?? "Proyecto archivado"}</option>}
              </select>
            </label>
          </div>
          <RecurrenceField
            value={recurrence}
            onChange={setRecurrence}
            start={startPreview}
            kind="event"
            fieldClass={fieldClass}
          />
          <input value={location} onChange={(changeEvent) => setLocation(changeEvent.target.value)} maxLength={200} placeholder="Ubicación (opcional)" aria-label="Ubicación" className={fieldClass} />
          <textarea value={description} onChange={(changeEvent) => setDescription(changeEvent.target.value)} maxLength={4000} rows={3} placeholder="Notas (opcional)" aria-label="Notas" className={`${fieldClass} resize-none leading-5`} />
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</p>}

        {pendingScope && (
          <div ref={scopeRef} className="mt-4">
            <ScopeChoices
              question={pendingScope.action === "delete" ? "Este evento se repite. ¿Qué quieres eliminar?" : "Este evento se repite. ¿A cuáles aplicas el cambio?"}
              allowThis={!(pendingScope.action === "save" && pendingScope.ruleChanged)}
              allowFollowing={!isFirstOccurrence}
              onChoose={applyScope}
              onCancel={() => setPendingScope(null)}
            />
          </div>
        )}

        <footer className="mt-5 flex items-center gap-2">
          {event && (
            <button
              type="button"
              onClick={() => (repeating ? setPendingScope({ action: "delete" }) : void remove())}
              aria-label="Eliminar evento"
              title="Eliminar evento (se puede deshacer)"
              className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-red-500/10 hover:text-red-500"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">Cancelar</button>
          <button type="submit" disabled={!title.trim() || saving || Boolean(pendingScope)} className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50">
            {saving ? "Guardando…" : event ? "Guardar cambios" : "Crear evento"}
          </button>
        </footer>
      </form>
    </div>
  );
}
