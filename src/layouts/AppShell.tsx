import type { ReactNode } from "react";
import { Sidebar } from "../components/Sidebar";
import { UpdateBanner } from "../features/updates/UpdateBanner";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen min-h-[620px] overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="grid h-full grid-cols-[228px_minmax(0,1fr)]">
        <Sidebar />
        <main className="flex min-w-0 flex-col overflow-hidden">
          <UpdateBanner />
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </main>
      </div>
    </div>
  );
}
