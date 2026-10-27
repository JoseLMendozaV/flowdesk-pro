import { FormEvent, useState } from "react";
import { AnimatePresence } from "../lib/motion";
import { Crown, Pencil, Plus, Trash2, UserPlus, UsersRound } from "lucide-react";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { useResource } from "../lib/useResource";
import type { GroupRow } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";

export function GroupsView({ courseId }: { courseId: number }) {
  const { run } = useAppActions();
  const { data, loading, reload } = useResource(
    () => Promise.all([api.groups(courseId), api.students(courseId)]),
    [courseId],
  );
  const [editing, setEditing] = useState<GroupRow | "new" | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [leader, setLeader] = useState<number | null>(null);
  if (!data) return loading ? <LoadingPill /> : null;
  const [groups, students] = data;

  function open(group: GroupRow | "new") {
    setEditing(group);
    setSelected(group === "new" ? [] : group.members.map((member) => member.enrollmentId));
    setLeader(
      group === "new"
        ? null
        : (group.members.find((member) => member.isLeader)?.enrollmentId ?? null),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await run(async () => {
      await api.saveGroup({
        id: editing === "new" ? null : (editing?.id ?? null),
        courseId,
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        enrollmentIds: selected,
        leaderEnrollmentId: leader,
      });
      await reload();
    }, "Equipo guardado.");
    if (saved) setEditing(null);
  }

  async function deleteGroup(group: GroupRow) {
    if (!confirm(`¿Eliminar ${group.name}?`)) return;
    await run(async () => {
      await api.deleteGroup(group.id);
      await reload();
    }, "Equipo eliminado.");
  }

  function toggle(id: number) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
    if (leader === id && selected.includes(id)) setLeader(null);
  }

  return (
    <div className="view-stack">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">TRABAJO COLABORATIVO</span>
          <h2>{groups.length} equipos configurados</h2>
        </div>
        <button className="primary-button" onClick={() => open("new")}>
          <Plus size={17} />
          Nuevo equipo
        </button>
      </div>
      {groups.length ? (
        <section className="group-grid">
          {groups.map((group) => (
            <article className="panel group-card" key={group.id}>
              <div className="group-card-head">
                <div className="group-icon">
                  <UsersRound />
                </div>
                <div>
                  <h3>{group.name}</h3>
                  <span>{group.memberCount} integrantes</span>
                </div>
                <div className="card-actions">
                  <button onClick={() => open(group)}>
                    <Pencil size={15} />
                  </button>
                  <button className="danger" onClick={() => void deleteGroup(group)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <p>{group.description || "Sin descripción"}</p>
              <div className="member-stack">
                {group.members.slice(0, 5).map((member) => (
                  <span title={member.name} key={member.enrollmentId}>
                    {member.name.slice(0, 2).toUpperCase()}
                  </span>
                ))}
                {group.memberCount > 5 && <span>+{group.memberCount - 5}</span>}
              </div>
              <div className="leader-row">
                <Crown size={14} />
                <span>
                  {group.leaderName ? `Líder: ${group.leaderName}` : "Sin líder asignado"}
                </span>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="feature-empty panel">
          <UsersRound />
          <h3>Crea el primer equipo</h3>
          <p>Organiza estudiantes y designa un líder para cada grupo.</p>
          <button className="primary-button" onClick={() => open("new")}>
            <UserPlus size={16} />
            Nuevo equipo
          </button>
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <Modal
            eyebrow="EQUIPOS"
            title={editing === "new" ? "Nuevo equipo" : `Editar ${editing.name}`}
            className="wide"
            onClose={() => setEditing(null)}
          >
            <form onSubmit={submit}>
              <div className="form-grid compact">
                <label>
                  <span>Nombre *</span>
                  <input
                    name="name"
                    required
                    autoFocus
                    defaultValue={editing === "new" ? "" : editing.name}
                  />
                </label>
                <label>
                  <span>Descripción</span>
                  <input
                    name="description"
                    defaultValue={editing === "new" ? "" : editing.description}
                  />
                </label>
              </div>
              <div className="member-picker">
                <div className="picker-heading">
                  <strong>Integrantes</strong>
                  <span>{selected.length} seleccionados</span>
                </div>
                <div className="picker-list">
                  {students
                    .filter((student) => student.status === "active")
                    .map((student) => (
                      <div
                        className={
                          selected.includes(student.enrollmentId)
                            ? "picker-row selected"
                            : "picker-row"
                        }
                        key={student.enrollmentId}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.includes(student.enrollmentId)}
                            onChange={() => toggle(student.enrollmentId)}
                          />
                          <span>
                            <strong>{student.name}</strong>
                            <small>
                              {student.identification}
                              {student.groupName ? ` · ${student.groupName}` : ""}
                            </small>
                          </span>
                        </label>
                        <button
                          type="button"
                          disabled={!selected.includes(student.enrollmentId)}
                          className={
                            leader === student.enrollmentId
                              ? "leader-button selected"
                              : "leader-button"
                          }
                          onClick={() => setLeader(student.enrollmentId)}
                        >
                          <Crown size={14} />
                          {leader === student.enrollmentId ? "Líder" : "Designar"}
                        </button>
                      </div>
                    ))}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setEditing(null)}>
                  Cancelar
                </button>
                <button className="primary-button">Guardar equipo</button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
