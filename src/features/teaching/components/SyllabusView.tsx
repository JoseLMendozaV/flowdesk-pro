import { FormEvent, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarRange,
  CheckCircle2,
  Circle,
  ClipboardPaste,
  ListChecks,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { AnimatePresence } from "../lib/motion";
import { longDate, rangeLabel, todayIso } from "../lib/academic";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { useResource } from "../lib/useResource";
import type { CourseTopic, Syllabus, TopicSession } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";

function sessionLabel(session: { number: number; date: string | null }) {
  return session.date ? `Clase ${session.number} · ${rangeLabel(session.date, session.date)}` : `Clase ${session.number}`;
}

/** Plan del curso: temas en orden, su clase o semana, el avance y preparar cada clase. */
export function SyllabusView({ courseId }: { courseId: number }) {
  const { run, notify } = useAppActions();
  const { data, loading, reload } = useResource(() => api.syllabus(courseId), [courseId]);
  const [editing, setEditing] = useState<CourseTopic | "new" | null>(null);
  const [pasting, setPasting] = useState(false);
  const [distributing, setDistributing] = useState(false);
  if (!data) return loading ? <LoadingPill /> : null;
  const { topics, progress, sessions } = data;
  const today = todayIso();

  async function toggle(topic: CourseTopic) {
    await run(async () => {
      await api.setTopicDone(topic.id, !topic.done);
      await reload();
    });
  }

  async function move(index: number, offset: number) {
    const ids = topics.map((topic) => topic.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + offset, 0, id);
    await run(async () => {
      await api.reorderTopics(courseId, ids);
      await reload();
    });
  }

  async function remove(topic: CourseTopic) {
    if (!confirm(`¿Quitar «${topic.title}» del plan? La nota de preparación, si la hay, se conserva en Notas.`)) return;
    await run(async () => {
      await api.deleteTopic(topic.id);
      await reload();
    }, "Tema quitado.");
  }

  async function prepare(topic: CourseTopic) {
    await run(async () => {
      await api.prepareTopic(topic.id);
      await reload();
    });
  }

  async function distribute(reset: boolean) {
    const done = await run(async () => {
      const result = await api.distributeTopics(courseId, reset);
      await reload();
      notify(
        result.linked
          ? `${result.linked} ${result.linked === 1 ? "tema asignado" : "temas asignados"} a sus clases.${result.left ? ` ${result.left} sin clase: faltan sesiones (créalas en Horario).` : ""}`
          : result.left
            ? "No quedan sesiones libres después del último tema asignado. Crea las sesiones en Horario."
            : "No hay temas pendientes sin clase.",
      );
    });
    if (done) setDistributing(false);
  }

  const finished = progress.total > 0 && progress.current == null;
  return (
    <div className="view-stack">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">PLAN DEL CURSO</span>
          <h2>Temario y avance</h2>
        </div>
        <div className="toolbar-actions">
          <button className="secondary-button" onClick={() => setPasting(true)}>
            <ClipboardPaste size={16} />
            Pegar temario
          </button>
          <button className="secondary-button" disabled={!topics.length} onClick={() => setDistributing(true)}>
            <CalendarRange size={16} />
            Repartir en las clases
          </button>
          <button className="primary-button" onClick={() => setEditing("new")}>
            <Plus size={16} />
            Nuevo tema
          </button>
        </div>
      </div>

      {topics.length > 0 && (
        <section className="panel syllabus-progress" aria-label="Avance del plan">
          <div className="syllabus-progress-main">
            <span className="eyebrow">AVANCE</span>
            <strong>{finished ? "Plan completado" : `Vamos en el tema ${progress.current} de ${progress.total}`}</strong>
            <span className="meter" aria-hidden>
              <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </span>
            <small>
              {progress.done} de {progress.total} temas dados · {Math.round((progress.done / progress.total) * 100)} %
            </small>
          </div>
          {!finished && progress.currentTitle && (
            <div className="syllabus-progress-current">
              <span className="eyebrow">AHORA</span>
              <strong>{progress.currentTitle}</strong>
              <small>{progress.currentDate ? longDate(progress.currentDate) : "Sin clase asignada"}</small>
              {progress.currentId != null && (
                <button className="secondary-button" onClick={() => void prepare(topics.find((topic) => topic.id === progress.currentId)!)}>
                  <NotebookPen size={15} />
                  Preparar clase
                </button>
              )}
            </div>
          )}
          {progress.behind > 0 && (
            <span className="status-pill critical" title="Temas pendientes cuya clase ya pasó: márcalos como dados o vuelve a repartir">
              <AlertTriangle size={12} />
              {progress.behind === 1 ? "1 tema atrasado" : `${progress.behind} temas atrasados`}
            </span>
          )}
        </section>
      )}

      <section className="panel table-panel">
        {topics.length ? (
          <ol className="topic-list">
            {topics.map((topic, index) => {
              const behind = !topic.done && topic.sessionDate != null && topic.sessionDate < today;
              const current = topic.id === progress.currentId;
              const week = topic.sessionWeek ?? topic.week;
              return (
                <li key={topic.id} className={`topic-row ${topic.done ? "done" : ""} ${current ? "current" : ""}`}>
                  <button
                    className="topic-check"
                    role="checkbox"
                    aria-checked={topic.done}
                    title={topic.done ? "Marcar como pendiente" : "Marcar como dado"}
                    onClick={() => void toggle(topic)}
                  >
                    {topic.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  </button>
                  <span className="topic-number">{index + 1}</span>
                  <span className="topic-main">
                    <strong>{topic.title}</strong>
                    {topic.details && <small>{topic.details}</small>}
                  </span>
                  <span className="topic-when">
                    {topic.sessionNumber != null ? (
                      <>
                        <b>{sessionLabel({ number: topic.sessionNumber, date: topic.sessionDate })}</b>
                        {week != null && <small>Semana {week}</small>}
                      </>
                    ) : week != null ? (
                      <>
                        <b>Semana {week}</b>
                        <small>prevista</small>
                      </>
                    ) : (
                      <small>Sin clase asignada</small>
                    )}
                  </span>
                  <span className="topic-state">
                    {current && <span className="status-pill neutral">Ahora</span>}
                    {behind && (
                      <span className="status-pill critical">
                        <AlertTriangle size={11} />
                        Atrasado
                      </span>
                    )}
                  </span>
                  <div className="row-actions">
                    <button className={topic.noteId ? "has-note" : ""} title={topic.noteId ? "Abrir la nota de preparación" : "Preparar la clase en una nota flotante"} onClick={() => void prepare(topic)}>
                      <NotebookPen size={14} />
                    </button>
                    <button title="Subir" disabled={index === 0} onClick={() => void move(index, -1)}>
                      <ArrowUp size={14} />
                    </button>
                    <button title="Bajar" disabled={index === topics.length - 1} onClick={() => void move(index, 1)}>
                      <ArrowDown size={14} />
                    </button>
                    <button title="Editar" onClick={() => setEditing(topic)}>
                      <Pencil size={14} />
                    </button>
                    <button className="danger" title="Quitar" onClick={() => void remove(topic)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="feature-empty">
            <ListChecks />
            <h3>Aún no hay temas</h3>
            <p>Pega el temario de la materia (un tema por línea) y repártelo en las sesiones de asistencia. Al pasar lista, el tema de esa clase queda como dado.</p>
            <button className="primary-button" onClick={() => setPasting(true)}>
              <ClipboardPaste size={16} />
              Pegar temario
            </button>
          </div>
        )}
      </section>

      <AnimatePresence>
        {editing && (
          <TopicModal
            topic={editing === "new" ? null : editing}
            courseId={courseId}
            sessions={sessions}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              await reload();
              setEditing(null);
            }}
          />
        )}
        {pasting && (
          <PasteModal
            courseId={courseId}
            onClose={() => setPasting(false)}
            onSaved={async () => {
              await reload();
              setPasting(false);
            }}
          />
        )}
        {distributing && <DistributeModal data={data} onClose={() => setDistributing(false)} onDistribute={(reset) => void distribute(reset)} />}
      </AnimatePresence>
    </div>
  );
}

type TopicModalProps = {
  topic: CourseTopic | null;
  courseId: number;
  sessions: TopicSession[];
  onClose: () => void;
  onSaved: () => Promise<void>;
};

function TopicModal({ topic, courseId, sessions, onClose, onSaved }: TopicModalProps) {
  const { run } = useAppActions();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const week = String(form.get("week") ?? "");
    const session = String(form.get("sessionId") ?? "");
    await run(async () => {
      await api.saveTopic({
        id: topic?.id ?? null,
        courseId,
        title: String(form.get("title") ?? ""),
        week: week ? Number(week) : null,
        details: String(form.get("details") ?? ""),
        sessionId: session ? Number(session) : null,
        done: form.get("done") === "on",
      });
      await onSaved();
    }, "Tema guardado.");
  }
  return (
    <Modal eyebrow="PLAN DEL CURSO" title={topic ? "Editar tema" : "Nuevo tema"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          <span>Tema *</span>
          <input name="title" required autoFocus maxLength={200} defaultValue={topic?.title ?? ""} />
        </label>
        <label>
          <span>Clase</span>
          <select name="sessionId" defaultValue={topic?.sessionId ?? ""}>
            <option value="">Sin clase asignada</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id} disabled={session.dayOff && session.id !== topic?.sessionId}>
                {sessionLabel(session)}
                {session.held ? " · dada" : ""}
                {session.dayOff ? " · día sin clases" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Semana prevista</span>
          <input name="week" type="number" min={1} max={60} defaultValue={topic?.week ?? ""} placeholder="Opcional" />
        </label>
        <label className="span-2">
          <span>Contenido</span>
          <textarea name="details" rows={3} defaultValue={topic?.details ?? ""} placeholder="Subtemas, lecturas, práctica…" />
        </label>
        <label className="check-label span-2">
          <input name="done" type="checkbox" defaultChecked={topic?.done ?? false} />
          <span>Ya se dio</span>
        </label>
        <div className="form-actions span-2">
          <button className="primary-button">Guardar tema</button>
        </div>
      </form>
    </Modal>
  );
}

function PasteModal({ courseId, onClose, onSaved }: { courseId: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const { run } = useAppActions();
  const [text, setText] = useState("");
  const count = text.split("\n").filter((line) => line.replace(/^[\s\-•*·–—]+/, "").trim()).length;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const added = await api.addTopics(courseId, text);
      await onSaved();
      return added;
    }, "Temario añadido al plan.");
  }
  return (
    <Modal eyebrow="PLAN DEL CURSO" title="Pegar temario" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          <span>Un tema por línea</span>
          <textarea
            rows={10}
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"Semana 1: Introducción al curso\nSemana 2: Requisitos de software\nCasos de uso\n…"}
          />
        </label>
        <p className="muted-text span-2">Se quitan viñetas y numeración. «Semana 3:» (o «S3 -») al inicio fija la semana prevista; sin ella, el tema va a la siguiente clase al repartir.</p>
        <div className="form-actions span-2">
          <button className="primary-button" disabled={!count}>
            {count ? `Añadir ${count} ${count === 1 ? "tema" : "temas"}` : "Añadir temas"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DistributeModal({ data, onClose, onDistribute }: { data: Syllabus; onClose: () => void; onDistribute: (reset: boolean) => void }) {
  const pending = data.topics.filter((topic) => !topic.done);
  const unassigned = pending.filter((topic) => topic.sessionId == null).length;
  const assigned = pending.length - unassigned;
  const free = data.sessions.filter((session) => !session.held && !session.dayOff && session.date).length;
  return (
    <Modal eyebrow="PLAN DEL CURSO" title="Repartir en las clases" onClose={onClose}>
      <div className="distribute-options">
        <p className="muted-text">
          Asigna los temas pendientes, en orden, a las sesiones de asistencia que siguen al último tema asignado: uno por clase, o en la primera clase de su semana prevista. Los días sin clases del calendario académico se saltan.
        </p>
        {!data.sessions.length && (
          <p className="status-pill critical">
            <AlertTriangle size={12} />
            Esta materia aún no tiene sesiones: créalas desde Horario.
          </p>
        )}
        <button className="distribute-option" disabled={!unassigned || !data.sessions.length} onClick={() => onDistribute(false)}>
          <strong>Repartir los que faltan</strong>
          <small>
            {unassigned} {unassigned === 1 ? "tema sin clase" : "temas sin clase"} · {free} {free === 1 ? "sesión pendiente" : "sesiones pendientes"}
          </small>
        </button>
        <button className="distribute-option" disabled={!pending.length || !data.sessions.length} onClick={() => onDistribute(true)}>
          <strong>Rehacer el reparto de los pendientes</strong>
          <small>Quita la clase de {assigned} {assigned === 1 ? "tema pendiente" : "temas pendientes"} y reparte todos de nuevo tras el último tema dado.</small>
        </button>
      </div>
    </Modal>
  );
}
