import { FormEvent, useState } from "react";
import {
  BookOpenCheck,
  Calendar,
  ListChecks,
  Pencil,
  Plus,
  Scale,
  Trash2,
  UsersRound,
} from "lucide-react";
import { AnimatePresence } from "../lib/motion";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { useResource } from "../lib/useResource";
import type { EvaluationRow } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";
import { RubricModal } from "./RubricModal";

const labels: Record<string, string> = {
  task: "Tarea",
  quiz: "Quiz",
  partial: "Parcial",
  project: "Proyecto",
  exam: "Examen",
  workshop: "Taller",
  forum: "Foro",
  other: "Otra",
};

export function EvaluationsView({ courseId }: { courseId: number }) {
  const { run } = useAppActions();
  const {
    data: evaluations,
    loading,
    reload,
  } = useResource(() => api.evaluations(courseId), [courseId]);
  const [editing, setEditing] = useState<EvaluationRow | "new" | null>(null);
  const [rubricEvaluation, setRubricEvaluation] = useState<EvaluationRow | null>(null);
  if (!evaluations) return loading ? <LoadingPill /> : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await run(async () => {
      await api.saveEvaluation({
        id: editing === "new" ? null : (editing?.id ?? null),
        courseId,
        name: String(data.get("name") ?? ""),
        evaluationType: String(data.get("evaluationType") ?? "task"),
        gradingMode: String(data.get("gradingMode") ?? "individual"),
        weight: Number(data.get("weight")),
        maxScore: Number(data.get("maxScore")),
        active: data.get("active") === "on",
        dueDate: String(data.get("dueDate") ?? "") || null,
      });
      await reload();
    }, "Evaluación guardada.");
    if (saved) setEditing(null);
  }

  async function deleteEvaluation(evaluation: EvaluationRow) {
    if (!confirm(`¿Eliminar ${evaluation.name} y sus notas?`)) return;
    await run(async () => {
      await api.deleteEvaluation(evaluation.id);
      await reload();
    }, "Evaluación eliminada.");
  }

  const weight = evaluations
    .filter((item) => item.active)
    .reduce((sum, item) => sum + item.weight, 0);
  return (
    <div className="view-stack">
      <div className="mini-stat-row">
        <div className="summary-chip">
          <BookOpenCheck />
          <div>
            <strong>{evaluations.length}</strong>
            <span>Evaluaciones</span>
          </div>
        </div>
        <div className="summary-chip">
          <Scale />
          <div>
            <strong>{weight}%</strong>
            <span>Peso activo</span>
          </div>
        </div>
        <div className="summary-chip">
          <UsersRound />
          <div>
            <strong>{evaluations.filter((item) => item.gradingMode === "group").length}</strong>
            <span>Grupales</span>
          </div>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <span className="eyebrow">PLAN DE EVALUACIÓN</span>
            <h3>Evaluaciones del curso</h3>
          </div>
          <button className="primary-button" onClick={() => setEditing("new")}>
            <Plus size={17} />
            Nueva evaluación
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Evaluación</th>
                <th>Tipo</th>
                <th>Modalidad</th>
                <th>Peso</th>
                <th>Puntaje</th>
                <th>Fecha límite</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {evaluations.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.rubricCount > 0 && (
                      <small className="cell-note">{item.rubricCount} criterios de rúbrica</small>
                    )}
                  </td>
                  <td>
                    <span className="soft-badge violet">
                      {labels[item.evaluationType] ?? item.evaluationType}
                    </span>
                  </td>
                  <td>{item.gradingMode === "group" ? "Por equipo" : "Individual"}</td>
                  <td>
                    <strong>{item.weight}%</strong>
                  </td>
                  <td>{item.maxScore}</td>
                  <td>
                    {item.dueDate ? (
                      <span className="date-cell">
                        <Calendar size={13} />
                        {item.dueDate.slice(0, 10)}
                      </span>
                    ) : (
                      <span className="muted-text">Sin fecha</span>
                    )}
                  </td>
                  <td>
                    <span className={item.active ? "status-badge active" : "status-badge"}>
                      <i />
                      {item.active ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button title="Configurar rúbrica" onClick={() => setRubricEvaluation(item)}>
                        <ListChecks size={15} />
                      </button>
                      <button onClick={() => setEditing(item)}>
                        <Pencil size={15} />
                      </button>
                      <button className="danger" onClick={() => void deleteEvaluation(item)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!evaluations.length && (
            <div className="empty-table">No hay evaluaciones configuradas.</div>
          )}
        </div>
      </section>
      <AnimatePresence>
        {editing && (
          <Modal
            eyebrow="EVALUACIONES"
            title={editing === "new" ? "Nueva evaluación" : "Editar evaluación"}
            onClose={() => setEditing(null)}
          >
            <form className="form-grid" onSubmit={submit}>
              <label className="span-2">
                <span>Nombre *</span>
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={editing === "new" ? "" : editing.name}
                />
              </label>
              <label>
                <span>Tipo</span>
                <select
                  name="evaluationType"
                  defaultValue={editing === "new" ? "task" : editing.evaluationType}
                >
                  {Object.entries(labels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Modalidad</span>
                <select
                  name="gradingMode"
                  defaultValue={editing === "new" ? "individual" : editing.gradingMode}
                >
                  <option value="individual">Individual</option>
                  <option value="group">Por equipo</option>
                </select>
              </label>
              <label>
                <span>Peso (%)</span>
                <input
                  name="weight"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  required
                  defaultValue={editing === "new" ? 10 : editing.weight}
                />
              </label>
              <label>
                <span>Puntaje máximo</span>
                <input
                  name="maxScore"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={editing === "new" ? 100 : editing.maxScore}
                />
              </label>
              <label>
                <span>Fecha límite</span>
                <input
                  name="dueDate"
                  type="datetime-local"
                  defaultValue={editing === "new" ? "" : editing.dueDate?.slice(0, 16)}
                />
              </label>
              <label className="check-label">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={editing === "new" || editing.active}
                />
                <span>Evaluación activa</span>
              </label>
              <div className="form-actions span-2">
                <button className="primary-button">Guardar evaluación</button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
      {rubricEvaluation && (
        <RubricModal
          evaluation={rubricEvaluation}
          onClose={() => setRubricEvaluation(null)}
          onCriteriaChanged={reload}
        />
      )}
    </div>
  );
}
