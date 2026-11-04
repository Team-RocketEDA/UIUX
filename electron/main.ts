// Desktop shell: one window over the same workspace server the dev server runs (server/workspace.ts).
// With VITE_DEV_SERVER_URL set it opens that dev server, which already hosts the workspace. Otherwise it
// serves the built UI (dist/) and the workspace itself on a loopback port, so `npm run desktop` needs no
// dev server. Passwords and model keys stay in this process, as they do in the dev server.
import { app, BrowserWindow, shell } from "electron";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { serveStatic } from "../server/static";
import { createWorkspace, defaultOptions } from "../server/workspace";

// The UIUX checkout: dist/ lives here, and the sibling repos (../rocket_fuel, ../rocket-engine) are found from it.
const root = app.getAppPath();

// The same .env the dev server reads; variables already set in the shell win.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // no .env
}

async function startWorkspace(): Promise<string> {
  const workspace = createWorkspace(defaultOptions(process.env, root));
  const dist = path.join(root, "dist");
  const server = http.createServer((req, res) => void workspace.handle(req, res, () => serveStatic(dist, req, res)));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  // Stops the project's agent with the app.
  app.on("will-quit", () => {
    workspace.close();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function openWindow(url: string) {
  const window = new BrowserWindow({
    // The RocketIDE mark, from public/ (copied into dist/ by the build), for the window and the taskbar.
    icon: path.join(root, "dist", "icon-512.png"),
    width: 1520,
    height: 940,
    minWidth: 1120,
    minHeight: 680,
    backgroundColor: "#0f0e0e",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // The window only shows the workbench; links to anything else open in the system browser.
  const external = (target: string) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
  };
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    external(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin === new URL(url).origin) return;
    event.preventDefault();
    external(target);
  });
  void window.loadURL(url);
}

app.on("window-all-closed", () => app.quit());

void app.whenReady().then(async () => {
  openWindow(process.env.VITE_DEV_SERVER_URL || (await startWorkspace()));
});
