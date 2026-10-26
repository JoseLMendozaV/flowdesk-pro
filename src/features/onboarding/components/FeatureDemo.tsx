import type { DemoKind } from "../registry/types";
import { ClipboardDemo } from "../demos/ClipboardDemo";
import { FloatingNoteDemo } from "../demos/FloatingNoteDemo";
import { MenuBarDemo } from "../demos/MenuBarDemo";
import { PomodoroDemo } from "../demos/PomodoroDemo";
import { TasksDemo } from "../demos/TasksDemo";
import { TimeDemo } from "../demos/TimeDemo";
import { WorkspacesDemo } from "../demos/WorkspacesDemo";
import { useAnimationsActive } from "../hooks/useMotion";

const demos: Record<DemoKind, (props: { paused: boolean }) => React.ReactElement> = {
  "floating-note": FloatingNoteDemo,
  tasks: TasksDemo,
  pomodoro: PomodoroDemo,
  clipboard: ClipboardDemo,
  "menu-bar": MenuBarDemo,
  time: TimeDemo,
  workspaces: WorkspacesDemo,
};

export function FeatureDemo({ kind }: { kind: DemoKind }) {
  const active = useAnimationsActive();
  const Demo = demos[kind];
  return <Demo paused={!active} />;
}
