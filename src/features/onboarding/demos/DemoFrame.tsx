import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";

/** Marco común: deja claro que nada de lo que ocurre aquí toca datos reales. */
export function DemoFrame({ paused, note, children }: { paused: boolean; note: string; children: ReactNode }) {
  return (
    <figure className="flex h-full flex-col gap-2" data-paused={paused}>
      <div className="demo-desktop relative min-h-0 flex-1 rounded-xl border border-[var(--line-strong)] shadow-[0_18px_50px_rgba(20,25,45,0.16)]">
        {children}
      </div>
      <figcaption className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
        <FlaskConical className="size-3 flex-none" />
        {note}
      </figcaption>
    </figure>
  );
}
