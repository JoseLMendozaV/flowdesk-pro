import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare2,
  Clipboard,
  Clock3,
  Focus,
  FolderKanban,
  GraduationCap,
  HardDriveDownload,
  Home,
  PanelTop,
  Search,
  StickyNote,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { FeatureCategory, FeatureIconName, FeatureTone } from "../registry/types";

export const featureIcons: Record<FeatureIconName, LucideIcon> = {
  home: Home,
  tasks: CheckSquare2,
  projects: FolderKanban,
  notes: StickyNote,
  focus: Focus,
  time: Clock3,
  calendar: CalendarDays,
  workspaces: BriefcaseBusiness,
  clipboard: Clipboard,
  "menu-bar": PanelTop,
  search: Search,
  trash: Trash2,
  teaching: GraduationCap,
  backups: HardDriveDownload,
  ai: Bot,
};

/** Mismos tonos que las tarjetas del dashboard (`MetricCard`). */
export const toneClasses: Record<FeatureTone, string> = {
  blue: "bg-blue-500/10 text-blue-500",
  violet: "bg-violet-500/10 text-violet-500",
  amber: "bg-amber-500/10 text-amber-500",
  emerald: "bg-emerald-500/10 text-emerald-500",
  orange: "bg-orange-500/10 text-orange-500",
  rose: "bg-rose-500/10 text-rose-500",
  sky: "bg-sky-500/10 text-sky-500",
  slate: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
};

export const categoryLabels: Record<FeatureCategory, string> = {
  essentials: "Esencial",
  organization: "Organización",
  focus: "Concentración y tiempo",
  tools: "Herramientas",
  macos: "Integración con macOS",
  intelligence: "Inteligencia",
};
