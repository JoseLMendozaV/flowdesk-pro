import { FormEvent, useState } from "react";
import { CheckCircle2, ClipboardList, Pencil, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { formatTimestamp } from "../lib/dates";
import { useResource } from "../lib/useResource";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";

type Props = {
  enrollmentId: number;
  onClose: () => void;
  /** Se llama cuando cambian los datos de contacto o el estado del estudiante. */
  onStudentChanged: () => Promise<void>;
};

export function StudentProfileModal({ enrollmentId, onClose, onStudentChanged }: Props) {
  const { run } = useAppActions();
  const {
    data: profile,
    loading,
    reload,
  } = useResource(() => api.studentProfile(enrollmentId), [enrollmentId]);
  const [tab, setTab] = useState<"grades" | "observations">("grades");
  const [editingContact, setEditingContact] = useState(false);
  if (!profile) return loading ? <LoadingPill /> : null;

  async function observation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await run(async () => {
      await api.saveObservation({
        id: null,
        enrollmentId,
        category: String(data.get("category")),
        text: String(data.get("text")),
        followUpDate: String(data.get("followUpDate") ?? "") || null,
        resolved: false,
        private: data.get("private") === "on",
      });
      await reload();
    }, "Observación guardada.");
    if (saved) form.reset();
  }
  async function recovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await run(async () => {
      await api.applyRecovery({
        enrollmentId,
        evaluationId: Number(data.get("evaluationId")),
        recoveryScore: Number(data.get("recoveryScore")),
        notes: String(data.get("notes") ?? ""),
      });
      await reload();
    }, "Recuperación aplicada y libro de notas actualizado.");
    if (saved) form.reset();
  }
  async function toggleObservation(observationId: number) {
    await run(async () => {
      await api.toggleObservation(observationId);
      await reload();
    });
  }
  async function updateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await run(async () => {
      await api.updateStudent(
        enrollmentId,
        {
          identification: String(data.get("identification") ?? ""),
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          guardianName: String(data.get("guardianName") ?? ""),
          guardianEmail: String(data.get("guardianEmail") ?? ""),
          guardianPhone: String(data.get("guardianPhone") ?? ""),
        },
        data.get("status") === "inactive" ? "inactive" : "active",
      );
      await Promise.all([reload(), onStudentChanged()]);
    }, "Datos del estudiante actualizados.");
    if (saved) setEditingContact(false);
  }
  return (
    <Modal
      eyebrow="EXPEDIENTE DEL ESTUDIANTE"
      title={profile.name}
      subtitle={
        <small>
          {profile.identification} · {profile.email || "Sin correo"}
        </small>
      }
      className="profile-modal"
      onClose={onClose}
    >
      <div className="profile-metrics">
        <div>
          <span>Promedio</span>
          <strong>{profile.grade == null ? "—" : `${profile.grade.toFixed(1)}%`}</strong>
        </div>
        <div>
          <span>Asistencia</span>
          <strong>{profile.attendance.toFixed(1)}%</strong>
        </div>
        <div>
          <span>Observaciones</span>
          <strong>{profile.observations.filter((item) => !item.resolved).length}</strong>
        </div>
        <button
          className="secondary-button profile-edit-button"
          onClick={() => setEditingContact((value) => !value)}
        >
          <Pencil size={14} />
          Editar datos
        </button>
      </div>
      {editingContact && (
        <form className="form-grid profile-edit-form" onSubmit={updateContact}>
          <label>
            <span>Identificación</span>
            <input name="identification" required defaultValue={profile.identification} />
          </label>
          <label>
            <span>Nombre</span>
            <input name="name" required defaultValue={profile.name} />
          </label>
          <label>
            <span>Correo</span>
            <input name="email" type="email" defaultValue={profile.email} />
          </label>
          <label>
            <span>Estado</span>
            <select name="status" defaultValue={profile.status}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          <label>
            <span>Acudiente</span>
            <input name="guardianName" defaultValue={profile.guardianName} />
          </label>
          <label>
            <span>Teléfono</span>
            <input name="guardianPhone" defaultValue={profile.guardianPhone} />
          </label>
          <label className="span-2">
            <span>Correo del acudiente</span>
            <input name="guardianEmail" type="email" defaultValue={profile.guardianEmail} />
          </label>
          <div className="form-actions span-2">
            <button className="primary-button">Guardar datos</button>
          </div>
        </form>
      )}
      <div className="profile-tabs">
        <button className={tab === "grades" ? "active" : ""} onClick={() => setTab("grades")}>
          Notas y recuperación
        </button>
        <button
          className={tab === "observations" ? "active" : ""}
          onClick={() => setTab("observations")}
        >
          Seguimiento
        </button>
      </div>
      <div className="profile-content">
        {tab === "grades" ? (
          <>
            <div className="profile-grade-list">
              {profile.grades.map((item) => (
                <div key={item.evaluationId}>
                  <span>
                    {item.evaluationName}
                    <small>Peso {item.weight}%</small>
                  </span>
                  <strong>{item.score == null ? "—" : `${item.score} / ${item.maxScore}`}</strong>
                </div>
              ))}
            </div>
            <form className="inline-form" onSubmit={recovery}>
              <div className="inline-title">
                <RotateCcw size={16} />
                <strong>Aplicar recuperación</strong>
              </div>
              <select name="evaluationId" required>
                {profile.grades.map((item) => (
                  <option key={item.evaluationId} value={item.evaluationId}>
                    {item.evaluationName}
                  </option>
                ))}
              </select>
              <input
                name="recoveryScore"
                type="number"
                min="0"
                step="0.01"
                required
                placeholder="Nueva nota"
              />
              <input name="notes" placeholder="Nota o motivo" />
              <button className="primary-button" disabled={!profile.grades.length}>
                Aplicar
              </button>
            </form>
            {!!profile.recoveries.length && (
              <div className="history-list">
                <strong>Historial de recuperaciones</strong>
                {profile.recoveries.map((item) => (
                  <div key={item.id}>
                    <span>
                      {item.evaluationName} · {formatTimestamp(item.createdAt)}
                    </span>
                    <b>
                      {item.originalScore ?? "—"} → {item.appliedScore}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <form className="observation-form" onSubmit={observation}>
              <div className="inline-title">
                <ClipboardList size={16} />
                <strong>Nueva observación</strong>
              </div>
              <select name="category">
                <option value="academic">Académica</option>
                <option value="attendance">Asistencia</option>
                <option value="behavior">Convivencia</option>
                <option value="commitment">Compromiso</option>
                <option value="other">Otra</option>
              </select>
              <input name="followUpDate" type="date" />
              <textarea
                name="text"
                required
                rows={3}
                placeholder="Observación, acuerdo o compromiso…"
              />
              <label>
                <input name="private" type="checkbox" /> Uso privado del docente
              </label>
              <button className="primary-button">Guardar</button>
            </form>
            <div className="observation-list">
              {profile.observations.map((item) => (
                <article className={item.resolved ? "resolved" : ""} key={item.id}>
                  <div>
                    <span>
                      {item.category} · {formatTimestamp(item.createdAt)}
                    </span>
                    <p>{item.text}</p>
                    {item.followUpDate && <small>Seguimiento: {item.followUpDate}</small>}
                  </div>
                  <button title="Cambiar estado" onClick={() => void toggleObservation(item.id)}>
                    <CheckCircle2 size={18} />
                  </button>
                </article>
              ))}
              {!profile.observations.length && (
                <div className="empty-table">Todavía no hay observaciones.</div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
