import { useState } from "react";
import { Image, Link2, Search, ShieldCheck, Star, Type } from "lucide-react";
import { DemoFrame } from "./DemoFrame";

type DemoItem = { id: number; kind: "text" | "link" | "image"; text: string; app: string; when: string; favorite: boolean };

const initialItems: DemoItem[] = [
  { id: 1, kind: "text", text: "«La productividad no es hacer más, sino lo importante.»", app: "Safari", when: "Hace 2 min", favorite: true },
  { id: 2, kind: "link", text: "https://example.com/guia", app: "Mail", when: "Hace 15 min", favorite: false },
  { id: 3, kind: "image", text: "Captura del gráfico semanal", app: "Vista Previa", when: "Hace 1 h", favorite: false },
  { id: 4, kind: "text", text: "Reunión de seguimiento: jueves 10:00, sala 2", app: "Notas", when: "Ayer", favorite: false },
];
const icons = { text: Type, link: Link2, image: Image };

/** Historial ficticio con búsqueda y favoritos. No lee ni escribe el portapapeles real. */
export function ClipboardDemo({ paused }: { paused: boolean }) {
  const [items, setItems] = useState(initialItems);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase("es");
  const visible = items.filter((item) => !query || item.text.toLocaleLowerCase("es").includes(query));

  return (
    <DemoFrame paused={paused} note="Historial de ejemplo: tu portapapeles real no se lee durante la guía.">
      <div className="demo-window absolute inset-[6%] flex flex-col p-3">
        <label className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1 focus-within:border-[var(--accent)]">
          <Search className="size-3 text-[var(--muted)]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={60} placeholder="Busca «reunión» o «guia»" aria-label="Buscar en el historial de ejemplo" className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-[var(--muted)]" />
        </label>
        <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {visible.map((item) => {
            const Icon = icons[item.kind];
            return (
              <li key={item.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5">
                <span className="grid size-5 flex-none place-items-center rounded bg-[var(--inset)] text-[var(--muted)]"><Icon className="size-3" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px]">{item.text}</span>
                  <span className="block text-[8px] text-[var(--muted)]">{item.app} · {item.when}</span>
                </span>
                <button type="button" onClick={() => setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, favorite: !entry.favorite } : entry)))} aria-label={item.favorite ? "Quitar de favoritos" : "Marcar como favorito"} aria-pressed={item.favorite} className={item.favorite ? "text-amber-500" : "text-[var(--muted)]"}>
                  <Star className={`size-3 ${item.favorite ? "fill-current" : ""}`} />
                </button>
              </li>
            );
          })}
          {visible.length === 0 && <li className="py-4 text-center text-[10px] text-[var(--muted)]">Nada coincide con la búsqueda.</li>}
        </ul>
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[9px] leading-4 text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="mt-0.5 size-3 flex-none" />
          Una contraseña copiada desde 1Password no aparece: el contenido marcado como oculto ni siquiera se lee.
        </p>
      </div>
    </DemoFrame>
  );
}
