import type { EventScope } from "../../types/calendar";

type ScopeChoicesProps = {
  question: string;
  /** «Solo este evento» no tiene sentido si se cambió la regla. */
  allowThis: boolean;
  /** En la primera repetición, «Este y los siguientes» equivale a «Todos». */
  allowFollowing: boolean;
  onChoose: (scope: EventScope) => void;
  onCancel: () => void;
};

const buttonClass = "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-[var(--accent)]";

/** Pregunta a qué repeticiones de un evento se aplica un cambio o un borrado. */
export function ScopeChoices({ question, allowThis, allowFollowing, onChoose, onCancel }: ScopeChoicesProps) {
  return (
    <div role="group" aria-label="A qué eventos se aplica" className="rounded-xl border border-[var(--line-strong)] bg-[var(--inset)] p-3">
      <p className="mb-2 text-[11px] font-medium">{question}</p>
      <div className="flex flex-wrap gap-1.5">
        {allowThis && <button type="button" onClick={() => onChoose("this")} className={buttonClass}>Solo este evento</button>}
        {allowFollowing && <button type="button" onClick={() => onChoose("following")} className={buttonClass}>Este y los siguientes</button>}
        <button type="button" onClick={() => onChoose("all")} className={buttonClass}>Todos los eventos</button>
        <button type="button" onClick={onCancel} className="rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]">Cancelar</button>
      </div>
    </div>
  );
}
