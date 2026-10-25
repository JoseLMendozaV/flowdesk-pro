export type WorkspaceIcon = "briefcase" | "flask" | "code" | "graduation" | "book" | "palette" | "home" | "heart";
export type WorkspaceTaskView = "today" | "upcoming" | "all";

export type WorkspaceResource = {
  id: string;
  kind: "folder" | "app";
  path: string;
  label: string;
  exists: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  color: string;
  icon: WorkspaceIcon;
  taskView: WorkspaceTaskView;
  isArchived: boolean;
  projectIds: string[];
  noteIds: string[];
  resources: WorkspaceResource[];
  openTaskCount: number;
};

export type WorkspaceInput = Pick<Workspace, "name" | "color" | "icon" | "taskView">;

export type WorkspaceState = {
  activeId: string | null;
  workspaces: Workspace[];
};
