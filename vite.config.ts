import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

declare function btoa(data: string): string;

// /agent is proxied to the Rocket Fuel agent (opencode) or a replay server. Auth is added here,
// on the dev server, so the password never reaches browser code.
export default defineConfig(({ mode }) => {
  // An empty prefix loads every variable from .env files and the shell.
  const env = loadEnv(mode, ".", "");
  const target = env.ROCKET_AGENT_URL || "http://127.0.0.1:4097";
  const password = env.OPENCODE_SERVER_PASSWORD;

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/agent": {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/agent/, ""),
          headers: password ? { Authorization: "Basic " + btoa(`opencode:${password}`) } : undefined,
        },
      },
    },
  };
});
