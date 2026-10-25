export type ProjectStatus = "active" | "paused" | "completed";

export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  color: string;
  status: ProjectStatus;
  startsAt: number | null;
  targetAt: number | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  taskCount: number;
  completedTaskCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  noteCount: number;
  trackedSeconds: number;
  progressPercent: number;
};

export type ProjectInput = {
  name: string;
  description: string;
  color: string;
  status: ProjectStatus;
  startsAt: number | null;
  targetAt: number | null;
};

export type ProjectDeleteMode = "keep_tasks" | "delete_tasks";
