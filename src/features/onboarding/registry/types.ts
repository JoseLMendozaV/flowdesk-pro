import type { Section } from "../../../stores/appStore";

export type FeatureCategory = "essentials" | "organization" | "focus" | "tools" | "macos" | "intelligence";

/** Iconos de Lucide por nombre: el registro es solo datos y se prueba sin React. */
export type FeatureIconName =
  | "home"
  | "tasks"
  | "projects"
  | "notes"
  | "focus"
  | "time"
  | "calendar"
  | "workspaces"
  | "clipboard"
  | "menu-bar"
  | "search"
  | "trash"
  | "teaching"
  | "ai";

export type FeatureTone = "blue" | "violet" | "amber" | "emerald" | "orange" | "rose" | "sky" | "slate";

/** Demostraciones animadas con datos ficticios: nunca leen ni escriben datos reales. */
export type DemoKind = "floating-note" | "tasks" | "pomodoro" | "clipboard" | "menu-bar" | "time" | "workspaces";

/** Atajos globales por id del registro de Rust (`shortcuts/mod.rs`). */
export type GlobalShortcutId = "new-note" | "new-task" | "open" | "pomodoro";

export type TourStep = {
  /** Único en todo el registro; se guarda como progreso de la visita guiada. */
  id: string;
  /** Valor de `data-tour-id`. Con varios, se resalta el primero que esté visible. */
  target: string | string[];
  /** Sección que se abre antes de buscar el elemento. */
  section?: Section;
  title: string;
  body: string;
};

export type FeatureScreenshot = {
  light: string;
  dark: string;
  alt: string;
  /** Proporción ancho/alto de la captura, para reservar su espacio antes de cargarla. */
  aspect: number;
};

/** Cambio visible en una funcionalidad ya presentada. Sube su `revision`. */
export type FeatureUpdate = {
  revision: number;
  version: string;
  summary: string;
};

export type FeatureDefinition = {
  /** Identificador estable: nunca cambia aunque cambie el título. */
  id: string;
  title: string;
  /** Una línea para el catálogo y las novedades. */
  summary: string;
  description: string;
  category: FeatureCategory;
  /** Fase del plan en que se construyó. Informativo: no decide la disponibilidad. */
  phase: number;
  /** Versión publicada que la incluyó por primera vez; `null` si aún no se publicó. */
  introducedInVersion: string | null;
  /** Revisión del contenido presentado. Empieza en 1 y sube con cada `updates`. */
  revision: number;
  updates?: FeatureUpdate[];
  /** El código existe y funciona de principio a fin. */
  implemented: boolean;
  /** Se comprobó con pruebas y en la app empaquetada (ver docs/PHASE_*.md). */
  verified: boolean;
  /** Interruptor para retirar una función sin borrar su ficha. */
  enabled: boolean;
  /** Se presenta en la bienvenida y en el catálogo. */
  onboardingEnabled: boolean;
  /** Capacidades que Rust debe declarar (`commands/onboarding.rs`). */
  requires: string[];
  order: number;
  icon: FeatureIconName;
  tone: FeatureTone;
  highlights: string[];
  example: string;
  tips: string[];
  privacy?: string;
  shortcuts?: GlobalShortcutId[];
  route?: Section;
  image?: FeatureScreenshot;
  animation?: DemoKind;
  tourSteps?: TourStep[];
  /** La función existe, pero necesita configuración adicional si falta esta capacidad. */
  setup?: { capability: string; message: string };
};
