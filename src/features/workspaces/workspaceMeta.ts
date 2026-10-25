import { BookOpen, BriefcaseBusiness, Code2, FlaskConical, GraduationCap, Heart, House, Palette, type LucideIcon } from "lucide-react";
import type { WorkspaceIcon, WorkspaceTaskView } from "../../types/workspaces";

export const workspaceIcons: Record<WorkspaceIcon, { icon: LucideIcon; label: string }> = {
  briefcase: { icon: BriefcaseBusiness, label: "Trabajo" },
  flask: { icon: FlaskConical, label: "Investigación" },
  code: { icon: Code2, label: "Programación" },
  graduation: { icon: GraduationCap, label: "Docencia" },
  book: { icon: BookOpen, label: "Estudio" },
  palette: { icon: Palette, label: "Diseño" },
  home: { icon: House, label: "Personal" },
  heart: { icon: Heart, label: "Salud" },
};

export const workspaceTaskViews: { value: WorkspaceTaskView; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "upcoming", label: "Próximas" },
  { value: "all", label: "Todas" },
];
