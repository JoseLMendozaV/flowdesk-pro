import { ArrowRight, Compass, History } from "lucide-react";
import { WelcomeIllustration } from "../components/WelcomeIllustration";
import { featureIcons, toneClasses } from "../components/featureVisuals";
import type { FeatureDefinition } from "../registry/types";

type WelcomeScreenProps = {
  features: FeatureDefinition[];
  firstRun: boolean;
  onStart: () => void;
  onExplore: () => void;
  /** Función donde se dejó el recorrido, si «Continuar donde lo dejé» está activo. */
  resumeTitle: string | null;
  onResume: () => void;
};

export function WelcomeScreen({ features, firstRun, onStart, onExplore, resumeTitle, onResume }: WelcomeScreenProps) {
  const dashboard = features.find((feature) => feature.id === "dashboard")?.image;
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.05fr)_minmax(300px,1fr)] gap-7 p-7">
      <WelcomeIllustration dashboard={dashboard} />
      {/* Centrado con márgenes automáticos: con `justify-center` el desbordamiento recortaría el título. */}
      <div className="flex min-h-0 flex-col overflow-y-auto">
        <div className="my-auto py-2">
          <h1 tabIndex={-1} data-step-heading className="text-[25px] font-semibold leading-tight tracking-[-0.03em] outline-none">
            ¡Bienvenido a FlowDesk Pro!
          </h1>
          <p className="mt-2 text-[15px] font-medium text-[var(--accent)]">Tu espacio de productividad, organizado en un solo lugar.</p>
          <p className="mt-3 text-[13px] leading-6 text-[var(--muted)]">
            Descubre cómo organizar tus tareas, administrar proyectos, crear notas flotantes y aprovechar las herramientas disponibles para trabajar de manera más eficiente.
          </p>
          <ul aria-label="Incluye" className="mt-4 flex flex-wrap gap-1.5">
            {features.map((feature) => {
              const Icon = featureIcons[feature.icon];
              return (
                <li key={feature.id} className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1 pl-1 pr-2.5 text-[11px]">
                  <span className={`grid size-5 place-items-center rounded-full ${toneClasses[feature.tone]}`}><Icon className="size-3" /></span>
                  {feature.title}
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <button type="button" autoFocus onClick={onStart} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(97,125,232,0.35)] transition hover:brightness-105">
              Comenzar recorrido <ArrowRight className="size-4" />
            </button>
            <button type="button" onClick={onExplore} className="flex items-center gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-5 py-3 text-[13px] font-medium transition hover:bg-[var(--hover)]">
              <Compass className="size-4 text-[var(--muted)]" /> {firstRun ? "Explorar por mi cuenta" : "Cerrar"}
            </button>
          </div>
          {resumeTitle && (
            <button type="button" onClick={onResume} className="mt-3 flex items-center gap-1.5 rounded-lg px-1 py-1 text-[12px] font-medium text-[var(--accent)] hover:underline">
              <History className="size-3.5" /> Continuar donde lo dejé: {resumeTitle}
            </button>
          )}
          <p className="mt-4 text-[11px] leading-5 text-[var(--muted)]">
            {features.length} funciones · unos {Math.max(2, Math.round(features.length * 0.4))} minutos. Puedes volver cuando quieras desde Ayuda → Recorrido por FlowDesk.
          </p>
        </div>
      </div>
    </div>
  );
}
