import { FormEvent, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence } from "../lib/motion";
import { Eye, FileSpreadsheet, Mail, Plus, Search, UserRoundCheck, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { useResource } from "../lib/useResource";
import type { StudentRow } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";
import { StudentProfileModal } from "./StudentProfileModal";

const noStudents: StudentRow[] = [];

export function StudentsView({ courseId }: { courseId: number }) {
  const { notify, run } = useAppActions();
  const { data, loading, reload } = useResource(() => api.students(courseId), [courseId]);
  const students = data ?? noStudents;
  const [adding, setAdding] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    if (!needle) return students;
    return students.filter((student) =>
      [student.name, student.identification, student.email, student.groupName ?? ""].some((value) =>
        value.toLocaleLowerCase("es").includes(needle),
      ),
    );
  }, [query, students]);
  const active = students.filter((student) => student.status === "active").length;

  async function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await run(async () => {
      await api.addStudent(courseId, {
        identification: String(form.get("identification") ?? ""),
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        guardianName: String(form.get("guardianName") ?? ""),
        guardianEmail: String(form.get("guardianEmail") ?? ""),
        guardianPhone: String(form.get("guardianPhone") ?? ""),
      });
      await reload();
    }, "Estudiante agregado al curso.");
    if (saved) setAdding(false);
  }

  async function importStudents() {
    const path = await open({
      multiple: false,
      filters: [{ name: "Libro de Excel", extensions: ["xlsx", "xls", "xlsb", "ods"] }],
    });
    if (typeof path !== "string") return;
    await run(async () => {
      const result = await api.importStudentsExcel(courseId, path);
      await reload();
      notify(
        `Importación terminada: ${result.created} nuevos, ${result.updated} actualizados y ${result.skipped} omitidos.`,
      );
    });
  }

  return (
    <div className="view-stack">
      <section className="mini-stat-row">
        <div className="summary-chip">
          <Users />
          <div>
            <strong>{students.length}</strong>
            <span>Estudiantes</span>
          </div>
        </div>
        <div className="summary-chip">
          <UserRoundCheck />
          <div>
            <strong>{active}</strong>
            <span>Activos</span>
          </div>
        </div>
        <div className="summary-chip">
          <Mail />
          <div>
            <strong>{students.filter((s) => s.email).length}</strong>
            <span>Con correo</span>
          </div>
        </div>
      </section>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, identificación o equipo…"
            />
          </div>
          <div className="toolbar-actions">
            <button className="secondary-button" onClick={() => void importStudents()}>
              <FileSpreadsheet size={17} />
              Importar Excel
            </button>
            <button className="primary-button" onClick={() => setAdding(true)}>
              <Plus size={17} />
              Nuevo estudiante
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Estudiante</th>
                <th>Identificación</th>
                <th>Equipo</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((student) => (
                <tr key={student.enrollmentId}>
                  <td>
                    <div className="student-cell">
                      <div className="mini-avatar">{student.name.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <strong>{student.name}</strong>
                        <small>{student.guardianName || "Sin acudiente registrado"}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="mono-value">{student.identification}</span>
                  </td>
                  <td>
                    {student.groupName ? (
                      <span className="soft-badge violet">{student.groupName}</span>
                    ) : (
                      <span className="muted-text">Sin equipo</span>
                    )}
                  </td>
                  <td>
                    <div className="contact-cell">
                      <span>{student.email || "Sin correo"}</span>
                      <small>{student.guardianPhone || "Sin teléfono"}</small>
                    </div>
                  </td>
                  <td>
                    <span
                      className={
                        student.status === "active" ? "status-badge active" : "status-badge"
                      }
                    >
                      <i />
                      {student.status === "active" ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      title="Abrir expediente"
                      onClick={() => setProfileId(student.enrollmentId)}
                    >
                      <Eye size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="empty-table">No encontramos estudiantes con ese criterio.</div>
          )}
        </div>
      </section>
      <AnimatePresence>
        {adding && (
          <Modal
            eyebrow="DOCENCIA"
            title="Nuevo estudiante"
            onClose={() => setAdding(false)}
          >
            <form className="form-grid" onSubmit={addStudent}>
              <label>
                <span>Identificación *</span>
                <input name="identification" required autoFocus />
              </label>
              <label>
                <span>Nombre completo *</span>
                <input name="name" required />
              </label>
              <label className="span-2">
                <span>Correo</span>
                <input name="email" type="email" />
              </label>
              <label>
                <span>Acudiente</span>
                <input name="guardianName" />
              </label>
              <label>
                <span>Teléfono</span>
                <input name="guardianPhone" />
              </label>
              <label className="span-2">
                <span>Correo del acudiente</span>
                <input name="guardianEmail" type="email" />
              </label>
              <div className="form-actions span-2">
                <button className="primary-button">Agregar estudiante</button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
      {profileId != null && (
        <StudentProfileModal
          enrollmentId={profileId}
          onClose={() => setProfileId(null)}
          onStudentChanged={reload}
        />
      )}
      {loading && !data && <LoadingPill />}
    </div>
  );
}
