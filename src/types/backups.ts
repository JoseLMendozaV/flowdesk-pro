// Igual que los structs de src-tauri/src/backup.rs.

export type BackupSettings = {
  /** Carpeta elegida (por ejemplo, una de iCloud Drive). */
  folder: string | null;
  enabled: boolean;
  /** Copias que se conservan; las más antiguas se borran. */
  keep: number;
  lastBackupAt: number | null;
  lastError: string | null;
};

export type BackupKind = "automatic" | "manual" | "before-restore";

export type BackupEntry = {
  path: string;
  name: string;
  /** Segundos Unix. */
  createdAt: number;
  size: number;
  kind: BackupKind;
};

export type BackupOverview = {
  settings: BackupSettings;
  /** La carpeta existe (un disco o iCloud Drive desconectados no lo están). */
  folderAvailable: boolean;
  backups: BackupEntry[];
};
