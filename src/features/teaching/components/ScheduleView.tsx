import { FormEvent, useMemo, useState } from "react";
import { AlertTriangle, CalendarCheck2, CalendarClock, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { AnimatePresence } from "../lib/motion";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { formatTime } from "../lib/dates";
import { alignsWithBlocks, coversBlock, expandBlocks, kindLabels, kindLetters, shortCourseName, type Block } from "../lib/timeBlocks";
import { useResource } from "../lib/useResource";
import type { CourseSummary, ScheduleKind, ScheduleSlot } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const HOUR_HEIGHT = 40;
const VIEW_KEY = "flowdesk:teaching-schedule-view";
const reminderOptions = [
  { value: "", label: "Sin aviso" },
  { value: "0", label: "A la hora de inicio" },
  { value: "5", label: "5 min antes" },
  { value: "10", label: "10 min antes" },
  { value: "15", label: "15 min antes" },
  { value: "30", label: "30 min antes" },
  { value: "60", label: "1 hora antes" },
];

type ViewMode = "blocks" | "hours";

function minutes(time: string) {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

function isoDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shortDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

/** «7:30 – 8:15»: las horas de los bloques sin a. m. ni p. m., como en el horario oficial. */
function blockLabel(block: Block) {
  const short = (time: string) => {
    const [hours, mins] = time.split(":").map(Number);
    return `${hours % 12 || 12}:${String(mins).padStart(2, "0")}`;
  };
  return `${short(block.start)} – ${short(block.end)}`;
}

function storedView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "hours" ? "hours" : "blocks";
  } catch {
    return "blocks";
  }
}

type Placed = ScheduleSlot & { column: number; columns: number };

/** Reparte en columnas las clases del mismo día que se solapan. */
function placeDay(slots: ScheduleSlot[]): Placed[] {
  const sorted = [...slots].sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...group.map((item) => item.column + 1));
    group.forEach((item) => (item.columns = columns));
    group = [];
  };
  for (const slot of sorted) {
    if (minutes(slot.startTime) >= groupEnd) close();
    const used = new Set(group.filter((other) => minutes(other.endTime) > minutes(slot.startTime)).map((other) => other.column));
    let column = 0;
    while (used.has(column)) column += 1;
    const item = { ...slot, column, columns: 1 };
    group.push(item);
    placed.push(item);
    groupEnd = Math.max(groupEnd, minutes(slot.endTime));
  }
  close();
  return placed;
}

type Props = { courseId: number; courses: CourseSummary[] };

