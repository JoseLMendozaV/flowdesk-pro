import { FormEvent, useState } from "react";
import { AnimatePresence } from "../lib/motion";
import { BellRing, CalendarDays, Clock3, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import { formatTimestamp } from "../lib/dates";
import { useResource } from "../lib/useResource";
import type { AcademicEventRow, AnnouncementRow } from "../types";
import { LoadingPill } from "./LoadingPill";
import { Modal } from "./Modal";

const eventLabels: Record<string, string> = {
  class: "Clase",
  evaluation: "Evaluación",
  delivery: "Entrega",
  meeting: "Reunión",
  other: "Otro",
};

export function PlanningView({ courseId }: { courseId: number }) {
  const { run } = useAppActions();
  const { data, loading, reload } = useResource(
    () => Promise.all([api.events(courseId), api.announcements(courseId)]),
    [courseId],
  );
  const [editing, setEditing] = useState<AcademicEventRow | "new" | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementRow | "new" | null>(null);
  if (!data) return loading ? <LoadingPill /> : null;
  const [events, announcements] = data;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await run(async () => {
      await api.saveEvent({
        id: editing === "new" ? null : (editing?.id ?? null),
        courseId,
        title: String(form.get("title") ?? ""),
        eventType: String(form.get("eventType") ?? "other"),
        startsAt: String(form.get("startsAt") ?? ""),
        endsAt: String(form.get("endsAt") ?? "") || null,
        description: String(form.get("description") ?? ""),
        reminderDays: Number(form.get("reminderDays") ?? 1),
      });
      await reload();
    }, "Evento guardado.");
    if (saved) setEditing(null);
  }
  async function deleteEvent(eventId: number) {
    if (!confirm("¿Eliminar este evento?")) return;
    await run(async () => {
      await api.deleteEvent(eventId);
      await reload();
    }, "Evento eliminado.");
  }
  async function submitAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await run(async () => {
      await api.saveAnnouncement({
        id: announcement === "new" ? null : (announcement?.id ?? null),
        courseId,
        title: String(form.get("title") ?? ""),
        body: String(form.get("body") ?? ""),
        published: form.get("published") === "on",
      });
      await reload();
    }, "Anuncio guardado.");
    if (saved) setAnnouncement(null);
  }
  async function deleteAnnouncement(announcementId: number) {
    if (!confirm("¿Eliminar este anuncio?")) return;
    await run(async () => {
      await api.deleteAnnouncement(announcementId);
      await reload();
    }, "Anuncio eliminado.");
  }
  const grouped = events.reduce<Record<string, AcademicEventRow[]>>((acc, item) => {
    const key = item.startsAt.slice(0, 10);
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
  return (
    <div className="view-stack">
      <div className="section-toolbar">
        <div>
          <span className="eyebrow">AGENDA DEL CURSO</span>
          <h2>Planificación académica</h2>
        </div>
        <button className="primary-button" onClick={() => setEditing("new")}>
          <Plus size={17} />
          Nuevo evento
        </button>
      </div>
      <section className="planning-layout">
        <div className="panel timeline-panel">
          {Object.entries(grouped).length ? (
            Object.entries(grouped).map(([date, items]) => (
              <div className="timeline-day" key={date}>
                <div className="date-tile">
                  <strong>
                    {new Date(`${date}T12:00:00`).toLocaleDateString("es-PA", { day: "2-digit" })}
                  </strong>
                  <span>
                    {new Date(`${date}T12:00:00`).toLocaleDateString("es-PA", { month: "short" })}
                  </span>
                </div>
                <div className="day-events">
                  {items.map((item) => (
                    <article className={`event-row event-${item.eventType}`} key={item.id}>
                      <i />
                      <div>
                        <span>{eventLabels[item.eventType] ?? item.eventType}</span>
                        <strong>{item.title}</strong>
                        <small>
                          <Clock3 size={12} />
                          {new Date(item.startsAt).toLocaleString("es-PA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {item.description ? ` · ${item.description}` : ""}
                        </small>
                      </div>
                      <div className="row-actions">
                        <button onClick={() => setEditing(item)}>
                          <Pencil size={15} />
                        </button>
                        <button className="danger" onClick={() => void deleteEvent(item.id)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="feature-empty">
              <CalendarDays />
              <h3>Tu agenda está libre</h3>
              <p>Agrega clases, entregas, evaluaciones o reuniones.</p>
            </div>
          )}
        </div>
        <aside className="panel agenda-summary">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RESUMEN</span>
              <h3>Próximos eventos</h3>
            </div>
          </div>
          <div className="agenda-count">
            <strong>{events.filter((item) => new Date(item.startsAt) >= new Date()).length}</strong>
            <span>eventos pendientes</span>
          </div>
          <div className="agenda-types">
            {Object.entries(eventLabels).map(([type, label]) => (
              <div key={type}>
                <i className={`event-dot event-${type}`} />
                <span>{label}</span>
                <b>{events.filter((item) => item.eventType === type).length}</b>
              </div>
            ))}
          </div>
        </aside>
      </section>
      <section className="panel announcement-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">COMUNICACIÓN</span>
            <h3>Anuncios del curso</h3>
          </div>
          <button className="secondary-button" onClick={() => setAnnouncement("new")}>
            <Megaphone size={16} />
            Nuevo anuncio
          </button>
        </div>
        <div className="announcement-grid">
          {announcements.map((item) => (
            <article key={item.id}>
              <div className="announcement-icon">
                <Megaphone />
              </div>
              <div>
                <span className={item.published ? "status-badge active" : "status-badge"}>
                  <i />
                  {item.published ? "Publicado" : "Borrador"}
                </span>
                <h4>{item.title}</h4>
                <p>{item.body}</p>
                <small>{formatTimestamp(item.createdAt)}</small>
              </div>
              <div className="row-actions">
                <button onClick={() => setAnnouncement(item)}>
                  <Pencil size={14} />
                </button>
                <button className="danger" onClick={() => void deleteAnnouncement(item.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
          {!announcements.length && <div className="empty-table">No hay anuncios todavía.</div>}
        </div>
      </section>
      <AnimatePresence>
        {editing && (
          <Modal
            eyebrow="PLANIFICACIÓN"
            title={editing === "new" ? "Nuevo evento" : "Editar evento"}
            onClose={() => setEditing(null)}
          >
            <form className="form-grid" onSubmit={submit}>
              <label className="span-2">
                <span>Título *</span>
                <input
                  name="title"
                  required
                  autoFocus
                  defaultValue={editing === "new" ? "" : editing.title}
                />
              </label>
              <label>
                <span>Tipo</span>
                <select
                  name="eventType"
                  defaultValue={editing === "new" ? "class" : editing.eventType}
                >
                  {Object.entries(eventLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Recordar antes</span>
                <select
                  name="reminderDays"
                  defaultValue={editing === "new" ? 1 : editing.reminderDays}
                >
                  <option value="0">El mismo día</option>
                  <option value="1">1 día</option>
                  <option value="2">2 días</option>
                  <option value="7">1 semana</option>
                </select>
              </label>
              <label>
                <span>Inicio *</span>
                <input
                  name="startsAt"
                  type="datetime-local"
                  required
                  defaultValue={editing === "new" ? "" : editing.startsAt.slice(0, 16)}
                />
              </label>
              <label>
                <span>Fin</span>
                <input
                  name="endsAt"
                  type="datetime-local"
                  defaultValue={editing === "new" ? "" : editing.endsAt?.slice(0, 16)}
                />
              </label>
              <label className="span-2">
                <span>Descripción</span>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={editing === "new" ? "" : editing.description}
                />
              </label>
              <div className="form-actions span-2">
                <button className="primary-button">
                  <BellRing size={16} />
                  Guardar evento
                </button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {announcement && (
          <Modal
            eyebrow="ANUNCIOS"
            title={announcement === "new" ? "Nuevo anuncio" : "Editar anuncio"}
            onClose={() => setAnnouncement(null)}
          >
            <form className="form-grid" onSubmit={submitAnnouncement}>
              <label className="span-2">
                <span>Título *</span>
                <input
                  name="title"
                  required
                  autoFocus
                  defaultValue={announcement === "new" ? "" : announcement.title}
                />
              </label>
              <label className="span-2">
                <span>Mensaje *</span>
                <textarea
                  name="body"
                  required
                  rows={5}
                  defaultValue={announcement === "new" ? "" : announcement.body}
                />
              </label>
              <label className="check-label span-2">
                <input
                  name="published"
                  type="checkbox"
                  defaultChecked={announcement === "new" || announcement.published}
                />
                <span>Publicar anuncio</span>
              </label>
              <div className="form-actions span-2">
                <button className="primary-button">Guardar anuncio</button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
