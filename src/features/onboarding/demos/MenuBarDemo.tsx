import { useEffect, useState } from "react";
import { ChevronRight, LogOut, X } from "lucide-react";
import logo from "../../../assets/flowdesk-logo.png";
import { DemoFrame } from "./DemoFrame";

const menuItems = ["Abrir FlowDesk", "Nueva tarea", "Nueva nota flotante", "Iniciar o pausar Pomodoro"];

/** El icono de la barra de menús con su menú, y la diferencia entre cerrar y salir. */
export function MenuBarDemo({ paused }: { paused: boolean }) {
  const [menuOpen, setMenuOpen] = useState(true);
  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => setMenuOpen((value) => !value), 3200);
    return () => window.clearInterval(interval);
  }, [paused]);

  return (
    <DemoFrame paused={paused} note="Recreación del menú real de la barra de menús.">
      <div className="absolute inset-x-0 top-0 flex h-6 items-center justify-end gap-3 bg-white/55 px-3 text-[9px] font-medium text-slate-800 backdrop-blur dark:bg-black/45 dark:text-white/90">
        <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="Icono de FlowDesk en la barra de menús" className={`flex items-center gap-1 rounded px-1 py-0.5 ${menuOpen ? "bg-black/10 dark:bg-white/15" : ""}`}>
          <img src={logo} alt="" className="size-3.5" draggable={false} />
          18m
        </button>
        <span>jue 10:30</span>
      </div>
      {menuOpen && (
        <div className="demo-menu-pop absolute right-12 top-7 w-48 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] p-1 text-[10px] shadow-2xl">
          {menuItems.map((item) => <div key={item} className="rounded px-2 py-1 hover:bg-[var(--accent)] hover:text-white">{item}</div>)}
          <div className="my-1 h-px bg-[var(--line)]" />
          <div className="flex items-center justify-between rounded px-2 py-1">Ayuda <ChevronRight className="size-3 text-[var(--muted)]" /></div>
          <div className="my-1 h-px bg-[var(--line)]" />
          <div className="rounded px-2 py-1">Salir de FlowDesk</div>
        </div>
      )}
      <div className="absolute bottom-[8%] left-[5%] grid w-[52%] gap-2">
        <div className="demo-window flex items-start gap-2 p-2.5">
          <span className="grid size-5 flex-none place-items-center rounded-full bg-red-500 text-white"><X className="size-3" /></span>
          <span>
            <strong className="block text-[10px]">Cerrar la ventana</strong>
            <span className="block text-[9px] leading-4 text-[var(--muted)]">FlowDesk sigue activo en la barra de menús: temporizadores, avisos y notas siguen funcionando.</span>
          </span>
        </div>
        <div className="demo-window flex items-start gap-2 p-2.5">
          <span className="grid size-5 flex-none place-items-center rounded-full bg-slate-700 text-white"><LogOut className="size-3" /></span>
          <span>
            <strong className="block text-[10px]">Salir de FlowDesk</strong>
            <span className="block text-[9px] leading-4 text-[var(--muted)]">Cierra la app por completo y guarda los temporizadores en pausa.</span>
          </span>
        </div>
      </div>
    </DemoFrame>
  );
}
