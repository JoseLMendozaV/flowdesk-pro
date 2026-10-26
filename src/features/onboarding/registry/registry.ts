import { CONTENT_REVISION, FEATURES } from "./features.ts";
import type { FeatureDefinition, FeatureUpdate, TourStep } from "./types.ts";

export type WhatsNewEntry = {
  feature: FeatureDefinition;
  kind: "new" | "improved";
  /** Cambios posteriores a la revisión que el usuario conocía. */
  changes: FeatureUpdate[];
};

export type ReleaseNotes = {
  version: string;
  added: FeatureDefinition[];
  improved: { feature: FeatureDefinition; update: FeatureUpdate }[];
};

/**
 * Lo que puede presentarse: implementado, verificado, habilitado y con todas sus
 * capacidades declaradas por Rust. La fase no interviene.
 */
export function availableFeatures(capabilities: readonly string[], registry: readonly FeatureDefinition[] = FEATURES) {
  const declared = new Set(capabilities);
  return registry
    .filter(
      (feature) =>
        feature.implemented &&
        feature.verified &&
        feature.enabled &&
        feature.onboardingEnabled &&
        feature.introducedInVersion !== null &&
        feature.requires.every((capability) => declared.has(capability)),
    )
    .sort((left, right) => left.order - right.order);
}

/** Disponible, pero le falta configuración (por ejemplo, un modelo de IA instalado). */
export function needsSetup(feature: FeatureDefinition, capabilities: readonly string[]) {
  return feature.setup && !capabilities.includes(feature.setup.capability) ? feature.setup.message : null;
}

/** Huella del contenido presentado: cambia al añadir funciones o subir su revisión. */
export function featureRevision(features: readonly FeatureDefinition[]) {
  const parts = [...features].sort((left, right) => left.id.localeCompare(right.id)).map((feature) => `${feature.id}@${feature.revision}`);
  return `${CONTENT_REVISION}:${parts.join(",")}`;
}

export function revisionMap(features: readonly FeatureDefinition[]) {
  return Object.fromEntries(features.map((feature) => [feature.id, feature.revision]));
}

/** Funciones nuevas o con cambios visibles respecto a lo que el usuario ya conoce. */
export function whatsNew(features: readonly FeatureDefinition[], seen: Record<string, number>): WhatsNewEntry[] {
  return features.flatMap((feature): WhatsNewEntry[] => {
    const known = seen[feature.id];
    if (known === undefined) return [{ feature, kind: "new", changes: [] }];
    if (known >= feature.revision) return [];
    const changes = (feature.updates ?? []).filter((update) => update.revision > known);
    return [{ feature, kind: "improved", changes }];
  });
}

export function compareVersions(left: string, right: string) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Historial por versión, de la más reciente a la más antigua, para «¿Qué hay de nuevo?». */
export function releaseNotes(features: readonly FeatureDefinition[]): ReleaseNotes[] {
  const byVersion = new Map<string, ReleaseNotes>();
  const entry = (version: string) => {
    const existing = byVersion.get(version);
    if (existing) return existing;
    const created: ReleaseNotes = { version, added: [], improved: [] };
    byVersion.set(version, created);
    return created;
  };
  for (const feature of features) {
    if (feature.introducedInVersion) entry(feature.introducedInVersion).added.push(feature);
    for (const update of feature.updates ?? []) entry(update.version).improved.push({ feature, update });
  }
  return [...byVersion.values()].sort((left, right) => compareVersions(right.version, left.version));
}

export type ResolvedTourStep = TourStep & { featureId: string; featureTitle: string };

export function tourSteps(features: readonly FeatureDefinition[]): ResolvedTourStep[] {
  return features.flatMap((feature) =>
    (feature.tourSteps ?? []).map((step) => ({ ...step, featureId: feature.id, featureTitle: feature.title })),
  );
}

/** Errores de mantenimiento del registro. Las pruebas exigen que esté vacío. */
export function registryProblems(registry: readonly FeatureDefinition[] = FEATURES) {
  const problems: string[] = [];
  const ids = new Set<string>();
  const stepIds = new Set<string>();
  const identifier = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
  const version = /^\d+\.\d+\.\d+$/;
  for (const feature of registry) {
    if (!identifier.test(feature.id)) problems.push(`${feature.id}: id no válido`);
    if (ids.has(feature.id)) problems.push(`${feature.id}: id repetido`);
    ids.add(feature.id);
    if (feature.revision < 1) problems.push(`${feature.id}: la revisión empieza en 1`);
    const ready = feature.implemented && feature.verified && feature.enabled;
    if (feature.verified && !feature.implemented) problems.push(`${feature.id}: verificada sin estar implementada`);
    if (ready && (!feature.introducedInVersion || !version.test(feature.introducedInVersion))) {
      problems.push(`${feature.id}: falta la versión en que se publicó`);
    }
    if (ready && feature.onboardingEnabled) {
      if (feature.highlights.length === 0 || !feature.example) problems.push(`${feature.id}: falta contenido de la presentación`);
      if (!feature.image && !feature.animation) problems.push(`${feature.id}: falta una captura o demostración`);
      if (feature.requires.length === 0) problems.push(`${feature.id}: no declara capacidades`);
    }
    for (const update of feature.updates ?? []) {
      if (update.revision < 2 || update.revision > feature.revision) problems.push(`${feature.id}: revisión de cambio ${update.revision} fuera de rango`);
      if (!version.test(update.version)) problems.push(`${feature.id}: versión de cambio no válida`);
    }
    for (const step of feature.tourSteps ?? []) {
      if (stepIds.has(step.id)) problems.push(`${step.id}: paso repetido`);
      stepIds.add(step.id);
      if (!identifier.test(step.id)) problems.push(`${step.id}: id de paso no válido`);
    }
  }
  return problems;
}
