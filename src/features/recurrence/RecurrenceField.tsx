import { useState } from "react";
import { Repeat } from "lucide-react";
import { dateInputValue } from "../../services/format";
import type { RecurrenceFrequency, RecurrenceRule } from "../../types/recurrence";
import {
  WEEKDAY_INITIALS,
  WEEKDAY_NAMES,
  describeRecurrence,
  endOfDayUnix,
  isoWeekday,
  presetOf,
  ruleForPreset,
  unitLabel,
  type RecurrencePreset,
} from "./recurrenceRules";

const dayMonthFormatter = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long" });

type RecurrenceFieldProps = {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** Fecha de la tarea o inicio del evento: de ella salen el día de la semana y del mes. */
  start: number | null;
  kind: "task" | "event";
  fieldClass: string;
  /** Si se indica, el campo queda deshabilitado con esta explicación. */
  disabledReason?: string;
};

export function RecurrenceField({ value, onChange, start, kind, fieldClass, disabledReason }: RecurrenceFieldProps) {
  const preset = presetOf(value, start);
  const [customOpen, setCustomOpen] = useState(preset === "custom");
  const selected: RecurrencePreset = customOpen && value ? "custom" : preset;
  const startDate = start ? new Date(start * 1000) : null;

  function choose(next: RecurrencePreset) {
    setCustomOpen(next === "custom");
    onChange(ruleForPreset(next, start, value));
  }

  function patch(changes: Partial<RecurrenceRule>) {
    if (value) onChange({ ...value, ...changes });
  }

  function toggleWeekday(day: number) {
    if (!value) return;
    const current = value.weekdays.length ? value.weekdays : start ? [isoWeekday(start)] : [];
    const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort();
    // Al menos un día: quitar el último no deja la regla vacía.
    if (next.length) patch({ weekdays: next });
  }

  // Los controles del editor tienen su propio ancho.
  const inlineField = fieldClass.replace("w-full", "");
  const activeWeekdays = value?.weekdays.length ? value.weekdays : start ? [isoWeekday(start)] : [];

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-[10px] font-medium text-[var(--muted)]">
          <Repeat className="size-3" /> Repetir
        </span>
        <select
          value={selected}
          disabled={Boolean(disabledReason)}
          onChange={(event) => choose(event.target.value as RecurrencePreset)}
          title={disabledReason}
          className={`${fieldClass} disabled:opacity-50`}
        >
          <option value="none">No se repite</option>
          <option value="daily">Cada día</option>
          <option value="weekdays">Días laborables (lun–vie)</option>
          <option value="weekly">{startDate ? `Cada semana el ${WEEKDAY_NAMES[isoWeekday(start!) - 1]}` : "Cada semana"}</option>
          <option value="monthly">{startDate ? `Cada mes el día ${startDate.getDate()}` : "Cada mes"}</option>
          <option value="yearly">{startDate ? `Cada año el ${dayMonthFormatter.format(startDate)}` : "Cada año"}</option>
          <option value="custom">Personalizar…</option>
        </select>
      </label>
      {disabledReason && <p className="text-[10px] text-[var(--muted)]">{disabledReason}</p>}

      {value && selected === "custom" && (
        <div className="space-y-2.5 rounded-lg border border-[var(--line)] bg-[var(--inset)] p-2.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--muted)]">{value.fromCompletion ? "A los" : "Cada"}</span>
            <input
              type="number"
              min={1}
              max={99}
              value={value.interval}
              onChange={(event) => patch({ interval: Math.min(99, Math.max(1, Math.round(Number(event.target.value) || 1))) })}
              aria-label="Intervalo"
              className={`${inlineField} w-14 text-center`}
            />
            <select
              value={value.frequency}
              onChange={(event) => {
                const frequency = event.target.value as RecurrenceFrequency;
                patch({ frequency, weekdays: frequency === "weekly" && start ? [isoWeekday(start)] : [] });
              }}
              aria-label="Unidad"
              className={`${inlineField} w-auto`}
            >
              {(["daily", "weekly", "monthly", "yearly"] as const).map((frequency) => (
                <option key={frequency} value={frequency}>{unitLabel(frequency, value.interval)}</option>
              ))}
            </select>
          </div>

          {kind === "task" && (
            <div role="radiogroup" aria-label="Desde cuándo se cuenta" className="flex rounded-lg border border-[var(--line)] bg-[var(--surface)] p-0.5">
              {[
                { fromCompletion: false, label: "Según la fecha prevista" },
                { fromCompletion: true, label: "Desde que la completo" },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={value.fromCompletion === option.fromCompletion}
                  onClick={() => patch({ fromCompletion: option.fromCompletion })}
                  className={`flex-1 rounded-md px-2 py-1 text-[10px] ${value.fromCompletion === option.fromCompletion ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {value.frequency === "weekly" && !value.fromCompletion && (
            <div className="flex gap-1" role="group" aria-label="Días de la semana">
              {WEEKDAY_INITIALS.map((initial, index) => {
                const day = index + 1;
                const active = activeWeekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    aria-label={WEEKDAY_NAMES[index]}
                    onClick={() => toggleWeekday(day)}
                    className={`grid size-6 place-items-center rounded-full text-[10px] font-medium transition ${active ? "bg-[var(--accent)] text-white" : "border border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)]"}`}
                  >
                    {initial}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-[var(--muted)]">Termina</span>
            <select
              value={value.until === null ? "never" : "date"}
              onChange={(event) => {
                if (event.target.value === "never") patch({ until: null });
                else {
                  const base = start ? new Date(start * 1000) : new Date();
                  base.setMonth(base.getMonth() + 1);
                  patch({ until: endOfDayUnix(dateInputValue(Math.floor(base.getTime() / 1000))) });
                }
              }}
              aria-label="Cuándo termina"
              className={`${inlineField} w-auto`}
            >
              <option value="never">Nunca</option>
              <option value="date">El día…</option>
            </select>
            {value.until !== null && (
              <input
                type="date"
                value={dateInputValue(value.until)}
                min={start ? dateInputValue(start) : undefined}
                onChange={(event) => event.target.value && patch({ until: endOfDayUnix(event.target.value) })}
                aria-label="Fecha de fin"
                className={`${inlineField} w-auto`}
              />
            )}
          </div>
        </div>
      )}

      {value && selected === "custom" && <p className="text-[10px] text-[var(--accent)]">{describeRecurrence(value, start)}</p>}
    </div>
  );
}
