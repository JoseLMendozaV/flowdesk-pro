import type { ScheduleKind, TimeBlocks } from "../types";

export type Block = { start: string; end: string };

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Bloques del día (`HH:MM`), por ejemplo 07:00–07:45, 07:50–08:35… */
export function expandBlocks(blocks: TimeBlocks): Block[] {
  const first = toMinutes(blocks.first);
  return Array.from({ length: blocks.count }, (_, index) => {
    const start = first + index * (blocks.minutes + blocks.gap);
    return { start: toTime(start), end: toTime(start + blocks.minutes) };
  });
}

/** Una franja coincide con los bloques si empieza al inicio de uno y termina al final de otro. */
export function alignsWithBlocks(blocks: Block[], start: string, end: string) {
  return blocks.some((block) => block.start === start.slice(0, 5)) && blocks.some((block) => block.end === end.slice(0, 5));
}

/** La franja ocupa (en todo o en parte) el bloque. */
export function coversBlock(block: Block, start: string, end: string) {
  return toMinutes(start) < toMinutes(block.end) && toMinutes(end) > toMinutes(block.start);
}

const MINOR_WORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "para", "con"]);

/** «Desarrollo de Software VIII» → «DS VIII»: iniciales, conservando números romanos y cifras. */
export function shortCourseName(title: string) {
  const words = title.trim().split(/\s+/).filter((word) => !MINOR_WORDS.has(word.toLocaleLowerCase("es")));
  if (words.length <= 1) return title.trim();
  const initials = words.filter((word) => !/^([IVXLC]+|\d+)$/.test(word)).map((word) => word[0].toLocaleUpperCase("es")).join("");
  const suffix = words.filter((word) => /^([IVXLC]+|\d+)$/.test(word)).join(" ");
  return suffix ? `${initials} ${suffix}` : initials;
}

export const kindLabels: Record<ScheduleKind, string> = { class: "Clase", theory: "Teoría", lab: "Laboratorio" };
export const kindLetters: Record<ScheduleKind, string> = { class: "", theory: "T", lab: "L" };
