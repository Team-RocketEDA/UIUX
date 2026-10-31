// RocketEDA Desktop Shell (Electron Main Process)
// Implements rocket_fuel/docs/BOUNDARIES.md Contract 2:
// - Proxies /agent requests with Basic Auth (opencode:<OPENCODE_SERVER_PASSWORD>) so secrets never enter renderer bundles
// - Isolates XDG_* directories under app userData so pinned opencode 1.x never collides with a global opencode v2 DB
// - Sets PWD explicitly to the target chip project root when spawning opencode serve

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the isolated environment required by Rocket Fuel Contract 2.
 */
export function buildHarnessEnv({
  baseEnv = process.env,
  projectDir,
  appDataDir,
  serverPassword,
  modelApiKey,
  rocketFuelHome,
  pdkRoots,
  rocketModel,
}) {
  const xdgRoot = path.join(appDataDir, "opencode-xdg");
  const xdgData = path.join(xdgRoot, "data");
  const xdgConfig = path.join(xdgRoot, "config");
  const xdgState = path.join(xdgRoot, "state");
  const xdgCache = path.join(xdgRoot, "cache");

  for (const dir of [xdgData, xdgConfig, xdgState, xdgCache]) {
    mkdirSync(dir, { recursive: true });
  }

  const env = {
    ...baseEnv,
    PWD: projectDir,
    OPENCODE_SERVER_PASSWORD: serverPassword,
    XDG_DATA_HOME: xdgData,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_STATE_HOME: xdgState,
    XDG_CACHE_HOME: xdgCache,
  };

  if (modelApiKey) env.MODEL_API_KEY = modelApiKey;
  if (rocketFuelHome) env.ROCKET_FUEL_HOME = rocketFuelHome;
  if (pdkRoots) env.ROCKET_PDK_ROOTS = pdkRoots;
  if (rocketModel) env.ROCKET_MODEL = rocketModel;

  return env;
}

export async function launchElectronShell() {
  const electron = await import("electron");
  const { app, BrowserWindow, ipcMain, session } = electron.default ?? electron;

  const serverPassword =
    process.env.OPENCODE_SERVER_PASSWORD || randomBytes(18).toString("hex");
  const agentTargetUrl = process.env.ROCKET_AGENT_URL || "http://127.0.0.1:4097";
  const engineTargetUrl = process.env.ROCKET_ENGINE_URL || "http://127.0.0.1:4098";
  const projectDir = process.env.ROCKET_PROJECT_DIR || process.cwd();

  let harnessChild = null;

  function maybeSpawnHarness() {
    if (!process.env.ROCKET_SPAWN_HARNESS) return;
    const env = buildHarnessEnv({
      projectDir,
      appDataDir: app.getPath("userData"),
      serverPassword,
      modelApiKey: process.env.MODEL_API_KEY,
      rocketFuelHome: process.env.ROCKET_FUEL_HOME,
      pdkRoots: process.env.ROCKET_PDK_ROOTS,
      rocketModel: process.env.ROCKET_MODEL,
    });
    const port = new URL(agentTargetUrl).port || "4097";
    harnessChild = spawn(
      "npx",
      ["opencode-ai@1.19.5", "serve", "--hostname", "127.0.0.1", "--port", port],
      {
        cwd: projectDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }

  app.whenReady().then(() => {
    maybeSpawnHarness();

    // Inject Basic Auth header for loopback opencode requests so password never reaches renderer
    const authHeader =
      "Basic " + Buffer.from(`opencode:${serverPassword}`, "utf8").toString("base64");
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: [`${agentTargetUrl}/*`] },
      (details, callback) => {
        details.requestHeaders["Authorization"] = authHeader;
        callback({ requestHeaders: details.requestHeaders });
      },
    );

    ipcMain.handle("rocket:get-runtime-info", () => ({
      platform: process.platform,
      projectDir,
      agentTargetUrl,
      engineTargetUrl,
      isolatedXdg: true,
    }));

    const mainWindow = new BrowserWindow({
      width: 1520,
      height: 940,
      minWidth: 1120,
      minHeight: 680,
      backgroundColor: "#09090b",
      title: "RocketEDA Workbench",
      webPreferences: {
        preload: path.join(__dirname, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      mainWindow.loadURL(devServerUrl);
    } else {
      mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }
  });

  app.on("will-quit", () => {
    if (harnessChild && !harnessChild.killed) {
      harnessChild.kill("SIGTERM");
    }
  });
}

if (process.versions.electron) {
  launchElectronShell();
}
