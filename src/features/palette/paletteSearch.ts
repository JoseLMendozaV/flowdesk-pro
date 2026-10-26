/** Minúsculas y sin tildes: «menu» encuentra «Menú». */
export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es").trim();
}

/** Todas las palabras de la búsqueda (ya normalizada) aparecen en el texto, en cualquier orden. */
export function matchesQuery(normalizedQuery: string, text: string) {
  const haystack = normalizeSearch(text);
  return normalizedQuery.split(/\s+/).every((word) => haystack.includes(word));
}
