// Headless host: the built UI (dist/) and the workspace server on one port, for a browser. It is what Electron
// main does, without a window, so the app can run in a container. Passwords and model keys stay in this process.
import http from "node:http";
import path from "node:path";
import { serveStatic } from "./static";
import { createWorkspace, defaultOptions } from "./workspace";

const root = process.env.ROCKET_UI_ROOT || process.cwd();
const host = process.env.ROCKET_UI_HOST || "127.0.0.1";
const port = Number(process.env.ROCKET_UI_PORT) || 5173;

// The same .env the dev server and desktop app read; variables already set in the shell win.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // no .env
}

const workspace = createWorkspace(defaultOptions(process.env, root));
const dist = path.join(root, "dist");
const server = http.createServer((req, res) => void workspace.handle(req, res, () => serveStatic(dist, req, res)));

function stop() {
  workspace.close();
  server.close(() => process.exit(0));
  // Keep-alive browser connections would hold the server open.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

server.listen(port, host, () => console.log(`RocketIDE on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`));
