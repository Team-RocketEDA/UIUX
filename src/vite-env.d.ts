/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "replay" streams a recording from rocket_fuel's evals/replay_server.py; unset = the project's live agent. */
  readonly VITE_ROCKET_AGENT?: "replay"
}
