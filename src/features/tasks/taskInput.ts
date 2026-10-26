import type { TaskDetail, TaskInput } from "../../types/tasks";

/** Todos los campos editables de una tarea, para cambiar solo algunos (por ejemplo, al arrastrarla). */
export function inputFromTask(task: TaskDetail): TaskInput {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    dueHasTime: task.dueHasTime,
    startsAt: task.startsAt,
    projectId: task.projectId,
    estimatedMinutes: task.estimatedMinutes,
    tags: task.tags.map((tag) => tag.name),
    recurrence: task.recurrence,
  };
}
