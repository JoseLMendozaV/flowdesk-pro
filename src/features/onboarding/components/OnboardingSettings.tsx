import { useState } from "react";
import { CircleHelp, Keyboard, LayoutGrid, MousePointerClick, Play, RotateCcw, Sparkles } from "lucide-react";
import { flowdeskApi } from "../../../services/flowdeskApi";
import { useOnboardingData } from "../hooks/useOnboardingData";

type OnboardingSettingsProps = {
  /** La visita guiada necesita cerrar Configuración; no se hace con cambios sin guardar. */
  canLeave: boolean;
  onLeave: () => void;
};

/** Sección «Ayuda y bienvenida». Las casillas se guardan al momento, como Recordatorios. */
export function OnboardingSettings({ canLeave, onLeave }: OnboardingSettingsProps) {
  const { state, error, setError, updatePreferences } = useOnboardingData();
  const [confirmingReset, setConfirmingReset] = useState(false);
  if (!state) return error ? <p className="text-[10px] text-red-500">{error}</p> : null;

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }

  const options = [
    {
      key: "showWelcomeOnStartup" as const,
      label: "Mostrar bienvenida al abrir FlowDesk",
      hint: "Se abre cada vez que abres FlowDesk hasta que la desactives aquí o con «No volver a mostrar». Nunca aparece al iniciar oculto con macOS.",
    },
    {
      key: "showWhatsNewOnUpdate" as const,
      label: "Mostrar novedades después de actualizar",
      hint: "Tras una actualización, enseña solo las funciones nuevas o mejoradas que aún no conoces.",
    },
    {
      key: "resumeTour" as const,
      label: "Continuar tutorial donde lo dejé",
      hint: "El recorrido completo empieza en el último paso que viste.",
    },
  ];
  const actions = [
    { label: "Iniciar recorrido completo", icon: Play, onClick: () => run(() => flowdeskApi.openOnboarding("tour")) },
    { label: "Ver funcionalidades disponibles", icon: LayoutGrid, onClick: () => run(() => flowdeskApi.openOnboarding("features")) },
    { label: "Consultar novedades", icon: Sparkles, onClick: () => run(() => flowdeskApi.openOnboarding("whats-new")) },
    { label: "Revisar atajos de teclado", icon: Keyboard, onClick: () => run(() => flowdeskApi.openOnboarding("shortcuts")) },
  ];

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-sky-500/10 text-sky-500"><CircleHelp className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-xs font-medium">Ayuda y bienvenida</strong>
          <small className="mt-0.5 block text-[10px] leading-4 text-[var(--muted)]">El recorrido también está en la barra de menús: Ayuda → Recorrido por FlowDesk.</small>
        </span>
      </div>
      <div className="mt-2.5 space-y-2 border-t border-[var(--line)] pt-2.5">
        {options.map((option) => (
          <label key={option.key} className="flex cursor-pointer items-start gap-2 text-[11px]">
            <input type="checkbox" checked={state[option.key]} onChange={(event) => void updatePreferences({ [option.key]: event.target.checked })} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              {option.label}
              <small className="block text-[10px] leading-4 text-[var(--muted)]">{option.hint}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 border-t border-[var(--line)] pt-2.5">
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button key={label} type="button" onClick={() => void onClick()} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-left text-[10px] hover:border-[var(--line-strong)]">
            <Icon className="size-3 flex-none text-[var(--accent)]" /> {label}
          </button>
        ))}
        <button
          type="button"
          disabled={!canLeave}
          title={canLeave ? undefined : "Guarda o cancela los cambios de Configuración primero"}
          onClick={() => {
            onLeave();
            void run(() => flowdeskApi.startGuidedTour());
          }}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-left text-[10px] hover:border-[var(--line-strong)] disabled:opacity-50"
        >
          <MousePointerClick className="size-3 flex-none text-[var(--accent)]" /> Visita guiada por la interfaz
        </button>
        {confirmingReset ? (
          <span className="flex items-center gap-1 text-[10px]">
            ¿Reiniciar?
            <button type="button" onClick={() => void run(async () => { await flowdeskApi.resetOnboarding(); setConfirmingReset(false); await flowdeskApi.openOnboarding("welcome"); })} className="rounded-md bg-[var(--accent)] px-2 py-1 font-medium text-white">Sí</button>
            <button type="button" onClick={() => setConfirmingReset(false)} className="rounded-md px-1.5 py-1 text-[var(--muted)] hover:bg-[var(--hover)]">No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmingReset(true)} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-left text-[10px] hover:border-[var(--line-strong)]">
            <RotateCcw className="size-3 flex-none text-[var(--accent)]" /> Reiniciar tutorial
          </button>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Reiniciar vuelve a la bienvenida desde el principio. Las novedades que ya viste no se repiten.</p>
      {error && <p className="mt-2 text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
