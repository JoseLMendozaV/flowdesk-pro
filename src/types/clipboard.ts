export type ExcludedApp = { bundleId: string; name: string };

/** `enabled` es el consentimiento; `paused` detiene la captura sin retirarlo. */
export type ClipboardSettings = {
  enabled: boolean;
  paused: boolean;
  maxItems: number;
  captureImages: boolean;
  skipSensitive: boolean;
  excludedApps: ExcludedApp[];
};

export type ClipboardItem = {
  id: string;
  contentType: "text" | "image";
  /** `null` en imágenes y en posibles credenciales, que no se envían a la interfaz. */
  preview: string | null;
  charCount: number;
  byteSize: number;
  sourceApp: string | null;
  isFavorite: boolean;
  isSensitive: boolean;
  createdAt: number;
};
