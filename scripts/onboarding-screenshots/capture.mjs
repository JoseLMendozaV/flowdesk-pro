// Genera las capturas de la guía (claro y oscuro) con el arnés de esta carpeta.
// Uso: npm run onboarding:screenshots [-- dashboard tasks …]
//      npm run onboarding:screenshots -- --preview <carpeta>   (revisión visual de la propia guía)
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { delay, root, withHarness } from "./browser.mjs";

const assets = path.join(root, "src/features/onboarding/assets");
const WINDOW = { width: 1180, height: 760, scale: 1 };
const TRAY = { width: 360, height: 520, scale: 2, transparent: true };
const GUIDE = { width: 900, height: 620, scale: 1 };

/** Capturas que usa el registro: id de la funcionalidad → vista del arnés. */
const featureShots = {
  dashboard: { query: "target=dashboard", ...WINDOW },
  tasks: { query: "target=tasks", ...WINDOW },
  projects: { query: "target=projects", ...WINDOW },
  notes: { query: "target=notes", ...WINDOW },
  pomodoro: { query: "target=focus", ...WINDOW },
  time: { query: "target=time&entry=running&timer=idle", ...WINDOW },
  calendar: { query: "target=calendar", ...WINDOW },
  workspaces: { query: "target=workspaces", ...WINDOW },
  clipboard: { query: "target=clipboard", ...WINDOW },
  "menu-bar": { query: "target=tray", ...TRAY },
};

/** Revisión visual de la propia guía (no se publican). */
const previewShots = {
  welcome: { query: "target=onboarding&mode=welcome", ...GUIDE },
  "tour-tasks": { query: "target=onboarding&mode=tour&feature=tasks", ...GUIDE },
  "tour-notes": { query: "target=onboarding&mode=tour&feature=notes&demo=1", ...GUIDE },
  "whats-new": { query: "target=onboarding&mode=whats-new&state=news", ...GUIDE },
  "whats-new-seen": { query: "target=onboarding&mode=whats-new&state=seen", ...GUIDE },
  features: { query: "target=onboarding&mode=features&state=seen", ...GUIDE },
  shortcuts: { query: "target=onboarding&mode=shortcuts&state=seen", ...GUIDE },
  "small-window": { query: "target=onboarding&mode=tour&feature=time", width: 720, height: 520, scale: 1 },
  settings: { query: "target=dashboard&settings=1", ...WINDOW },
  "guided-tour": { query: "target=tasks&tour=tasks", ...WINDOW },
};

const args = process.argv.slice(2);
const previewIndex = args.indexOf("--preview");
const previewDir = previewIndex >= 0 ? path.resolve(args[previewIndex + 1]) : null;
const shots = previewDir ? previewShots : featureShots;
const only = args.filter((arg, index) => !arg.startsWith("--") && (previewIndex < 0 || index !== previewIndex + 1));
const selected = Object.entries(shots).filter(([id]) => only.length === 0 || only.includes(id));

await withHarness(async ({ open }) => {
  for (const [id, { query, ...options }] of selected) {
    for (const scheme of ["light", "dark"]) {
      const page = await open(query, { ...options, scheme });
      await delay(400);
      const image = await page.screenshot();
      await page.close();
      const destination = previewDir ? path.join(previewDir, `${id}-${scheme}.webp`) : path.join(assets, id, `${id}-${scheme}.webp`);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, image);
      console.log(`${path.relative(root, destination)}  ${(image.length / 1024).toFixed(0)} KB`);
    }
  }
});
