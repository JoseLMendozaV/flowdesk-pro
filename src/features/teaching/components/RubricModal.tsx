import { FormEvent, useEffect, useState } from "react";
import { ListChecks, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { useResource } from "../lib/useResource";
import type { EvaluationRow, RubricCriterionRow } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";

type Props = {
  evaluation: EvaluationRow;
  onClose: () => void;
  /** Se llama al crear o eliminar criterios, para actualizar el conteo de la evaluación. */
  onCriteriaChanged: () => Promise<void>;
};

export function RubricModal({ evaluation, onClose, onCriteriaChanged }: Props) {
  const { run } = useAppActions();
  const {
    data: matrix,
    loading,
    reload,
  } = useResource(() => api.rubricMatrix(evaluation.id), [evaluation.id]);
  const [editing, setEditing] = useState<RubricCriterionRow | "new" | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    matrix?.cells.forEach((cell) => {
      next[`${cell.enrollmentId}:${cell.criterionId}`] = String(cell.score);
    });
    setScores(next);
  }, [matrix]);
  if (!matrix) return loading ? <LoadingPill /> : null;
  const criteria = matrix.criteria;
  const totalWeight = criteria.reduce((sum, item) => sum + item.weight, 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await run(async () => {
      await api.saveRubricCriterion({
        id: editing === "new" ? null : (editing?.id ?? null),
        evaluationId: evaluation.id,
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
        weight: Number(data.get("weight")),
        maxScore: Number(data.get("maxScore")),
      });
      await Promise.all([reload(), onCriteriaChanged()]);
    }, "Criterio guardado.");
    if (saved) setEditing(null);
  }
  async function deleteCriterion(criterionId: number) {
    if (!confirm("¿Eliminar este criterio?")) return;
    await run(async () => {
      await api.deleteRubricCriterion(criterionId);
      await Promise.all([reload(), onCriteriaChanged()]);
    }, "Criterio eliminado.");
  }
  async function saveScores() {
    const updates = matrix!.students.flatMap((student) =>
      criteria.map((criterion) => {
        const value = scores[`${student.enrollmentId}:${criterion.id}`];
        return {
          enrollmentId: student.enrollmentId,
          criterionId: criterion.id,
          score: value == null || value === "" ? null : Number(value),
        };
      }),
    );
    await run(async () => {
      await api.saveRubricScores(evaluation.id, updates);
      await reload();
    }, "Rúbrica guardada y calificaciones recalculadas.");
  }
  return (
    <Modal
      eyebrow={`RÚBRICA · ${evaluation.name}`}
      title="Criterios de evaluación"
      className="rubric-modal"
      onClose={onClose}
    >
      <div className="rubric-summary">
        <div>
          <ListChecks />
          <span>
            <strong>{criteria.length}</strong> criterios
          </span>
        </div>
        <div>
          <strong className={totalWeight === 100 ? "ok-text" : "warning-text"}>
            {totalWeight}%
          </strong>
          <span>Peso configurado</span>
        </div>
        <button className="primary-button" onClick={() => setEditing("new")}>
          <Plus size={16} />
          Agregar criterio
        </button>
      </div>
      <div className="rubric-list">
        {criteria.map((item) => (
          <article key={item.id} className="rubric-row">
            <div>
              <strong>{item.name}</strong>
              <p>{item.description || "Sin descripción"}</p>
            </div>
            <span>{item.weight}%</span>
            <span>{item.maxScore} pts</span>
            <div className="row-actions">
              <button onClick={() => setEditing(item)}>
                <Pencil size={14} />
              </button>
              <button className="danger" onClick={() => void deleteCriterion(item.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
        {!criteria.length && (
          <div className="empty-table">
            Agrega los criterios que usarás para valorar esta evaluación.
          </div>
        )}
      </div>
      {editing && (
        <form className="form-grid rubric-form" onSubmit={submit}>
          <label className="span-2">
            <span>Nombre del criterio *</span>
            <input
              name="name"
              required
              autoFocus
              defaultValue={editing === "new" ? "" : editing.name}
            />
          </label>
          <label className="span-2">
            <span>Descripción</span>
            <textarea
              name="description"
              rows={2}
              defaultValue={editing === "new" ? "" : editing.description}
            />
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
              defaultValue={editing === "new" ? 25 : editing.weight}
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
              defaultValue={editing === "new" ? 25 : editing.maxScore}
            />
          </label>
          <div className="form-actions span-2">
            <button type="button" className="secondary-button" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button className="primary-button">Guardar criterio</button>
          </div>
        </form>
      )}
      {!!criteria.length && (
        <section className="rubric-matrix-section">
          <div className="matrix-heading">
            <div>
              <span className="eyebrow">CALIFICACIÓN DETALLADA</span>
              <h3>Matriz de rúbrica</h3>
            </div>
            <button className="primary-button" onClick={() => void saveScores()}>
              <Save size={15} />
              Guardar y recalcular
            </button>
          </div>
          <div className="matrix-scroll rubric-matrix">
            <table className="data-table matrix-table">
              <thead>
                <tr>
                  <th className="sticky-name">Estudiante</th>
                  {criteria.map((item) => (
                    <th key={item.id}>
                      <span>{item.name}</span>
                      <small>máx. {item.maxScore}</small>
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
                    {criteria.map((criterion) => {
                      const key = `${student.enrollmentId}:${criterion.id}`;
                      return (
                        <td key={criterion.id}>
                          <input
                            className="grade-control"
                            type="number"
                            min="0"
                            max={criterion.maxScore}
                            step="0.01"
                            value={scores[key] ?? ""}
                            onChange={(event) =>
                              setScores((current) => ({ ...current, [key]: event.target.value }))
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Modal>
  );
}
