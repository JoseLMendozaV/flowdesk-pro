export type TrashEntityType = "task" | "project" | "event" | "event_occurrences";

export type TrashItem = {
  id: string;
  entityType: TrashEntityType;
  entityId: string;
  title: string;
  deletedAt: number;
  /** Se elimina para siempre a los 30 días. */
  expiresAt: number;
  /** Tareas borradas con un proyecto, o subtareas de una tarea. */
  childCount: number;
  occurrenceStart: number | null;
  occurrenceScope: "this" | "following" | null;
};

export type RestoredItem = {
  entityType: TrashEntityType;
  entityId: string;
};
