import { MousePointer2, Pin } from "lucide-react";
import { DemoFrame } from "./DemoFrame";

const swatches = ["#FFF2A8", "#FFD6DE", "#D9F7D6", "#D9E8FF", "#E8DDFF"];

/** Una nota flotante que se mueve sobre el escritorio y cambia de color. */
export function FloatingNoteDemo({ paused }: { paused: boolean }) {
  return (
    <DemoFrame paused={paused} note="Animación de ejemplo: no crea ninguna nota.">
      <div aria-hidden="true" className="absolute inset-0">
        <div className="demo-window absolute left-[6%] top-[10%] h-[58%] w-[54%] p-2">
          <div className="demo-traffic"><span /><span /><span /></div>
          <div className="mt-3 space-y-1.5">
            {[82, 64, 74, 48, 70].map((width) => (
              <div key={width} className="h-1.5 rounded-full bg-[var(--line-strong)]" style={{ width: `${width}%` }} />
            ))}
          </div>
        </div>
        <div className="demo-window absolute bottom-[8%] right-[6%] h-[44%] w-[40%] p-2">
          <div className="demo-traffic"><span /><span /><span /></div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-6 rounded bg-[var(--line)]" />)}
          </div>
        </div>
        <div className="demo-note absolute left-[18%] top-[30%] w-[34%] min-w-36">
          <div className="demo-note-surface rounded-lg border border-black/10 p-2.5 text-slate-800 shadow-[0_14px_30px_rgba(20,25,45,0.25)]" style={{ backgroundColor: swatches[0] }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold">Ideas para la reunión</span>
              <span className="flex items-center gap-0.5 rounded bg-black/5 px-1 py-0.5 text-[7px] text-slate-600"><Pin className="size-2" /> Encima</span>
            </div>
            <div className="mt-2 space-y-1">
              <div className="demo-note-line h-1.5 w-[88%] rounded-full bg-slate-700/30" />
              <div className="demo-note-line h-1.5 w-[70%] rounded-full bg-slate-700/30" />
              <div className="demo-note-line h-1.5 w-[54%] rounded-full bg-slate-700/30" />
            </div>
            <div className="mt-2.5 flex gap-1">
              {swatches.map((color) => <span key={color} className="size-2.5 rounded-full border border-black/10" style={{ backgroundColor: color }} />)}
            </div>
          </div>
          <MousePointer2 className="demo-cursor absolute -right-1 top-1 size-4 fill-white text-slate-900 drop-shadow" />
        </div>
      </div>
      <p className="absolute bottom-2 left-3 rounded-md bg-black/45 px-2 py-1 text-[9px] text-white backdrop-blur">Arrástrala por la cabecera · Se guarda sola</p>
    </DemoFrame>
  );
}
