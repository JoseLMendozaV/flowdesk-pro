import type { RecurrenceRule } from "./recurrence";

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";
export type TaskView = "all" | "today" | "upcoming" | "completed";
export type TaskSort = "due" | "priority" | "created" | "title";

export type Tag = {
  id: string;
  name: string;
  color: string;
};

export type TaskSummary = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  dueAt: number | null;
  dueHasTime: boolean;
  /** Día desde el que se puede empezar (mediodía local); hasta entonces no está en Hoy. */
  startsAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
  estimatedMinutes: number | null;
  trackedSeconds: number;
  subtaskCount: number;
  subtasksCompleted: number;
  noteCount: number;
  tags: Tag[];
  recurrence: RecurrenceRule | null;
  /** Repetición creada al completarla. */
  recurrenceNextId: string | null;
};

export type Subtask = {
  id: string;
  title: string;
  isCompleted: boolean;
  position: number;
};

export type LinkedNote = {
  id: string;
  title: string;
  preview: string;
  color: string;
  isArchived: boolean;
};

export type TaskDetail = TaskSummary & {
  description: string;
  subtasks: Subtask[];
  notes: LinkedNote[];
};

export type TaskInput = {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: number | null;
  dueHasTime?: boolean;
  /** Solo cuenta el día; no puede ser posterior a la fecha límite. */
  startsAt?: number | null;
  projectId?: string | null;
  estimatedMinutes?: number | null;
  tags?: string[];
  /** Exige fecha límite. */
  recurrence?: RecurrenceRule | null;
  noteId?: string | null;
};

export type TaskFilter = {
  view: TaskView;
  sort: TaskSort;
  search?: string;
  projectId?: string | null;
  priority?: TaskPriority | null;
  status?: TaskStatus | null;
  tagId?: string | null;
  includeCompleted?: boolean;
};
