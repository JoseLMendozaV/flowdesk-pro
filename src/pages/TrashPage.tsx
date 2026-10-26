import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckSquare2, FolderKanban, RotateCcw, Trash2, X } from "lucide-react";
import { useDataChanged } from "../hooks/useDataChanged";
import { flowdeskApi } from "../services/flowdeskApi";
import { describeDue, errorMessage, formatDate } from "../services/format";
import { useAppStore } from "../stores/appStore";
import type { RestoredItem, TrashItem } from "../types/trash";

const kindMeta = {
  task: { label: "Tarea", icon: CheckSquare2 },
  project: { label: "Proyecto", icon: FolderKanban },
  event: { label: "Evento", icon: CalendarDays },
  event_occurrences: { label: "Repeticiones de un evento", icon: CalendarDays },
} as const;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function describe(item: TrashItem) {
  switch (item.entityType) {
    case "task":
      return item.childCount ? `Tarea · ${plural(item.childCount, "subtarea", "subtareas")}` : "Tarea";
    case "project":
      return item.childCount ? `Proyecto · con ${plural(item.childCount, "tarea", "tareas")}` : "Proyecto · sus tareas se conservaron";
    case "event":
      return "Evento";
    case "event_occurrences": {
      const when = item.occurrenceStart ? formatDate(item.occurrenceStart) : "";
      return item.occurrenceScope === "following" ? `Repeticiones desde el ${when}` : `Repetición del ${when}`;
    }
  }
}

function daysLeft(item: TrashItem, now: number) {
  const days = Math.max(0, Math.ceil((item.expiresAt - now) / 86_400));
  return days <= 1 ? "Se eliminará mañana" : `Se eliminará en ${days} días`;
}

export function TrashPage() {
  const focusTask = useAppStore((state) => state.focusTask);
  const selectSection = useAppStore((state) => state.selectSection);
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [restored, setRestored] = useState<{ item: TrashItem; result: RestoredItem } | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await flowdeskApi.trash());
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(["trash"], () => void load());

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function open(result: RestoredItem) {
    if (result.entityType === "task") focusTask(result.entityId);
    else if (result.entityType === "project") selectSection("projects");
    else selectSection("calendar");
  }

  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header data-tauri-drag-region="deep" className="flex h-[74px] flex-none items-end justify-between gap-4 border-b border-[var(--line)] bg-[color:var(--bg-translucent)] px-6 pb-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.025em]">Papelera</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Tareas, proyectos y eventos borrados. Se eliminan para siempre a los 30 días.</p>
        </div>
        {items && items.length > 0 && (confirmingEmpty ? (
          <span className="flex items-center gap-1.5 text-[11px]">
            ¿Eliminar todo para siempre?
            <button type="button" onClick={() => void run(async () => { await flowdeskApi.emptyTrash(); setConfirmingEmpty(false); })} className="rounded-lg bg-red-500 px-2.5 py-1.5 font-medium text-white">Vaciar</button>
            <button type="button" onClick={() => setConfirmingEmpty(false)} className="rounded-lg px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--hover)]">No</button>
          </span>
        ) : (
          <button type="button" data-tour-id="trash-empty" onClick={() => setConfirmingEmpty(true)} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] hover:border-red-500/40 hover:text-red-500">
            <Trash2 className="size-3.5" /> Vaciar papelera
          </button>
        ))}
      </header>

      {error && <div className="mx-6 mt-3 rounded-xl bg-red-500/10 px-4 py-2 text-xs text-red-500">{error}</div>}
      {restored && (
        <div role="status" className="mx-6 mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
          <RotateCcw className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">“{restored.item.title}” se ha restaurado.</span>
          <button type="button" onClick={() => open(restored.result)} className="font-medium underline-offset-2 hover:underline">Abrir</button>
          <button type="button" onClick={() => setRestored(null)} aria-label="Cerrar aviso" className="grid size-5 place-items-center rounded"><X className="size-3" /></button>
        </div>
      )}

      <div data-tour-id="trash-content" className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {items && items.length === 0 ? (
          <div className="grid min-h-60 place-items-center rounded-2xl border border-dashed border-[var(--line)] text-center text-[11px] text-[var(--muted)]">
            <div>
              <Trash2 className="mx-auto mb-2 size-6 text-[var(--accent)]" />
              La papelera está vacía.
              <p className="mt-1">Lo que borres aquí podrás recuperarlo durante 30 días.</p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5" aria-label="Elementos en la papelera" data-tour-id="trash-list">
            {items?.map((item) => {
              const { icon: Icon } = kindMeta[item.entityType];
              return (
                <li key={item.id} className="group flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 hover:border-[var(--line-strong)]">
                  <span className="grid size-7 flex-none place-items-center rounded-lg bg-[var(--inset)] text-[var(--muted)]">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{item.title}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">
                      {describe(item)} · Borrado {describeDue(item.deletedAt, true).label.toLocaleLowerCase("es")} · {daysLeft(item, now)}
                    </span>
                  </span>
                  {confirmingDelete === item.id ? (
                    <span className="flex items-center gap-1 text-[11px]">
                      ¿Para siempre?
                      <button type="button" onClick={() => void run(async () => { await flowdeskApi.deleteTrashItem(item.id); setConfirmingDelete(null); })} className="rounded-lg bg-red-500 px-2 py-1 font-medium text-white">Eliminar</button>
                      <button type="button" onClick={() => setConfirmingDelete(null)} className="rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)]">No</button>
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void run(async () => setRestored({ item, result: await flowdeskApi.restoreTrashItem(item.id) }))}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        <RotateCcw className="size-3.5" /> Restaurar
                      </button>
                      <button type="button" onClick={() => setConfirmingDelete(item.id)} aria-label={`Eliminar “${item.title}” para siempre`} title="Eliminar para siempre" className="grid size-7 flex-none place-items-center rounded-lg text-[var(--muted)] opacity-0 hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100">
                        <X className="size-3.5" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
