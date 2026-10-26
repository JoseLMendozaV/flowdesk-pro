export type WelcomeStatus = "pending" | "completed" | "skipped";

export type OnboardingState = {
  welcomeStatus: WelcomeStatus;
  completedInitialOnboarding: boolean;
  showWelcomeOnStartup: boolean;
  showWhatsNewOnUpdate: boolean;
  resumeTour: boolean;
  lastSeenAppVersion: string | null;
  lastSeenFeatureRevision: string | null;
  /** Id de funcionalidad → revisión de contenido que el usuario ya conoce. */
  seenFeatures: Record<string, number>;
  lastCompletedStepId: string | null;
  lastOnboardingDate: number | null;
  appVersion: string;
  capabilities: string[];
};

export type OnboardingPreferences = {
  showWelcomeOnStartup: boolean;
  showWhatsNewOnUpdate: boolean;
  resumeTour: boolean;
};

export type OnboardingMode = "welcome" | "tour" | "features" | "whats-new" | "shortcuts";

export type GuidedTourRequest = {
  featureId: string | null;
  /** Dónde reabrir la guía al terminar la visita. */
  returnTo: { mode: OnboardingMode; featureId: string | null } | null;
};

export type OnboardingEvent = "whats_new_shown" | "guided_tour_started" | "guided_tour_completed";
