// Chrome sin interfaz y servidor de Vite para el arnés de la guía. Usa un perfil
// temporal y el protocolo de depuración: no toca la pantalla ni el Chrome del usuario.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 1430;
const DEBUG_PORT = 9333;

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return {
    send(method, params = {}, sessionId) {
      id += 1;
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close: () => socket.close(),
  };
}

/**
 * Abre una página del arnés. `query` son sus parámetros (ver harness.tsx).
 * Devuelve utilidades para evaluar, pulsar teclas, hacer clic y capturar.
 */
async function openPage(client, query, { width = 900, height = 620, scale = 1, scheme = "light", reducedMotion = false, transparent = false } = {}) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => client.send(method, params, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  await send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: scheme },
      { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" },
    ],
  });
  if (transparent) await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `http://localhost:${PORT}/scripts/onboarding-screenshots/index.html?${query}` });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const waitFor = async (expression, timeout = 5000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression).catch(() => false)) return true;
      await delay(50);
    }
    throw new Error(`No se cumplió a tiempo: ${expression}`);
  };
  await waitFor("document.documentElement.dataset.harnessReady === 'true' && [...document.images].every((image) => image.complete)", 10_000);

  const keyCodes = { ArrowRight: 39, ArrowLeft: 37, Escape: 27, Enter: 13, Tab: 9 };
  return {
    evaluate,
    waitFor,
    async key(key) {
      const code = keyCodes[key];
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
      await delay(120);
    },
    /** Clic real del ratón en el centro del primer botón, enlace o casilla con ese texto. */
    async click(text) {
      const point = await evaluate(`(() => {
        const candidates = [...document.querySelectorAll('button, label, a, [role="tab"]')];
        const element = candidates.find((candidate) => candidate.textContent.trim().includes(${JSON.stringify(text)}) || candidate.getAttribute('aria-label') === ${JSON.stringify(text)});
        if (!element) return null;
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        return { x: rect.left + Math.min(rect.width / 2, 12), y: rect.top + rect.height / 2 };
      })()`);
      if (!point) throw new Error(`No hay ningún control «${text}»`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
      }
      await delay(150);
    },
    async screenshot() {
      const { data } = await send("Page.captureScreenshot", { format: "webp", quality: 82 });
      return Buffer.from(data, "base64");
    },
    close: () => client.send("Target.closeTarget", { targetId }),
  };
}

/** Arranca Vite y Chrome, ejecuta `task` y lo cierra todo aunque falle. */
export async function withHarness(task) {
  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    server: { port: PORT, strictPort: true, hmr: false },
    logLevel: "error",
  });
  await server.listen();
  const profile = await mkdtemp(path.join(tmpdir(), "flowdesk-arnes-"));
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--lang=es-ES",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    let version;
    for (let attempt = 0; attempt < 50 && !version; attempt += 1) {
      version = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((response) => response.json()).catch(() => undefined);
      if (!version) await delay(200);
    }
    if (!version) throw new Error("Chrome no respondió");
    const client = await connect(version.webSocketDebuggerUrl);
    try {
      return await task({ open: (query, options) => openPage(client, query, options) });
    } finally {
      client.close();
    }
  } finally {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await exited;
    await server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
