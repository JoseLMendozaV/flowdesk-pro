import { CheckCircle2 } from "lucide-react";
import logo from "../../../assets/flowdesk-logo.png";
import type { FeatureScreenshot } from "../registry/types";

/**
 * Composición con la identidad de FlowDesk: el logotipo, una captura real del
 * dashboard y dos elementos reconocibles de la app (nota flotante y Pomodoro).
 */
export function WelcomeIllustration({ dashboard }: { dashboard?: FeatureScreenshot }) {
  return (
    <div aria-hidden="true" className="demo-desktop relative h-full min-h-72 overflow-hidden rounded-2xl border border-[var(--line)]">
      <div className="absolute -left-10 -top-12 size-56 rounded-full bg-white/25 blur-3xl dark:bg-indigo-400/10" />
      <img src={logo} alt="" draggable={false} className="absolute left-6 top-6 size-14 drop-shadow-[0_10px_24px_rgba(104,125,239,.45)]" />
      {dashboard && (
        <div className="absolute left-[16%] top-[30%] w-[135%] overflow-hidden rounded-xl border border-white/40 shadow-[0_30px_70px_rgba(20,25,45,0.35)] dark:border-white/10" style={{ aspectRatio: dashboard.aspect }}>
          <picture>
            <source srcSet={dashboard.dark} media="(prefers-color-scheme: dark)" />
            <img src={dashboard.light} alt="" draggable={false} className="h-full w-full object-cover object-left-top" />
          </picture>
        </div>
      )}
      <div className="absolute bottom-[9%] left-[6%] w-[34%] min-w-32 rotate-[-4deg] rounded-lg border border-black/10 bg-[#FFF2A8] p-2.5 text-slate-800 shadow-[0_16px_34px_rgba(20,25,45,0.3)]">
        <p className="text-[10px] font-semibold">Para hoy</p>
        <ul className="mt-1.5 space-y-1 text-[9px]">
          <li className="flex items-center gap-1"><CheckCircle2 className="size-2.5 text-emerald-600" /> Revisar borrador</li>
          <li className="flex items-center gap-1"><span className="size-2.5 rounded-full border border-slate-500/60" /> Clase del jueves</li>
        </ul>
      </div>
      <div className="absolute right-[7%] top-[9%] grid size-20 place-items-center rounded-full bg-[var(--surface)] shadow-[0_16px_34px_rgba(20,25,45,0.25)]">
        <div className="grid size-[68px] place-items-center rounded-full" style={{ background: "conic-gradient(var(--accent) 252deg, var(--track) 0deg)" }}>
          <div className="grid size-[56px] place-items-center rounded-full bg-[var(--surface)] text-center">
            <span className="text-[13px] font-semibold tabular-nums leading-none">18:00</span>
          </div>
        </div>
      </div>
    </div>
  );
}
