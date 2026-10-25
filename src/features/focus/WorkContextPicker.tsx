import { useEffect, useState } from "react";
import { useDataChanged } from "../../hooks/useDataChanged";
import { flowdeskApi } from "../../services/flowdeskApi";
import type { ProjectSummary } from "../../types/projects";
import type { TaskSummary } from "../../types/tasks";

export type WorkSelection = { taskId: string; projectId: string };

type WorkContextPickerProps = {
  value: WorkSelection;
  onChange: (value: WorkSelection) => void;
  className?: string;
};

const selectClass =
  "min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--input)] px-2.5 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]";

/** Selección opcional de tarea y proyecto. Elegir una tarea fija también su proyecto. */
export function WorkContextPicker({ value, onChange, className = "" }: WorkContextPickerProps) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  const load = () => {
    void flowdeskApi.tasks({ view: "all", sort: "due" }).then(setTasks).catch(() => setTasks([]));
    void flowdeskApi.projects(false).then(setProjects).catch(() => setProjects([]));
  };
  useEffect(load, []);
  useDataChanged(["tasks", "projects"], load);

  return (
    <div className={`flex gap-2 ${className}`}>
      <select
        value={value.taskId}
        aria-label="Tarea"
        onChange={(event) => {
          const task = tasks.find((item) => item.id === event.target.value);
          onChange({ taskId: event.target.value, projectId: task?.projectId ?? value.projectId });
        }}
        className={selectClass}
      >
        <option value="">Sin tarea</option>
        {value.taskId && !tasks.some((task) => task.id === value.taskId) && <option value={value.taskId}>Tarea actual</option>}
        {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
      </select>
      <select
        value={value.projectId}
        aria-label="Proyecto"
        disabled={Boolean(value.taskId && tasks.find((task) => task.id === value.taskId)?.projectId)}
        onChange={(event) => onChange({ ...value, projectId: event.target.value })}
        className={`${selectClass} disabled:opacity-60`}
      >
        <option value="">Sin proyecto</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </div>
  );
}
