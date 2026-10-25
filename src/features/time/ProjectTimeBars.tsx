import { formatDuration } from "../../services/format";
import type { ProjectTime } from "../../types/focus";

/** Magnitud por proyecto: un solo color de serie; la identidad del proyecto va en el punto. */
export function ProjectTimeBars({ projects }: { projects: ProjectTime[] }) {
  const max = Math.max(1, ...projects.map((project) => project.seconds));
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
      <h2 className="text-sm font-semibold">Tiempo por proyecto</h2>
      <p className="mt-0.5 text-[10px] text-[var(--muted)]">Semana actual</p>
      {projects.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--line)] px-3 py-8 text-center text-[11px] text-[var(--muted)]">Sin tiempo asignado esta semana.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {projects.map((project) => (
            <li key={project.projectId ?? "none"}>
              <div className="mb-1 flex items-center gap-2 text-[11px]">
                <span className="size-2 flex-none rounded-full" style={{ backgroundColor: project.color ?? "var(--muted)" }} />
                <span className="min-w-0 flex-1 truncate">{project.name ?? "Sin proyecto"}</span>
                <span className="tabular-nums text-[var(--muted)]">{formatDuration(project.seconds)}</span>
              </div>
              <div className="h-2 rounded-r-[4px] bg-[var(--track)]">
                <div className="h-full rounded-r-[4px]" style={{ width: `${(project.seconds / max) * 100}%`, backgroundColor: "var(--series-1)" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
