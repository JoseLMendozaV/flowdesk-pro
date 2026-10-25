import { TaskWorkspace } from "../features/tasks/TaskWorkspace";
import { useProjects } from "../features/projects/useProjects";
import { useAppStore } from "../stores/appStore";

export function TasksPage() {
  const view = useAppStore((state) => state.taskView);
  const setView = useAppStore((state) => state.setTaskView);
  const { projects } = useProjects(true);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header data-tauri-drag-region="deep" className="flex h-[74px] flex-none items-end justify-between border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.025em]">Tareas</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Organiza, prioriza y completa tu trabajo</p>
        </div>
      </header>
      <TaskWorkspace view={view} onViewChange={setView} projects={projects} />
    </div>
  );
}