export function ScheduleView({ courseId, courses }: Props) {
  const { run, notify } = useAppActions();
  const { data, loading, reload } = useResource(() => api.schedule(), []);
  const { data: periods } = useResource(() => api.periods(), []);
  const { data: timeBlocks } = useResource(() => api.timeBlocks(), []);
  const [editing, setEditing] = useState<ScheduleSlot | "new" | null>(null);
  const [view, setView] = useState<ViewMode>(storedView);
  const slots = useMemo(() => data ?? [], [data]);
  const blocks = useMemo(() => (timeBlocks ? expandBlocks(timeBlocks) : []), [timeBlocks]);
  const activeCourses = courses.filter((course) => !course.isArchived);
  // Número de cada materia en el horario, como en el horario oficial (1, 2…).
  const courseNumber = new Map(activeCourses.map((course, index) => [course.id, index + 1]));

  // Lunes a viernes siempre; el fin de semana solo si hay clases.
  const days = [1, 2, 3, 4, 5, 6, 7].filter((day) => day <= 5 || slots.some((slot) => slot.weekday === day));

  function changeView(next: ViewMode) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Sin almacenamiento, la vista vuelve a «Bloques» la próxima vez.
    }
  }

  async function generate() {
    await run(async () => {
      const result = await api.generateSessions(courseId);
      notify(
        result.created || result.updated
          ? `Asistencia: ${result.created} sesiones nuevas y ${result.updated} con su hora.`
          : "Todas las clases del horario ya tienen su sesión de asistencia.",
      );
    });
  }

  async function remove(slot: ScheduleSlot) {
    if (!confirm(`¿Quitar la clase del ${WEEKDAYS[slot.weekday - 1].toLowerCase()} de ${slot.courseTitle}? También sale del calendario.`)) return;
    await run(async () => {
      await api.deleteScheduleSlot(slot.id);
      await reload();
    }, "Clase quitada del horario.");
  }

  return (
    <div className="view-stack">
      <section className="panel schedule-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">MI SEMANA</span>
            <h3>Horario de clases</h3>
          </div>
          <div className="toolbar-actions">
            <div className="segmented" role="radiogroup" aria-label="Vista del horario">
              <button role="radio" aria-checked={view === "blocks"} className={view === "blocks" ? "active" : ""} onClick={() => changeView("blocks")}>
                Bloques
              </button>
              <button role="radio" aria-checked={view === "hours"} className={view === "hours" ? "active" : ""} onClick={() => changeView("hours")}>
                Horas
              </button>
            </div>
            <button className="secondary-button" onClick={() => void generate()} disabled={!slots.some((slot) => slot.courseId === courseId)} title="Crea las sesiones de asistencia de esta materia a partir de su horario">
              <CalendarCheck2 size={16} />
              Crear sesiones de asistencia
            </button>
            <button className="primary-button" onClick={() => setEditing("new")}>
              <Plus size={16} />
              Añadir clase
            </button>
          </div>
        </div>
        <div className="schedule-body">
          <p className="schedule-hint">
            Cada clase aparece en el calendario de FlowDesk cada semana entre sus fechas, con aviso, y junto al icono de la barra de menús antes de empezar.
          </p>
          {view === "blocks" ? (
            <BlockTable blocks={blocks} days={days} slots={slots} courseId={courseId} courseNumber={courseNumber} onOpen={setEditing} />
          ) : (
            <HourGrid days={days} slots={slots} courseId={courseId} onOpen={setEditing} />
          )}
          {!slots.length && !loading && (
            <div className="feature-empty">
              <CalendarClock />
              <h3>Tu horario está vacío</h3>
              <p>Añade tus clases una vez y aparecerán cada semana en el calendario.</p>
            </div>
          )}
        </div>
      </section>

      {slots.length > 0 && (
        <section className="panel table-panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Materia</th>
                  <th>Día</th>
                  <th>Horario</th>
                  <th>Tipo</th>
                  <th>Aula</th>
                  <th>Vigencia</th>
                  <th>Calendario</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr key={slot.id}>
                    <td>
                      <div className="student-cell">
                        <span className="course-dot" style={{ backgroundColor: slot.color }} />
                        <div>
                          <strong>{slot.courseTitle}</strong>
                          <small>{slot.groupName || "Sin grupo"}</small>
                        </div>
                      </div>
                    </td>
                    <td>{WEEKDAYS[slot.weekday - 1]}</td>
                    <td>
                      {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                    </td>
                    <td>{kindLabels[slot.kind]}</td>
                    <td>{slot.room || <span className="muted-text">—</span>}</td>
                    <td>
                      {shortDate(slot.startsOn)} – {shortDate(slot.endsOn)}
                    </td>
                    <td>
                      {slot.inCalendar ? (
                        <span className="status-badge active">
                          <i />
                          En el calendario
                        </span>
                      ) : (
                        <span className="status-badge" title="Fuera de sus fechas, o se borró desde el calendario. Guárdala de nuevo para recuperarla.">
                          <AlertTriangle size={12} />
                          No aparece
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button title="Editar" onClick={() => setEditing(slot)}>
                          <Pencil size={14} />
                        </button>
                        <button className="danger" title="Quitar" onClick={() => void remove(slot)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AnimatePresence>
        {editing && timeBlocks && (
          <SlotModal
            slot={editing === "new" ? null : editing}
            courseId={courseId}
            courses={activeCourses}
            slots={slots}
            blocks={blocks}
            periods={periods ?? []}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              await reload();
              setEditing(null);
            }}
          />
        )}
      </AnimatePresence>
      {loading && !data && <LoadingPill />}
    </div>
  );
}

type TableProps = {
  blocks: Block[];
  days: number[];
  slots: ScheduleSlot[];
  courseId: number;
  courseNumber: Map<number, number>;
  onOpen: (slot: ScheduleSlot) => void;
};

/** El horario como la hoja oficial: un bloque por fila y un día por columna. */
function BlockTable({ blocks, days, slots, courseId, courseNumber, onOpen }: TableProps) {
  return (
    <div className="block-table-scroll">
      <table className="block-table">
        <thead>
          <tr>
            <th className="block-time">Bloque</th>
            {days.map((day) => (
              <th key={day}>{WEEKDAYS[day - 1]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <tr key={block.start}>
              <th className="block-time">{blockLabel(block)}</th>
              {days.map((day) => {
                const here = slots.filter((slot) => slot.weekday === day && coversBlock(block, slot.startTime, slot.endTime));
                return (
                  <td key={day}>
                    {here.map((slot) => (
                      <button
                        key={slot.id}
                        className={`block-chip ${slot.courseId === courseId ? "current" : ""}`}
                        style={{ ["--slot" as string]: slot.color }}
                        onClick={() => onOpen(slot)}
                        title={`${slot.courseTitle} · ${kindLabels[slot.kind]} · ${formatTime(slot.startTime)} – ${formatTime(slot.endTime)}${slot.room ? ` · ${slot.room}` : ""}`}
                      >
                        <b>{courseNumber.get(slot.courseId) ?? "·"}</b>
                        <span>{shortCourseName(slot.courseTitle)}</span>
                        <small>{[kindLetters[slot.kind] && `(${kindLetters[slot.kind]})`, slot.room && `(${slot.room})`].filter(Boolean).join("")}</small>
                      </button>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type GridProps = { days: number[]; slots: ScheduleSlot[]; courseId: number; onOpen: (slot: ScheduleSlot) => void };

/** La semana a escala de horas, con la duración real de cada clase. */
function HourGrid({ days, slots, courseId, onOpen }: GridProps) {
  // Desde una hora antes de la primera clase hasta el final de la última (de 7:00 a 19:00 sin clases).
  const firstHour = slots.length ? Math.max(0, Math.min(...slots.map((slot) => Math.floor(minutes(slot.startTime) / 60))) - 1) : 7;
  const lastHour = slots.length ? Math.min(24, Math.max(...slots.map((slot) => Math.ceil(minutes(slot.endTime) / 60)))) : 19;
  const hours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index);
  return (
    <div className="timetable" style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }}>
      <div />
      {days.map((day) => (
        <div key={day} className="timetable-day">{WEEKDAYS[day - 1]}</div>
      ))}
      <div className="timetable-hours" style={{ height: hours.length * HOUR_HEIGHT }}>
        {hours.map((hour, index) => (
          <span key={hour} style={{ top: index * HOUR_HEIGHT }}>{`${String(hour).padStart(2, "0")}:00`}</span>
        ))}
      </div>
      {days.map((day) => (
        <div key={day} className="timetable-column" style={{ height: hours.length * HOUR_HEIGHT, backgroundSize: `100% ${HOUR_HEIGHT}px` }}>
          {placeDay(slots.filter((slot) => slot.weekday === day)).map((slot) => {
            const top = ((minutes(slot.startTime) - firstHour * 60) / 60) * HOUR_HEIGHT;
            const height = Math.max(((minutes(slot.endTime) - minutes(slot.startTime)) / 60) * HOUR_HEIGHT - 2, 18);
            return (
              <button
                key={slot.id}
                className={`timetable-slot ${slot.courseId === courseId ? "current" : ""}`}
                style={{
                  top,
                  height,
                  left: `${(slot.column / slot.columns) * 100}%`,
                  width: `${100 / slot.columns}%`,
                  ["--slot" as string]: slot.color,
                }}
                onClick={() => onOpen(slot)}
                title={`${slot.courseTitle} · ${kindLabels[slot.kind]} · ${formatTime(slot.startTime)} – ${formatTime(slot.endTime)}${slot.room ? ` · ${slot.room}` : ""}`}
              >
                <strong>{slot.courseTitle}</strong>
                <small>
                  {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                  {slot.kind !== "class" && ` · ${kindLabels[slot.kind]}`}
                </small>
                {slot.room && height > 44 && (
                  <small>
                    <MapPin size={10} /> {slot.room}
                  </small>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type SlotModalProps = {
  slot: ScheduleSlot | null;
  courseId: number;
  courses: CourseSummary[];
  slots: ScheduleSlot[];
  blocks: Block[];
  periods: { id: number; startDate: string; endDate: string; isActive: boolean }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
};

function SlotModal({ slot, courseId, courses, slots, blocks, periods, onClose, onSaved }: SlotModalProps) {
  const { run } = useAppActions();
  // Valores por defecto: los de otra clase de la materia, las fechas del periodo activo o cuatro meses.
  const sibling = slots.find((item) => item.courseId === courseId);
  const activePeriod = periods.find((period) => period.isActive);
  const today = new Date();
  const later = new Date(today);
  later.setMonth(later.getMonth() + 4);
  const startsOn = slot?.startsOn ?? sibling?.startsOn ?? activePeriod?.startDate ?? isoDate(today);
  const endsOn = slot?.endsOn ?? sibling?.endsOn ?? activePeriod?.endDate ?? isoDate(later);
  const initialStart = (slot ?? sibling)?.startTime.slice(0, 5) ?? blocks[0]?.start ?? "08:00";
  const initialEnd = (slot ?? sibling)?.endTime.slice(0, 5) ?? blocks[0]?.end ?? "08:45";
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  // Por bloques salvo que la clase guardada no coincida con ellos.
  const [byBlocks, setByBlocks] = useState(blocks.length > 0 && alignsWithBlocks(blocks, initialStart, initialEnd));

  function chooseStart(value: string) {
    setStartTime(value);
    // El fin se mueve con el inicio si quedaría antes de él.
    if (minutes(endTime) <= minutes(value)) setEndTime(blocks.find((block) => block.start === value)?.end ?? endTime);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reminder = String(form.get("reminderMinutes") ?? "");
    const saved = await run(
      () =>
        api.saveScheduleSlot({
          id: slot?.id ?? null,
          courseId: Number(form.get("courseId")),
          kind: String(form.get("kind")) as ScheduleKind,
          weekday: Number(form.get("weekday")),
          startTime,
          endTime,
          room: String(form.get("room") ?? ""),
          startsOn: String(form.get("startsOn") ?? ""),
          endsOn: String(form.get("endsOn") ?? ""),
          reminderMinutes: reminder === "" ? null : Number(reminder),
        }),
      slot ? "Clase actualizada en el horario y el calendario." : "Clase añadida al horario y al calendario.",
    );
    if (saved) await onSaved();
  }

  return (
    <Modal eyebrow="HORARIO" title={slot ? "Editar clase" : "Añadir clase"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          <span>Materia</span>
          <select name="courseId" defaultValue={slot?.courseId ?? courseId}>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
                {course.groupName ? ` · ${course.groupName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Día</span>
          <select name="weekday" defaultValue={slot?.weekday ?? 1}>
            {WEEKDAYS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Tipo</span>
          <select name="kind" defaultValue={slot?.kind ?? "theory"}>
            {(Object.keys(kindLabels) as ScheduleKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {kindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        {byBlocks ? (
          <>
            <label>
              <span>Desde el bloque</span>
              <select aria-label="Bloque inicial" value={startTime} onChange={(event) => chooseStart(event.target.value)}>
                {blocks.map((block) => (
                  <option key={block.start} value={block.start}>
                    {blockLabel(block)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Hasta el bloque</span>
              <select aria-label="Bloque final" value={endTime} onChange={(event) => setEndTime(event.target.value)}>
                {blocks
                  .filter((block) => minutes(block.end) > minutes(startTime))
                  .map((block) => (
                    <option key={block.end} value={block.end}>
                      {blockLabel(block)}
                    </option>
                  ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              <span>Hora de inicio</span>
              <input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </label>
            <label>
              <span>Hora de fin</span>
              <input type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} />
            </label>
          </>
        )}
        {blocks.length > 0 && (
          <p className="span-2 muted-text block-switch">
            {formatTime(startTime)} – {formatTime(endTime)}
            {" · "}
            <button type="button" onClick={() => setByBlocks((value) => !value)}>
              {byBlocks ? "Usar otra hora" : "Elegir por bloques"}
            </button>
          </p>
        )}
        <label>
          <span>Aula</span>
          <input name="room" defaultValue={slot?.room ?? sibling?.room ?? ""} placeholder="Ej. 2D3" />
        </label>
        <label>
          <span>Aviso antes de clase</span>
          <select name="reminderMinutes" defaultValue={slot ? (slot.reminderMinutes == null ? "" : String(slot.reminderMinutes)) : "10"}>
            {reminderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Desde</span>
          <input name="startsOn" type="date" required defaultValue={startsOn} />
        </label>
        <label>
          <span>Hasta</span>
          <input name="endsOn" type="date" required defaultValue={endsOn} />
        </label>
        <div className="form-actions span-2">
          <button className="primary-button">{slot ? "Guardar cambios" : "Añadir al horario"}</button>
        </div>
      </form>
    </Modal>
  );
}

