import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FolderOpen, OctagonAlert } from "lucide-react";
import { api } from "../lib/api";
import type { FinalSheetPreview, FinalSheetSettings } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";

const periods = ["I Semestre", "II Semestre", "Verano", "I Cuatrimestre", "II Cuatrimestre", "III Cuatrimestre"];

type TextField = "teacherName" | "teacherIdentification" | "career" | "subject" | "subjectCode" | "scheduleCode" | "groupName" | "year" | "period";

const fields: { key: TextField; label: string; placeholder?: string; list?: string }[] = [
  { key: "teacherName", label: "Docente" },
  { key: "teacherIdentification", label: "Cédula del docente", placeholder: "4-000-0000" },
  { key: "career", label: "Carrera", placeholder: "Lic. en Ingeniería de Software" },
  { key: "subject", label: "Asignatura" },
  { key: "subjectCode", label: "Código de asignatura" },
  { key: "scheduleCode", label: "Código de horario" },
  { key: "groupName", label: "Grupo" },
  { key: "year", label: "Año" },
  { key: "period", label: "Período", list: "final-sheet-periods" },
];

const grade = (value: number | null, decimals: number) => (value == null ? "—" : value.toFixed(decimals));

/**
 * Hoja de notas del proyecto final de la UTP: rellena el formulario oficial (una hoja por
 * equipo) sin cambiar su formato. Los datos se guardan por materia al salir de cada campo.
 */
