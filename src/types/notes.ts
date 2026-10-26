export type NoteAttachmentKind = "image" | "file" | "audio";

export type NoteAttachment = {
  id: string;
  noteId: string;
  kind: NoteAttachmentKind;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: number;
  /** Lo usa el documento actual; si no, se conserva hasta eliminarlo. */
  inUse: boolean;
};

export type NoteVersionReason = "legacy" | "snapshot" | "before-restore" | "conflict";

export type NoteVersionSummary = {
  id: string;
  revision: number;
  format: "markdown" | "rich-v1";
  title: string;
  preview: string;
  reason: NoteVersionReason;
  createdAt: number;
};

export type NoteVersion = Omit<NoteVersionSummary, "preview"> & {
  noteId: string;
  content: string;
  contentJson: string | null;
};

export type NoteContextKind = "project" | "task" | "workspace" | "event";

export type NoteContextItem = {
  id: string;
  title: string;
  color: string | null;
  at: number | null;
  status: string | null;
};

export type NoteContexts = {
  project: NoteContextItem | null;
  tasks: NoteContextItem[];
  workspaces: NoteContextItem[];
  events: NoteContextItem[];
};
