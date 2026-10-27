import { FormEvent, useMemo, useState } from "react";
import { AnimatePresence } from "../lib/motion";
import { CalendarClock, Check, Cloud, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAppActions, useUnsavedChanges } from "../lib/app-context";
import { formatTime } from "../lib/dates";
import { useResource } from "../lib/useResource";
import type { AttendanceMatrix, AttendanceUpdate, SessionColumn } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";

type Status = AttendanceUpdate["status"];

export function AttendanceView({ courseId }: { courseId: number }) {
  const { run, notify } = useAppActions();
  const { data: matrix, loading, reload } = useResource(() => api.attendance(courseId), [courseId]);
  const [editingSession, setEditingSession] = useState<SessionColumn | "new" | null>(null);
  if (!matrix) return loading ? <LoadingPill /> : null;
  const session = editingSession === "new" ? null : editingSession;

  async function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await run(
      async () => {
        await api.saveSession({
          id: session?.id ?? null,
          courseId,
          number: Number(form.get("number")),
          title: String(form.get("title") ?? ""),
          date: String(form.get("date") ?? "") || null,
          startTime: String(form.get("startTime") ?? "") || null,
          endTime: String(form.get("endTime") ?? "") || null,
          topic: String(form.get("topic") ?? ""),
          isHeld: form.get("isHeld") === "on",
        });
        await reload();
      },
      session ? "Sesión actualizada correctamente." : "Sesión creada correctamente.",
    );
    if (saved) setEditingSession(null);
  }

  async function deleteSession(sessionId: number) {
    if (!confirm("¿Eliminar esta sesión y su asistencia?")) return;
    await run(async () => {
      await api.deleteSession(sessionId);
      await reload();
    }, "Sesión eliminada.");
  }

  /** Una sesión por cada día de clase del horario, con su hora. No toca la asistencia. */
  async function generateSessions() {
    await run(async () => {
      const result = await api.generateSessions(courseId);
      await reload();
      notify(
        result.created || result.updated
          ? `Sesiones desde el horario: ${result.created} nuevas y ${result.updated} con su hora.`
          : "Todas las clases del horario ya tienen su sesión.",
      );
    });
  }

  return (
    <>
      <AttendanceTable
        matrix={matrix}
        onGenerate={() => void generateSessions()}
        onSave={(updates) =>
          run(async () => {
            await api.saveAttendance(updates);
            await reload();
          }, "Asistencia guardada.")
        }
        onAddSession={() => setEditingSession("new")}
        onEditSession={setEditingSession}
        onDeleteSession={(sessionId) => void deleteSession(sessionId)}
      />
      <AnimatePresence>
        {editingSession && (
          <Modal
            eyebrow="DOCENCIA"
            title={session ? "Editar sesión" : "Nueva sesión"}
            onClose={() => setEditingSession(null)}
          >
            <SessionForm
              onSubmit={saveSession}
              nextNumber={(matrix.sessions[matrix.sessions.length - 1]?.number ?? 0) + 1}
              session={session}
            />
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}

type TableProps = {
  matrix: AttendanceMatrix;
  onGenerate: () => void;
  onSave: (updates: AttendanceUpdate[]) => Promise<boolean>;
  onAddSession: () => void;
  onEditSession: (session: SessionColumn) => void;
  onDeleteSession: (sessionId: number) => void;
};

function AttendanceTable({
  matrix,
  onGenerate,
  onSave,
  onAddSession,
  onEditSession,
  onDeleteSession,
}: TableProps) {
  const saved = useMemo(
    () =>
      new Map(matrix.cells.map((cell) => [`${cell.enrollmentId}:${cell.sessionId}`, cell.status])),
    [matrix],
  );
  // Cambios sin guardar, superpuestos a los datos del servidor. Al recargar la matriz (por
  // ejemplo, al crear una sesión) se conservan, salvo los de sesiones o estudiantes que ya no están.
  const [edits, setEdits] = useState(new Map<string, Status>());
  const [saving, setSaving] = useState(false);
  const pending = useMemo(() => {
    const sessions = new Set(matrix.sessions.map((session) => session.id));
    const students = new Set(matrix.students.map((student) => student.enrollmentId));
    return [...edits]
      .map(([key, status]) => {
        const [enrollmentId, sessionId] = key.split(":").map(Number);
        return { enrollmentId, sessionId, status };
      })
      .filter((update) => students.has(update.enrollmentId) && sessions.has(update.sessionId));
  }, [edits, matrix]);
  useUnsavedChanges(pending.length > 0);

  function update(key: string, status: Status) {
    setEdits((current) => new Map(current).set(key, status));
  }

  /**
   * Marca a todos los estudiantes de una clase con el mismo estado; `empty-P` solo rellena
   * los que aún no tienen marca. Queda pendiente hasta «Guardar cambios», para corregir
   * antes las excepciones.
   */
  function markAll(sessionId: number, choice: string) {
    setEdits((current) => {
      const next = new Map(current);
      for (const student of matrix.students) {
        const key = `${student.enrollmentId}:${sessionId}`;
        const value = next.get(key) ?? saved.get(key) ?? "";
        if (choice === "empty-P") {
          if (!value) next.set(key, "P");
        } else {
          next.set(key, (choice === "clear" ? "" : choice) as Status);
        }
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      if (await onSave(pending)) setEdits(new Map());
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel matrix-panel">
      <div className="table-toolbar">
        <div>
          <span className="eyebrow">REGISTRO POR SESIÓN</span>
          <h3>Control de asistencia</h3>
        </div>
        <div className="toolbar-actions">
          <span className="save-state">
            <Cloud size={15} />
            {pending.length ? `${pending.length} cambios pendientes` : "Todo guardado"}
          </span>
          <button className="secondary-button" onClick={onGenerate} title="Crea una sesión por cada clase del horario">
            <CalendarClock size={17} />
            Desde el horario
          </button>
          <button className="secondary-button" onClick={onAddSession}>
            <Plus size={17} />
            Nueva sesión
          </button>
          <button className="primary-button" onClick={save} disabled={!pending.length || saving}>
            <Check size={17} />
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
      {!matrix.sessions.length ? (
        <div className="feature-empty">
          <Info />
          <h3>Aún no hay sesiones</h3>
          <p>Créalas a partir del horario de la materia, o añade la primera a mano.</p>
          <div className="toolbar-actions">
            <button className="primary-button" onClick={onGenerate}>
              <CalendarClock size={16} />
              Desde el horario
            </button>
            <button className="secondary-button" onClick={onAddSession}>
              <Plus size={16} />
              Nueva sesión
            </button>
          </div>
        </div>
      ) : (
        <div className="matrix-scroll">
          <table className="data-table matrix-table">
            <thead>
              <tr>
                <th className="sticky-name">Estudiante</th>
                {matrix.sessions.map((session) => (
                  <th
                    key={session.id}
                    title={[session.title, session.topic].filter(Boolean).join(" — ") || undefined}
                  >
                    <span>Clase {session.number}</span>
                    <small>{session.date ?? "Sin fecha"}</small>
                    {(session.startTime || session.endTime) && (
                      <small>
                        {session.startTime ? formatTime(session.startTime) : "—"} –{" "}
                        {session.endTime ? formatTime(session.endTime) : "—"}
                      </small>
                    )}
                    {!session.isHeld && <small className="session-pending">No realizada</small>}
                    <select
                      className="mark-all"
                      value=""
                      aria-label={`Marcar a todos en la clase ${session.number}`}
                      title="Marcar a todos los estudiantes de esta clase"
                      onChange={(event) => event.target.value && markAll(session.id, event.target.value)}
                    >
                      <option value="">Marcar a todos…</option>
                      <option value="P">Todos presentes (P)</option>
                      <option value="A">Todos ausentes (A)</option>
                      <option value="J">Todos justificados (J)</option>
                      <option value="T">Todos con tardanza (T)</option>
                      <option value="empty-P">Sin marcar → presentes</option>
                      <option value="clear">Quitar todas las marcas</option>
                    </select>
                    <span className="session-actions">
                      <button title="Editar sesión" onClick={() => onEditSession(session)}>
                        <Pencil size={11} />
                      </button>
                      <button title="Eliminar sesión" onClick={() => onDeleteSession(session.id)}>
                        <Trash2 size={11} />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.students.map((student) => (
                <tr key={student.enrollmentId}>
                  <td className="sticky-name">
                    <strong>{student.name}</strong>
                    <small>{student.identification}</small>
                  </td>
                  {matrix.sessions.map((session) => {
                    const key = `${student.enrollmentId}:${session.id}`;
                    const value = edits.get(key) ?? saved.get(key) ?? "";
                    return (
                      <td key={session.id}>
                        <select
                          value={value}
                          className={`attendance-control status-${(value || "empty").toLowerCase()}`}
                          onChange={(e) => update(key, e.target.value as Status)}
                        >
                          <option value="">—</option>
                          <option value="P">P</option>
                          <option value="A">A</option>
                          <option value="J">J</option>
                          <option value="T">T</option>
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SessionForm({
  onSubmit,
  nextNumber,
  session,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  nextNumber: number;
  session: SessionColumn | null;
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label>
        <span>Número de clase *</span>
        <input
          name="number"
          type="number"
          min="1"
          required
          defaultValue={session?.number ?? nextNumber}
          autoFocus
        />
      </label>
      <label>
        <span>Nombre</span>
        <input name="title" placeholder="Ej. Introducción" defaultValue={session?.title} />
      </label>
      <label>
        <span>Fecha</span>
        <input name="date" type="date" defaultValue={session?.date ?? ""} />
      </label>
      <label>
        <span>Hora de inicio</span>
        <TimeSelect name="startTime" defaultValue={session?.startTime ?? null} />
      </label>
      <label>
        <span>Hora de salida</span>
        <TimeSelect name="endTime" defaultValue={session?.endTime ?? null} />
      </label>
      <label className="check-label">
        <input name="isHeld" type="checkbox" defaultChecked={session?.isHeld} />
        <span>Clase realizada</span>
      </label>
      <label className="span-2">
        <span>Tema o agenda</span>
        <textarea name="topic" rows={3} defaultValue={session?.topic} />
      </label>
      <div className="form-actions span-2">
        <button className="primary-button">{session ? "Guardar cambios" : "Crear sesión"}</button>
      </div>
    </form>
  );
}

const hours = Array.from({ length: 24 }, (_, hour) => hour);
const minuteSteps = Array.from({ length: 12 }, (_, step) => step * 5);

/**
 * Hora con listas desplegables. En macOS (WebKit) `<input type="time">` no abre ningún
 * selector y solo se puede editar escribiendo en cada segmento. El valor se envía como
 * `HH:MM` en un campo oculto, para que el formulario lo lea con `FormData`.
 */
function TimeSelect({ name, defaultValue }: { name: string; defaultValue: string | null }) {
  const [hour, setHour] = useState(defaultValue ? String(Number(defaultValue.slice(0, 2))) : "");
  const [minute, setMinute] = useState(defaultValue ? Number(defaultValue.slice(3, 5)) : 0);
  const minutes = minuteSteps.includes(minute)
    ? minuteSteps
    : [...minuteSteps, minute].sort((a, b) => a - b);
  const value = hour === "" ? "" : `${hour.padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return (
    <div className="time-select">
      <select aria-label="Hora" value={hour} onChange={(event) => setHour(event.target.value)}>
        <option value="">Sin hora</option>
        {hours.map((option) => (
          <option key={option} value={option}>
            {option % 12 || 12} {option < 12 ? "a. m." : "p. m."}
          </option>
        ))}
      </select>
      <select
        aria-label="Minutos"
        value={minute}
        disabled={hour === ""}
        onChange={(event) => setMinute(Number(event.target.value))}
      >
        {minutes.map((option) => (
          <option key={option} value={option}>
            :{String(option).padStart(2, "0")}
          </option>
        ))}
      </select>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
