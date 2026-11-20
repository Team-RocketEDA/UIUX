// Provider-aware credentials you bring. They are kept in a private file on this machine, outside every
// project, and only the server reads them: the browser can save, replace or remove a key but never gets one
// back. The file understands both the original "MODEL_API_KEY=..." format and the newer JSON form, so an
// existing Meta key keeps working without migration.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { customKeyEnv, PROVIDER_KEY_ENVS } from "./modelConfig.ts";

type Env = Record<string, string | undefined>;
type Credentials = { keys: Record<string, string>; legacy: boolean };

export type KeyStatus = { configured: boolean; source: "saved" | "env" | null; provider: string };

export function credentialsFile(env: Env): string {
  if (env.ROCKET_CREDENTIALS_FILE) return env.ROCKET_CREDENTIALS_FILE;
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "rocketide", "credentials");
}

export function readCredentials(file: string): Credentials {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { keys: {}, legacy: false };
  }
  if (text.trimStart().startsWith("{")) {
    try {
      const data = JSON.parse(text);
      const keys = data?.keys && typeof data.keys === "object" ? data.keys : {};
      const clean = Object.fromEntries(Object.entries(keys).filter(([, value]) => typeof value === "string" && value)) as Record<string, string>;
      return { keys: clean, legacy: false };
    } catch {
      return { keys: {}, legacy: false };
    }
  }
  const key = /^MODEL_API_KEY=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
  return { keys: key ? { meta: key } : {}, legacy: true };
}

export function savedKey(file: string, provider = "meta"): string {
  return readCredentials(file).keys[provider] ?? "";
}

function envNames(provider: string): string[] {
  if (provider === "meta") return ["MODEL_API_KEY"];
  const standard = Object.prototype.hasOwnProperty.call(PROVIDER_KEY_ENVS, provider) ? PROVIDER_KEY_ENVS[provider] : undefined;
  // A custom endpoint has its own name; MODEL_API_KEY stays accepted for compatibility.
  return standard ?? [customKeyEnv(provider), "MODEL_API_KEY"];
}

function envKey(env: Env, provider: string): string {
  for (const name of envNames(provider)) {
    if (env[name]) return env[name]!;
  }
  return "";
}

// A key saved in the app wins over .env, because it's the one chosen last.
export function currentKey(env: Env, file = credentialsFile(env), provider = env.ROCKET_PROVIDER || "meta"): string {
  return savedKey(file, provider) || envKey(env, provider);
}

export function keyStatus(env: Env, file = credentialsFile(env), provider = env.ROCKET_PROVIDER || "meta"): KeyStatus {
  if (savedKey(file, provider)) return { configured: true, source: "saved", provider };
  return envKey(env, provider) ? { configured: true, source: "env", provider } : { configured: false, source: null, provider };
}

// One line of printable characters, so it can't add lines to the file or to a request's headers.
export function cleanKey(raw: unknown): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key.length < 8 || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) throw new Error("That doesn't look like an API key. Paste the whole key, with no spaces.");
  return key;
}

export function saveProviderKey(file: string, provider: string, key: string): void {
  const existing = readCredentials(file);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(file), 0o700);
  // Written beside the file, private from the start, and moved into place only once it's complete.
  const temporary = `${file}.${process.pid}.tmp`;
  const data = { version: 1, keys: { ...existing.keys, [provider]: key } };
  writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

export function saveKey(file: string, key: string, provider = "meta"): void {
  saveProviderKey(file, provider, key);
}

export function removeProviderKey(file: string, provider: string): void {
  const existing = readCredentials(file);
  delete existing.keys[provider];
  if (!Object.keys(existing.keys).length) {
    if (existsSync(file)) rmSync(file);
    return;
  }
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, keys: existing.keys }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

export function removeKey(file: string, provider = "meta"): void {
  removeProviderKey(file, provider);
}
