/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "live" (opencode via the /agent proxy), "replay" (evals/replay_server.py) or unset for the built-in mock. */
  readonly VITE_ROCKET_AGENT?: "live" | "replay"
}
