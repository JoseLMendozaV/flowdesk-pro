/**
 * Las marcas de tiempo del sistema (`created_at`, `updated_at`) se guardan en UTC, tanto las
 * de SQLite (`CURRENT_TIMESTAMP`) como las importadas de Django. Devuelve la fecha local
 * como `AAAA-MM-DD`.
 */
export function formatTimestamp(value: string): string {
  const date = new Date(`${value.slice(0, 19).replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Convierte `HH:MM` o `HH:MM:SS` en hora de 12 horas, por ejemplo `7:30 p. m.`. */
export function formatTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "a. m." : "p. m."}`;
}
