import { useMemo, useState } from "react";
import { Check, Cloud, Info, UsersRound, UserRound } from "lucide-react";
import { api } from "../lib/api";
import { useAppActions, useUnsavedChanges } from "../lib/app-context";
import { useResource } from "../lib/useResource";
import type { GradeUpdate, Gradebook, GroupGradeUpdate, GroupGradebook } from "../types";
import { LoadingPill } from "./LoadingPill";

export function GradebookView({ courseId }: { courseId: number }) {
  const { run } = useAppActions();
  const { data, loading, reload } = useResource(
    () => Promise.all([api.gradebook(courseId), api.groupGradebook(courseId)]),
    [courseId],
  );
  if (!data) return loading ? <LoadingPill /> : null;
  const [gradebook, groupGradebook] = data;
  return (
    <GradebookTable
      gradebook={gradebook}
      groupGradebook={groupGradebook}
      onSave={(updates) =>
        run(async () => {
          await api.saveGrades(updates);
          await reload();
        }, "Calificaciones individuales guardadas.")
      }
      onSaveGroups={(updates) =>
        run(async () => {
          await api.saveGroupGrades(updates);
          await reload();
        }, "Calificaciones grupales guardadas y sincronizadas.")
      }
    />
  );
}

type TableProps = {
  gradebook: Gradebook;
  groupGradebook: GroupGradebook;
  onSave: (updates: GradeUpdate[]) => Promise<boolean>;
  onSaveGroups: (updates: GroupGradeUpdate[]) => Promise<boolean>;
};

function toScore(raw: string) {
  return raw === "" ? null : Number(raw);
}

function GradebookTable({ gradebook, groupGradebook, onSave, onSaveGroups }: TableProps) {
  const [tab, setTab] = useState<"group" | "individual">(
    groupGradebook.evaluations.length ? "group" : "individual",
  );
  const individualSaved = useMemo(
    () =>
      new Map(
        gradebook.cells.map((cell) => [
          `${cell.enrollmentId}:${cell.evaluationId}`,
          cell.score == null ? "" : String(cell.score),
        ]),
      ),
    [gradebook],
  );
  const groupSaved = useMemo(
    () =>
      new Map(
        groupGradebook.cells.map((cell) => [
          `${cell.groupId}:${cell.evaluationId}`,
          cell.score == null ? "" : String(cell.score),
        ]),
      ),
    [groupGradebook],
  );
  // Cambios sin guardar, superpuestos a las notas del servidor: lo que se muestra siempre
  // corresponde a los datos cargados más recientes.
  const [individualEdits, setIndividualEdits] = useState(new Map<string, string>());
  const [groupEdits, setGroupEdits] = useState(new Map<string, string>());
  const [saving, setSaving] = useState(false);
  useUnsavedChanges(individualEdits.size + groupEdits.size > 0);

  function updateIndividual(row: number, column: number, value: string) {
    setIndividualEdits((current) => new Map(current).set(`${row}:${column}`, value));
  }
  function updateGroup(row: number, column: number, value: string) {
    setGroupEdits((current) => new Map(current).set(`${row}:${column}`, value));
  }
  async function save() {
    setSaving(true);
    try {
      if (tab === "individual") {
        const updates = [...individualEdits].map(([key, raw]) => {
          const [enrollmentId, evaluationId] = key.split(":").map(Number);
          return { enrollmentId, evaluationId, score: toScore(raw) };
        });
        if (await onSave(updates)) setIndividualEdits(new Map());
      } else {
        const updates = [...groupEdits].map(([key, raw]) => {
          const [groupId, evaluationId] = key.split(":").map(Number);
          return { groupId, evaluationId, score: toScore(raw) };
        });
        if (await onSaveGroups(updates)) setGroupEdits(new Map());
      }
    } finally {
      setSaving(false);
    }
  }
  const isGroup = tab === "group";
  const evaluations = isGroup ? groupGradebook.evaluations : gradebook.evaluations;
  const dirty = isGroup ? groupEdits : individualEdits;
  return (
    <section className="panel matrix-panel">
      <div className="table-toolbar">
        <div>
          <span className="eyebrow">LIBRO DE NOTAS</span>
          <h3>Calificaciones del curso</h3>
        </div>
        <div className="toolbar-actions">
          <div className="segmented">
            <button className={tab === "group" ? "active" : ""} onClick={() => setTab("group")}>
              <UsersRound size={14} />
              Por equipo
            </button>
            <button
              className={tab === "individual" ? "active" : ""}
              onClick={() => setTab("individual")}
            >
              <UserRound size={14} />
              Individual
            </button>
          </div>
          <span className="save-state">
            <Cloud size={15} />
            {dirty.size ? `${dirty.size} cambios pendientes` : "Todo guardado"}
          </span>
          <button className="primary-button" onClick={save} disabled={!dirty.size || saving}>
            <Check size={17} />
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
      {!evaluations.length ? (
        <div className="feature-empty">
          <Info />
          <h3>No hay evaluaciones {isGroup ? "grupales" : "individuales"}</h3>
          <p>Configura su modalidad desde la sección Evaluaciones.</p>
        </div>
      ) : isGroup ? (
        <div className="matrix-scroll">
          <table className="data-table matrix-table grade-table">
            <thead>
              <tr>
                <th className="sticky-name">Equipo</th>
                {evaluations.map((evaluation) => (
                  <th key={evaluation.id}>
                    <span>{evaluation.name}</span>
                    <small>
                      {evaluation.weight}% · /{evaluation.maxScore}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupGradebook.groups.map((group) => (
                <tr key={group.groupId}>
                  <td className="sticky-name">
                    <strong>{group.name}</strong>
                    <small>{group.memberCount} integrantes</small>
                  </td>
                  {evaluations.map((evaluation) => {
                    const key = `${group.groupId}:${evaluation.id}`;
                    return (
                      <td key={evaluation.id}>
                        <input
                          type="number"
                          min="0"
                          max={evaluation.maxScore}
                          step="0.01"
                          value={groupEdits.get(key) ?? groupSaved.get(key) ?? ""}
                          placeholder="—"
                          className="grade-control"
                          onChange={(event) =>
                            updateGroup(group.groupId, evaluation.id, event.target.value)
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
      ) : (
        <div className="matrix-scroll">
          <table className="data-table matrix-table grade-table">
            <thead>
              <tr>
                <th className="sticky-name">Estudiante</th>
                {evaluations.map((evaluation) => (
                  <th key={evaluation.id}>
                    <span>{evaluation.name}</span>
                    <small>
                      {evaluation.weight}% · /{evaluation.maxScore}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gradebook.students.map((student) => (
                <tr key={student.enrollmentId}>
                  <td className="sticky-name">
                    <strong>{student.name}</strong>
                    <small>{student.identification}</small>
                  </td>
                  {evaluations.map((evaluation) => {
                    const key = `${student.enrollmentId}:${evaluation.id}`;
                    return (
                      <td key={evaluation.id}>
                        <input
                          type="number"
                          min="0"
                          max={evaluation.maxScore}
                          step="0.01"
                          value={individualEdits.get(key) ?? individualSaved.get(key) ?? ""}
                          placeholder="—"
                          className="grade-control"
                          onChange={(event) =>
                            updateIndividual(
                              student.enrollmentId,
                              evaluation.id,
                              event.target.value,
                            )
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
      )}
    </section>
  );
}
