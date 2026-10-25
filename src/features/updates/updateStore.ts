import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { errorMessage } from "../../services/format";

/** Como mucho una comprobación automática cada 6 horas. */
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Status = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "restarting" | "error";

type UpdateState = {
  status: Status;
  update: Update | null;
  progress: number | null;
  error: string | null;
  dismissedVersion: string | null;
  autoCheck: boolean;
  lastCheckedAt: number;
  checkedThisSession: boolean;
  setAutoCheck: (enabled: boolean) => void;
  checkNow: () => Promise<void>;
  checkIfDue: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
};

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => ({
      status: "idle",
      update: null,
      progress: null,
      error: null,
      dismissedVersion: null,
      autoCheck: true,
      lastCheckedAt: 0,
      checkedThisSession: false,
      setAutoCheck: (autoCheck) => set({ autoCheck }),
      checkNow: async () => {
        if (get().status === "checking" || get().status === "downloading") return;
        set({ status: "checking", error: null, checkedThisSession: true });
        try {
          const update = await check();
          set({
            update,
            status: update ? "available" : "up-to-date",
            lastCheckedAt: Date.now(),
          });
        } catch (reason) {
          set({ status: "error", error: errorMessage(reason), lastCheckedAt: Date.now() });
        }
      },
      checkIfDue: async () => {
        const { autoCheck, lastCheckedAt, checkedThisSession, checkNow } = get();
        if (!autoCheck) return;
        // Una vez por arranque y después cada 6 horas.
        if (!checkedThisSession || Date.now() - lastCheckedAt >= AUTO_CHECK_INTERVAL_MS) await checkNow();
      },
      install: async () => {
        const update = get().update;
        if (!update) return;
        set({ status: "downloading", progress: 0, error: null });
        try {
          let total = 0;
          let received = 0;
          await update.downloadAndInstall((event) => {
            if (event.event === "Started") total = event.data.contentLength ?? 0;
            if (event.event === "Progress") {
              received += event.data.chunkLength;
              set({ progress: total ? Math.min(1, received / total) : null });
            }
          });
          set({ status: "restarting" });
          // Guarda temporizadores y notas antes de reiniciar con la versión nueva.
          await invoke("prepare_restart");
          await relaunch();
        } catch (reason) {
          set({ status: "error", error: errorMessage(reason), progress: null });
        }
      },
      dismiss: () => set({ dismissedVersion: get().update?.version ?? null }),
    }),
    {
      name: "flowdesk-updates",
      partialize: (state) => ({
        autoCheck: state.autoCheck,
        lastCheckedAt: state.lastCheckedAt,
        dismissedVersion: state.dismissedVersion,
      }),
    },
  ),
);
