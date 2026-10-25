import type { ExcludedApp } from "./clipboard";

export type AppTrackingSettings = {
  enabled: boolean;
  paused: boolean;
  idleMinutes: number;
  retentionDays: number;
  excludedApps: ExcludedApp[];
};

export type AppUsage = { bundleId: string; appName: string; todaySeconds: number; weekSeconds: number };

export type AppUsageReport = {
  apps: AppUsage[];
  todaySeconds: number;
  weekSeconds: number;
  currentApp: string | null;
};
