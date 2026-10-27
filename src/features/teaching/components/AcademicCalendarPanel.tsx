import { FormEvent, useState } from "react";
import { CalendarOff, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { AnimatePresence } from "../lib/motion";
import { academicKinds, academicSources, changeMessage, rangeLabel, todayIso } from "../lib/academic";
import { api } from "../lib/api";
import { useAppActions } from "../lib/app-context";
import type { AcademicDay, AcademicDayKind } from "../types";
import { Modal } from "./Modal";

type Props = { days: AcademicDay[] | null; onChanged: () => Promise<void> };

/**
 * Feriados, días libres, exámenes y periodos de clases. Lo que suspende clases se quita
 * del horario en el calendario y de las sesiones de asistencia vacías.
 */
export function AcademicCalendarPanel({ days, onChanged }: Props) {
  const { run, notify } = useAppActions();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<AcademicDay | "new" | null>(null);
  const today = todayIso();
  const all = days ?? [];
  const visible = showAll ? all : all.filter((day) => day.endsOn >= today);
  const hasOfficial = all.some((day) => day.source !== "user");

  async function loadOfficial() {
    await run(async () => {
      const change = await api.loadOfficialCalendar();
      await onChanged();
      notify(
        changeMessage(
          change,
          change.added
            ? `Calendario cargado: ${change.added} ${change.added === 1 ? "día nuevo" : "días nuevos"}.`
            : "El calendario ya estaba al día.",
        ),
      );
    });
  }

  async function remove(day: AcademicDay) {
    if (!confirm(`¿Quitar «${day.title}» del calendario académico?${day.cancelsClasses ? " Sus clases vuelven al horario." : ""}`)) return;
    await run(async () => {
      const change = await api.deleteAcademicDay(day.id);
      await onChanged();
      notify(changeMessage(change, "Día quitado."));
    });
  }

  // Agrupados por mes del inicio.
  const months = new Map<string, AcademicDay[]>();
  for (const day of visible) {
    const key = day.startsOn.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), day]);
  }

  return (
    <section className="panel academic-panel" aria-label="Calendario académico">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CALENDARIO ACADÉMICO</span>
          <h3>Feriados y días sin clases</h3>
        </div>
        <div className="toolbar-actions">
          {all.length > 0 && (
            <div className="segmented" role="radiogroup" aria-label="Días que se muestran">
              <button role="radio" aria-checked={!showAll} className={showAll ? "" : "active"} onClick={() => setShowAll(false)}>
                Próximos
              </button>
              <button role="radio" aria-checked={showAll} className={showAll ? "active" : ""} onClick={() => setShowAll(true)}>
                Todos
              </button>
            </div>
          )}
          <button className="secondary-button" onClick={() => void loadOfficial()} title="Feriados nacionales de Panamá de este año y el próximo, y el calendario académico 2026-2027 de la UTP">
            <Download size={15} />
            {hasOfficial ? "Actualizar feriados y UTP" : "Cargar feriados y calendario UTP"}
          </button>
          <button className="secondary-button" onClick={() => setEditing("new")}>
            <Plus size={15} />
            Añadir día
          </button>
        </div>
      </div>
      <p className="schedule-hint">
        En los días sin clases, las clases desaparecen del calendario y de los avisos, y no se crean sesiones de asistencia. Las sesiones de esos días que ya tienen asistencia se conservan.
      </p>
      {days && !all.length ? (
        <div className="feature-empty">
          <CalendarOff />
          <h3>Sin días libres todavía</h3>
          <p>Carga los feriados de Panamá y el calendario de la UTP (exámenes, días libres y fechas de cada semestre) o añade los tuyos.</p>
        </div>
      ) : !visible.length ? (
        <div className="empty-table">No quedan días por delante. Pulsa «Todos» para ver los pasados.</div>
      ) : (
        <div className="academic-months">
          {[...months].map(([month, items]) => (
            <div key={month} className="academic-month">
              <h4>{new Date(`${month}-01T12:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</h4>
              <ul>
                {items.map((day) => {
                  const past = day.endsOn < today;
                  return (
                    <li key={day.id} className={`academic-day kind-${day.kind} ${past ? "past" : ""}`}>
                      <span className="academic-date">{rangeLabel(day.startsOn, day.endsOn)}</span>
                      <span className="academic-main">
                        <strong>{day.title}</strong>
                        <small>
                          {academicKinds[day.kind].label}
                          {day.cancelsClasses ? " · sin clases" : ""}
                          {" · "}
                          {academicSources[day.source]}
                        </small>
                      </span>
                      <div className="row-actions">
                        <button title="Editar" onClick={() => setEditing(day)}>
                          <Pencil size={14} />
                        </button>
                        <button className="danger" title="Quitar" onClick={() => void remove(day)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <AnimatePresence>
        {editing && (
          <DayModal
            day={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={async (message) => {
              await onChanged();
              setEditing(null);
              notify(message);
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function DayModal({ day, onClose, onSaved }: { day: AcademicDay | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const { run } = useAppActions();
  const [kind, setKind] = useState<AcademicDayKind>(day?.kind ?? "break");
  const [cancels, setCancels] = useState(day?.cancelsClasses ?? true);
  const [startsOn, setStartsOn] = useState(day?.startsOn ?? todayIso());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const change = await api.saveAcademicDay({
        id: day?.id ?? null,
        title: String(form.get("title") ?? ""),
        kind,
        startsOn,
        endsOn: String(form.get("endsOn") ?? "") || startsOn,
        cancelsClasses: cancels,
      });
      await onSaved(changeMessage(change, "Calendario académico guardado."));
    });
  }

  return (
    <Modal eyebrow="CALENDARIO ACADÉMICO" title={day ? "Editar día" : "Nuevo día sin clases"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          <span>Nombre *</span>
          <input name="title" required autoFocus defaultValue={day?.title ?? ""} placeholder="Semana de receso, jornada de investigación…" />
        </label>
        <label>
          <span>Tipo</span>
          <select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as AcademicDayKind;
              setKind(next);
              setCancels(academicKinds[next].cancels);
            }}
          >
            {(Object.keys(academicKinds) as AcademicDayKind[]).map((value) => (
              <option key={value} value={value}>
                {academicKinds[value].label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-label academic-cancels">
          <input type="checkbox" checked={cancels} onChange={(event) => setCancels(event.target.checked)} />
          <span>Suspende las clases</span>
        </label>
        <label>
          <span>Desde *</span>
          <input type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
        </label>
        <label>
          <span>Hasta</span>
          <input name="endsOn" type="date" min={startsOn} defaultValue={day?.endsOn ?? ""} />
        </label>
        <p className="muted-text span-2">Un solo día: deja «Hasta» vacío. Los periodos de clases no aparecen en el calendario; sirven para proponer las fechas del horario.</p>
        <div className="form-actions span-2">
          <button className="primary-button">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
