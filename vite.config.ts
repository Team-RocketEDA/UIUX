import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createWorkspace, defaultOptions } from "./server/workspace";

// The workspace server (projects, files, checks, the project's agent) runs inside the dev server.
// Electron main will host the same module for the desktop app.
function workspace(env: Record<string, string>): Plugin {
  return {
    name: "rocketeda-workspace",
    configureServer(server) {
      const ws = createWorkspace(defaultOptions(env, process.cwd()));
      server.middlewares.use((req, res, next) => void ws.handle(req, res, next));
      server.httpServer?.on("close", ws.close);
    },
  };
}

export default defineConfig(({ mode }) => {
  // An empty prefix loads every variable from .env files and the shell.
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react(), workspace(env)] };
});