export function FinalSheetModal({ courseId, onClose }: { courseId: number; onClose: () => void }) {
  const [preview, setPreview] = useState<FinalSheetPreview | null>(null);
  const [draft, setDraft] = useState<FinalSheetSettings | null>(null);
  const [exporting, setExporting] = useState(false);
  // Los avisos van dentro de la ventana: el aviso de Docencia queda detrás del fondo.
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (cause) {
      setMessage({ kind: "error", text: String(cause) });
    }
  }
  const notify = (text: string) => setMessage({ kind: "success", text });

  useEffect(() => {
    api
      .finalSheet(courseId)
      .then((loaded) => {
        setPreview(loaded);
        setDraft(loaded.settings);
      })
      .catch((cause) => setMessage({ kind: "error", text: String(cause) }));
  }, [courseId]);

  if (!preview || !draft)
    return message ? (
      <Modal eyebrow="INFORMES" title="Hoja de notas del proyecto final (UTP)" onClose={onClose}>
        <p className="final-sheet-message error">{message.text}</p>
      </Modal>
    ) : (
      <LoadingPill />
    );
  const settings = draft;

  /** Guarda y recalcula la vista previa (notas, redondeo, revisiones). */
  async function persist(next: FinalSheetSettings) {
    setDraft(next);
    setMessage(null);
    await run(async () => {
      const saved = await api.saveFinalSheetSettings(courseId, next);
      setPreview(saved);
    });
  }

  async function chooseTemplate() {
    const path = await open({ title: "Formulario oficial de registro de proyectos finales", filters: [{ name: "Libro de Excel", extensions: ["xlsx"] }] });
    if (typeof path !== "string") return;
    await run(async () => {
      const info = await api.setFinalSheetTemplate(path);
      setPreview(await api.finalSheet(courseId));
      notify(`Plantilla guardada: ${info.groups} hojas de grupo con ${info.rowsPerGroup} integrantes cada una.`);
    });
  }

  async function exportSheet() {
    if (!preview) return;
    const path = await save({ defaultPath: preview.suggestedFileName, filters: [{ name: "Libro de Excel", extensions: ["xlsx"] }] });
    if (!path) return;
    setExporting(true);
    try {
      await run(async () => {
        await api.saveFinalSheetSettings(courseId, settings);
        const summary = await api.exportFinalSheet(courseId, path);
        notify(`Hoja exportada: ${summary.teams} ${summary.teams === 1 ? "equipo" : "equipos"} y ${summary.students} estudiantes, con el formato original.`);
      });
    } finally {
      setExporting(false);
    }
  }

  const reasons = preview.template?.reasons ?? [];
  const otherIndex = reasons.findIndex((reason) => /^otros/i.test(reason.trim()));
  const errors = preview.issues.filter((issue) => issue.level === "error");
  const warnings = preview.issues.filter((issue) => issue.level === "warning");

  return (
    <Modal eyebrow="INFORMES" title="Hoja de notas del proyecto final (UTP)" className="wide final-sheet-modal" onClose={onClose}>
      <div className="final-sheet">
        {message && (
          <p className={`final-sheet-message ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        )}
        <section className="final-sheet-template">
          <FileSpreadsheet size={18} />
          <div>
            <strong>{preview.template ? preview.template.name : "Sin plantilla"}</strong>
            <small>
              {preview.template
                ? `${preview.template.groups} hojas de grupo · hasta ${preview.template.rowsPerGroup} integrantes por equipo · se rellena sin cambiar su formato`
                : "Elige el Excel oficial «Formato de registro de proyectos». FlowDesk guarda una copia y la usa para todas las materias."}
            </small>
          </div>
          <button className="secondary-button" onClick={() => void chooseTemplate()}>
            <FolderOpen size={15} />
            {preview.template ? "Cambiar…" : "Elegir plantilla…"}
          </button>
        </section>

        <section className="final-sheet-section">
          <h4>Datos generales</h4>
          <div className="form-grid final-sheet-fields">
            {fields.map(({ key, label, placeholder, list }) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  value={settings[key]}
                  placeholder={placeholder}
                  list={list}
                  onChange={(event) => setDraft({ ...settings, [key]: event.target.value })}
                  onBlur={() => preview.settings[key] !== settings[key] && void persist(settings)}
                />
              </label>
            ))}
            <datalist id="final-sheet-periods">
              {periods.map((period) => (
                <option key={period} value={period} />
              ))}
            </datalist>
            <label>
              <span>Nota que va a la hoja</span>
              <select
                value={settings.evaluationId ?? ""}
                onChange={(event) => void persist({ ...settings, evaluationId: event.target.value ? Number(event.target.value) : null })}
              >
                {preview.evaluations.map((evaluation) => (
                  <option key={evaluation.id} value={evaluation.id}>
                    {evaluation.name}
                    {evaluation.gradingMode === "group" ? " (por equipo)" : ""}
                  </option>
                ))}
                <option value="">Nota final del curso</option>
              </select>
            </label>
            <label>
              <span>Redondeo</span>
              <select value={settings.decimals} onChange={(event) => void persist({ ...settings, decimals: Number(event.target.value) })}>
                <option value={0}>A enteros (85,5 → 86)</option>
                <option value={1}>A un decimal (85,45 → 85,5)</option>
              </select>
            </label>
          </div>
        </section>

        {reasons.length > 0 && (
          <section className="final-sheet-section">
            <h4>Motivos por los que el proyecto reemplaza el examen semestral</h4>
            <div className="final-sheet-reasons">
              {reasons.map((reason, index) => (
                <label key={reason} className="check-label">
                  <input
                    type="checkbox"
                    checked={settings.reasons.includes(index)}
                    onChange={(event) =>
                      void persist({
                        ...settings,
                        reasons: event.target.checked ? [...settings.reasons, index].sort((a, b) => a - b) : settings.reasons.filter((item) => item !== index),
                      })
                    }
                  />
                  <span>{reason}</span>
                </label>
              ))}
              {otherIndex >= 0 && settings.reasons.includes(otherIndex) && (
                <input
                  aria-label="Explica el otro motivo"
                  placeholder="Explica el motivo"
                  value={settings.otherReason}
                  onChange={(event) => setDraft({ ...settings, otherReason: event.target.value })}
                  onBlur={() => preview.settings.otherReason !== settings.otherReason && void persist(settings)}
                />
              )}
            </div>
          </section>
        )}

        <section className="final-sheet-section" aria-label="Revisión">
          <h4>Revisión</h4>
          {preview.issues.length === 0 ? (
            <p className="final-sheet-ok">
              <CheckCircle2 size={15} /> Todo listo para exportar.
            </p>
          ) : (
            <ul className="final-sheet-issues">
              {[...errors, ...warnings].map((issue) => (
                <li key={issue.message} className={issue.level}>
                  {issue.level === "error" ? <OctagonAlert size={14} /> : <AlertTriangle size={14} />}
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="final-sheet-section">
          <h4>Equipos</h4>
          <div className="final-sheet-teams">
            {preview.teams.map((team) => (
              <article key={team.id} className={team.sheet ? "" : "overflow"}>
                <header>
                  <strong>{team.name}</strong>
                  <span className="status-pill neutral">{team.sheet ?? "No cabe"}</span>
                </header>
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Cédula</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.members.map((member) => (
                      <tr key={`${member.name}-${member.identification}`}>
                        <td>{member.name}</td>
                        <td className={member.identification ? "" : "missing"}>{member.identification || "Sin cédula"}</td>
                        <td className={member.value == null ? "missing" : ""} title={member.grade == null ? "Sin nota" : `Calculada: ${member.grade.toFixed(2)}`}>
                          {grade(member.value, settings.decimals)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <textarea
                  rows={2}
                  aria-label={`Observaciones al trabajo de ${team.name}`}
                  placeholder="Observaciones al trabajo (opcional)"
                  value={settings.teamNotes[String(team.id)] ?? ""}
                  onChange={(event) => setDraft({ ...settings, teamNotes: { ...settings.teamNotes, [String(team.id)]: event.target.value } })}
                  onBlur={() => (preview.settings.teamNotes[String(team.id)] ?? "") !== (settings.teamNotes[String(team.id)] ?? "") && void persist(settings)}
                />
              </article>
            ))}
          </div>
        </section>

        <div className="form-actions">
          <button className="primary-button" disabled={!preview.canExport || exporting} onClick={() => void exportSheet()} title={preview.canExport ? undefined : "Corrige primero lo marcado en rojo"}>
            <FileSpreadsheet size={16} />
            {exporting ? "Exportando…" : "Exportar Excel…"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
