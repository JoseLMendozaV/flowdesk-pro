import { create } from "zustand";
import { flowdeskApi } from "../../services/flowdeskApi";
import { errorMessage } from "../../services/format";

type UndoEntry = {
  /** Cambia con cada borrado: reinicia el temporizador del aviso. */
  key: number;
  message: string;
  /** Elemento de la papelera que se restaura al deshacer. */
  itemId: string;
};

type UndoState = {
  entry: UndoEntry | null;
  error: string | null;
  /** Muestra el aviso «… · Deshacer» tras llevar algo a la papelera. */
  offer: (message: string, itemId: string) => void;
  dismiss: () => void;
  undo: () => Promise<void>;
};

let nextKey = 0;

export const useUndoStore = create<UndoState>()((set, get) => ({
  entry: null,
  error: null,
  offer: (message, itemId) => set({ entry: { key: ++nextKey, message, itemId }, error: null }),
  dismiss: () => set({ entry: null, error: null }),
  undo: async () => {
    const entry = get().entry;
    if (!entry) return;
    try {
      await flowdeskApi.restoreTrashItem(entry.itemId);
      if (get().entry?.key === entry.key) set({ entry: null, error: null });
    } catch (reason) {
      set({ error: errorMessage(reason) });
    }
  },
}));
