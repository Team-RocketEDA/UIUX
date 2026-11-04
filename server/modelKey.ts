// The Meta Model API key the student brings. It's kept in a private file on this machine, outside every project, and
// only the server reads it: the browser can save or remove a key but never gets one back.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

export type KeyStatus = { configured: boolean; source: "saved" | "env" | null };

export function credentialsFile(env: Env): string {
  if (env.ROCKET_CREDENTIALS_FILE) return env.ROCKET_CREDENTIALS_FILE;
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "rocketide", "credentials");
}

export function savedKey(file: string): string {
  try {
    return /^MODEL_API_KEY=(.*)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

// A key saved in the app wins over .env, because it's the one the student chose last.
export function currentKey(env: Env, file = credentialsFile(env)): string {
  return savedKey(file) || env.MODEL_API_KEY || "";
}

export function keyStatus(env: Env, file = credentialsFile(env)): KeyStatus {
  if (savedKey(file)) return { configured: true, source: "saved" };
  return env.MODEL_API_KEY ? { configured: true, source: "env" } : { configured: false, source: null };
}

// One line of printable characters, so it can't add lines to the file or to a request's headers.
export function cleanKey(raw: unknown): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key.length < 8 || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) throw new Error("That doesn't look like an API key. Paste the whole key, with no spaces.");
  return key;
}

export function saveKey(file: string, key: string): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Written beside the file, private from the start, and moved into place only once it's complete.
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `MODEL_API_KEY=${key}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

export function removeKey(file: string): void {
  if (existsSync(file)) rmSync(file);
}

// Asks the API whether it accepts the key. Only a clear refusal stops it being saved: if the API can't be reached
// right now, the key may still be good, so the caller saves it and says it wasn't checked.
export async function checkKey(key: string, env: Env, fetchImpl: typeof fetch = fetch): Promise<{ verified: boolean }> {
  const base = (env.ROCKET_META_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
  let status: number;
  try {
    const response = await fetchImpl(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    status = response.status;
  } catch {
    return { verified: false };
  }
  if (status === 401 || status === 403) throw new Error("Meta's API refused this key. Check it and try again.");
  return { verified: status >= 200 && status < 300 };
}
