import type { TaskPriority, TaskSort, TaskStatus, TaskView } from "../../types/tasks";

export const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "pending", label: "Pendiente" },
  { value: "in_progress", label: "En curso" },
  { value: "completed", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
];

export const priorityOptions: { value: TaskPriority; label: string; className: string }[] = [
  { value: "urgent", label: "Urgente", className: "text-red-500" },
  { value: "high", label: "Alta", className: "text-orange-500" },
  { value: "medium", label: "Media", className: "text-amber-500" },
  { value: "low", label: "Baja", className: "text-sky-500" },
  { value: "none", label: "Sin prioridad", className: "text-[var(--muted)]" },
];

export const viewOptions: { value: TaskView; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "upcoming", label: "Próximas" },
  { value: "all", label: "Todas" },
  { value: "completed", label: "Completadas" },
];

export const sortOptions: { value: TaskSort; label: string }[] = [
  { value: "due", label: "Fecha límite" },
  { value: "priority", label: "Prioridad" },
  { value: "created", label: "Más recientes" },
  { value: "title", label: "Título" },
];

export function statusLabel(status: TaskStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

export function priorityMeta(priority: TaskPriority) {
  return priorityOptions.find((option) => option.value === priority) ?? priorityOptions[4];
}

export function isClosed(status: TaskStatus) {
  return status === "completed" || status === "cancelled";
}
