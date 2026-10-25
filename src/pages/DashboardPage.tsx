import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  CheckSquare2,
  Clock3,
  FolderKanban,
  PanelRight,
  Plus,
  RotateCw,
  Sparkles,
  StickyNote,
  Timer,
} from "lucide-react";
import { MetricCard } from "../components/MetricCard";
import { CompactTimer } from "../features/focus/CompactTimer";
import { useDashboard } from "../features/dashboard/useDashboard";
import { useAppStore } from "../stores/appStore";
import { flowdeskApi } from "../services/flowdeskApi";
import { describeDue, formatDuration } from "../services/format";
import type { DashboardSummary } from "../types/dashboard";

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const timeFormatter = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
});

function greeting(date: Date) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 13) return "Buenos días";
  if (hour >= 13 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-[var(--line)] px-5 text-center text-[11px] leading-5 text-[var(--muted)]">
      {children}
    </div>
  );
}

function DashboardContent({ data }: { data: DashboardSummary }) {
  const openQuickTask = useAppStore((state) => state.openQuickTask);
  const openTasks = useAppStore((state) => state.openTasks);
  const selectSection = useAppStore((state) => state.selectSection);
  const refreshDashboard = useAppStore((state) => state.refreshDashboard);
  const percentage = Math.round(data.completionPercent);

  async function complete(taskId: string) {
    await flowdeskApi.setTaskStatus(taskId, "completed");
    refreshDashboard();
  }

  return (
    <div className="space-y-5">
      <section aria-label="Métricas diarias" className="grid grid-cols-4 gap-3">
        <MetricCard
          label="Tareas de hoy"
          value={data.todayTasks}
          hint={data.overdueTasks ? `${data.overdueTasks} vencidas` : "Nada vencido"}
          icon={CheckSquare2}
          tone="blue"
        />
        <MetricCard
          label="Completadas"
          value={data.completedToday}
          hint={`${percentage}% del objetivo diario`}
          icon={CheckCircle2}
          tone="green"
        />
        <MetricCard
          label="Proyectos activos"
          value={data.activeProjects}
          hint="En curso ahora"
          icon={FolderKanban}
          tone="violet"
        />
        <MetricCard
          label="Tiempo registrado"
          value={formatDuration(data.trackedSecondsToday)}
          hint={`${formatDuration(data.focusSecondsToday)} de concentración`}
          icon={Clock3}
          tone="orange"
        />
      </section>

      <section className="grid grid-cols-[minmax(0,1.45fr)_minmax(220px,.8fr)] gap-4">
        <article className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.01em]">Próximas tareas</h2>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">Ordenadas por fecha límite</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openTasks("today")}
                className="rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              >
                Ver todas
              </button>
              <button
                type="button"
                onClick={openQuickTask}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--accent)] transition hover:brightness-95"
              >
                <Plus className="size-3.5" /> Nueva tarea
              </button>
            </div>
          </div>
          {data.upcomingTasks.length === 0 ? (
            <EmptyState>
              <span>
                No hay tareas con fecha límite.
                <br />
                Crea la primera para empezar a organizar tu día.
              </span>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {data.upcomingTasks.map((task) => {
                const due = task.dueAt ? describeDue(task.dueAt, task.dueHasTime) : null;
                return (
                  <li key={task.id} className="group flex items-center gap-3 py-3 first:pt-1">
                    <button
                      type="button"
                      onClick={() => void complete(task.id)}
                      aria-label={`Completar “${task.title}”`}
                      className="grid size-4 flex-none place-items-center rounded-full border border-[var(--line-strong)] text-transparent transition hover:border-emerald-500 hover:text-emerald-500"
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </button>
                    {task.projectColor && <span className="size-1.5 flex-none rounded-full" style={{ backgroundColor: task.projectColor }} />}
                    <button type="button" onClick={() => openTasks("today")} className="min-w-0 flex-1 truncate text-left text-xs font-medium">
                      {task.title}
                    </button>
                    {due && (
                      <time className={`text-[10px] ${due.overdue ? "font-medium text-red-500" : "text-[var(--muted)]"}`}>
                        {due.label}
                      </time>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--card-shadow)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Ritmo diario</h2>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">Cumplimiento de hoy</p>
            </div>
            <Sparkles className="size-4 text-violet-500" />
          </div>
          <div className="mx-auto my-5 grid size-28 place-items-center rounded-full p-[9px]" style={{ background: `conic-gradient(var(--accent) ${percentage * 3.6}deg, var(--track) 0deg)` }}>
            <div className="grid size-full place-items-center rounded-full bg-[var(--surface)] text-center">
              <div>
                <div className="text-2xl font-semibold tracking-[-0.05em]">{percentage}%</div>
                <div className="text-[9px] text-[var(--muted)]">completado</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-[var(--inset)] px-2 py-2">
              <div className="text-xs font-semibold">{data.completedToday}</div>
              <div className="text-[9px] text-[var(--muted)]">hechas</div>
            </div>
            <div className="rounded-lg bg-[var(--inset)] px-2 py-2">
              <div className="text-xs font-semibold">{data.todayTasks}</div>
              <div className="text-[9px] text-[var(--muted)]">pendientes</div>
            </div>
          </div>
        </article>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Acciones rápidas</h2>
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">Captura lo importante sin perder el hilo</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <button type="button" onClick={openQuickTask} className="quick-action">
            <span className="quick-action-icon bg-blue-500/10 text-blue-500"><CheckSquare2 /></span>
            <span><strong>Nueva tarea</strong><small>Añadir a tu lista de hoy</small></span>
            <ArrowRight className="ml-auto size-3.5 text-[var(--muted)]" />
          </button>
          <button type="button" onClick={() => void flowdeskApi.createNote()} className="quick-action">
            <span className="quick-action-icon bg-amber-500/10 text-amber-500"><StickyNote /></span>
            <span><strong>Nota flotante</strong><small>Abrir una nota nueva</small></span>
            <ArrowRight className="ml-auto size-3.5 text-[var(--muted)]" />
          </button>
          <button type="button" onClick={() => selectSection("focus")} className="quick-action">
            <span className="quick-action-icon bg-violet-500/10 text-violet-500"><Timer /></span>
            <span><strong>Concentración</strong><small>Pomodoro y descansos</small></span>
            <ArrowRight className="ml-auto size-3.5 text-[var(--muted)]" />
          </button>
        </div>
      </section>
    </div>
  );
}

function RightPanel({ data }: { data: DashboardSummary }) {
  const selectSection = useAppStore((state) => state.selectSection);
  return (
    <aside className="overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] px-4 pb-5 pt-5">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="size-3.5 text-[var(--accent)]" />
          <h2 className="text-xs font-semibold">Próximo compromiso</h2>
        </div>
        {data.nextEvent ? (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <p className="text-xs font-medium">{data.nextEvent.title}</p>
            <time className="mt-1 block text-[10px] text-[var(--muted)]">
              {timeFormatter.format(new Date(data.nextEvent.startsAt * 1000))}
            </time>
          </div>
        ) : (
          <EmptyState>Tu agenda no tiene compromisos próximos.</EmptyState>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <Timer className="size-3.5 text-violet-500" />
          <h2 className="text-xs font-semibold">Temporizador</h2>
        </div>
        <CompactTimer onOpen={() => selectSection("focus")} />
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <StickyNote className="size-3.5 text-amber-500" />
          <h2 className="text-xs font-semibold">Notas recientes</h2>
        </div>
        {data.recentNotes.length === 0 ? (
          <EmptyState>Aún no hay notas guardadas.</EmptyState>
        ) : (
          <div className="space-y-2">
            {data.recentNotes.map((note) => (
              <article key={note.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
                <h3 className="truncate text-[11px] font-semibold">{note.title || "Sin título"}</h3>
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--muted)]">{note.preview}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

export function DashboardPage() {
  const { data, error, loading, reload } = useDashboard();
  const rightPanelVisible = useAppStore((state) => state.rightPanelVisible);
  const toggleRightPanel = useAppStore((state) => state.toggleRightPanel);
  const openQuickTask = useAppStore((state) => state.openQuickTask);

  return (
    <div className={`grid h-full ${rightPanelVisible ? "grid-cols-[minmax(600px,1fr)_250px]" : "grid-cols-1"}`}>
      <div className="min-w-0 overflow-y-auto">
        <header data-tauri-drag-region="deep" className="sticky top-0 z-10 flex h-[74px] items-end justify-between border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.025em]">{greeting(new Date())}</h1>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{dateFormatter.format(new Date())}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={openQuickTask} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white shadow-sm hover:brightness-105">
              <Plus className="size-3.5" /> Nueva tarea
            </button>
            <button type="button" onClick={toggleRightPanel} aria-label={rightPanelVisible ? "Ocultar panel lateral" : "Mostrar panel lateral"} className="grid size-8 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]">
              <PanelRight className="size-4" />
            </button>
          </div>
        </header>

        <div className="p-6">
          {loading && !data ? (
            <div className="grid min-h-[420px] place-items-center text-xs text-[var(--muted)]">
              <RotateCw className="mb-2 size-5 animate-spin" />
              Cargando datos locales…
            </div>
          ) : error ? (
            <div className="mx-auto mt-20 max-w-sm rounded-2xl border border-red-500/20 bg-red-500/5 p-5 text-center">
              <AlertCircle className="mx-auto mb-2 size-5 text-red-500" />
              <h2 className="text-sm font-semibold">No se pudo leer la base de datos</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">{error}</p>
              <button type="button" onClick={() => void reload()} className="mt-4 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs shadow-sm">Reintentar</button>
            </div>
          ) : data ? (
            <DashboardContent data={data} />
          ) : null}
        </div>
      </div>
      {rightPanelVisible && data && <RightPanel data={data} />}
    </div>
  );
}
