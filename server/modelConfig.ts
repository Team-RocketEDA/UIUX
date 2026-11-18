// One provider-neutral model configuration, shared by the workspace server and the settings UI.
// The canonical file is ~/.config/rocketide/model.json (or ROCKET_MODEL_CONFIG). Environment variables win
// over the file, which keeps existing .env installations working. API keys never live here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

export type ProviderType = "native" | "openai-compatible";

export type ModelSettings = {
  provider_id: string;
  model_id: string;
  provider_type?: ProviderType;
  base_url?: string | null;
  provider_name?: string | null;
  small_model?: string | null;
  tutor_model?: string | null;
  reviewer_model?: string | null;
  models?: Record<string, unknown>;
  providers?: Record<string, unknown>;
  api_key_env?: string | null;
  api_key?: string;
};

export type EffectiveModelConfig = {
  configFile: string;
  providerId: string;
  modelId: string;
  modelRef: string;
  providerType: ProviderType;
  baseUrl: string | null;
  providerName: string;
  smallModel: string;
  tutorModel: string;
  reviewerModel: string;
  apiKeyEnv: string;
  callLog: string;
};

export const DEFAULT_PROVIDER = "meta";
export const DEFAULT_MODEL = "muse-spark-1.3";
export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MODEL_REF = `${DEFAULT_PROVIDER}/${DEFAULT_MODEL}`;

// Native providers in the pinned OpenCode 1.19.5 catalog. The list is a UI convenience, not an allowlist:
// any provider ID can be entered, and an unknown one with a base URL uses the OpenAI-compatible adapter.
export const NATIVE_PROVIDERS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  "google-vertex": "Google Vertex AI",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  groq: "Groq",
  openrouter: "OpenRouter",
  together: "Together AI",
  fireworks: "Fireworks AI",
  xai: "xAI",
  "amazon-bedrock": "Amazon Bedrock",
  azure: "Azure OpenAI",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  "github-copilot": "GitHub Copilot",
  opencode: "OpenCode Zen",
};

// Local servers need no key.
export const KEYLESS_PROVIDERS = ["ollama", "lmstudio", "llamacpp", "vllm"];

export function customKeyEnv(provider: string): string {
  return "ROCKET_KEY_" + provider.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}

// A non-Meta OpenAI-compatible endpoint gets its own environment name, so a role on another provider can
// never overwrite the main endpoint's key.
export function providerEnvNames(provider: string, providerType: ProviderType = "native"): string[] {
  if (provider === DEFAULT_PROVIDER) return ["MODEL_API_KEY"];
  if (providerType === "native" && has(PROVIDER_KEY_ENVS, provider)) return PROVIDER_KEY_ENVS[provider];
  return [customKeyEnv(provider)];
}

export const PROVIDER_KEY_ENVS: Record<string, string[]> = {
  meta: ["MODEL_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_VERTEX_API_KEY", "GOOGLE_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  xai: ["XAI_API_KEY"],
  "amazon-bedrock": ["AWS_ACCESS_KEY_ID"],
  azure: ["AZURE_API_KEY"],
  "github-copilot": ["GITHUB_TOKEN"],
};

const PROVIDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const has = (table: object, key: string) => Object.prototype.hasOwnProperty.call(table, key);

export class ConfigError extends Error {}

export function configHome(env: Env): string {
  return env.ROCKET_CONFIG_HOME || env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

export function modelConfigFile(env: Env): string {
  return env.ROCKET_MODEL_CONFIG || path.join(configHome(env), "rocketide", "model.json");
}

export function callLogFile(env: Env): string {
  return env.ROCKET_MODEL_CALL_LOG || env.ROCKET_META_CALL_LOG || path.join(configHome(env), "rocketide", "model-calls.jsonl");
}

export function splitRef(ref: string): [string, string] {
  const slash = typeof ref === "string" ? ref.indexOf("/") : -1;
  if (slash <= 0) throw new ConfigError(`Model must be written as provider/model, not ${JSON.stringify(ref)}.`);
  const provider = ref.slice(0, slash);
  const model = ref.slice(slash + 1);
  if (!PROVIDER_RE.test(provider)) throw new ConfigError(`Invalid provider ID "${provider}".`);
  if (!model || model.startsWith("/") || /\s/.test(model)) throw new ConfigError("Enter a model ID with no spaces.");
  return [provider, model];
}

// A key must never be saved inside the configuration, at any depth or under any spelling.
function findKey(value: any, prefix = ""): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findKey(item, `${prefix}[${index}]`);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const where = prefix ? `${prefix}.${key}` : key;
      if (["api_key", "api-key", "apikey"].includes(key.toLowerCase())) return where;
      const found = findKey(item, where);
      if (found) return found;
    }
  }
  return null;
}

export function providerEnvName(provider: string): string {
  return (has(PROVIDER_KEY_ENVS, provider) ? PROVIDER_KEY_ENVS[provider] : ["MODEL_API_KEY"])[0];
}

function cleanBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new ConfigError("The API base URL must start with http:// or https://.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError("That is not a valid API base URL.");
  }
  if (parsed.username || parsed.password) throw new ConfigError("Put credentials in the API key field, not in the base URL.");
  return url;
}

export function readModelSettings(file = ""): Record<string, any> {
  if (!file || !existsSync(file)) return {};
  let data: any;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error: any) {
    throw new ConfigError(`Could not read ${file}: ${error?.message ?? error}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ConfigError(`${file} must contain a JSON object.`);
  const found = findKey(data);
  if (found) throw new ConfigError(`API keys must never be stored in the model configuration file (${found}).`);
  return data;
}

function inferType(provider: string, type: unknown, baseUrl: string | null): ProviderType {
  if (type === "native" || type === "openai-compatible") return type;
  if (has(NATIVE_PROVIDERS, provider)) return "native";
  return provider === DEFAULT_PROVIDER || baseUrl ? "openai-compatible" : "native";
}

function roleRef(value: unknown, provider: string, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const ref = value.includes("/") ? value : `${provider}/${value}`;
  splitRef(ref);
  return ref;
}

export function effectiveModelConfig(env: Env, file = modelConfigFile(env)): EffectiveModelConfig {
  const saved = readModelSettings(file);
  const savedRef = typeof saved.model_ref === "string"
    ? saved.model_ref
    : saved.provider_id && saved.model_id ? `${saved.provider_id}/${saved.model_id}` : DEFAULT_MODEL_REF;

  let ref = env.ROCKET_MODEL || savedRef;
  if (!env.ROCKET_MODEL && (env.ROCKET_PROVIDER || env.ROCKET_MODEL_ID)) {
    const [savedProvider, savedModel] = splitRef(savedRef);
    ref = `${env.ROCKET_PROVIDER || savedProvider}/${env.ROCKET_MODEL_ID || (env.ROCKET_PROVIDER ? DEFAULT_MODEL : savedModel)}`;
  }
  const [providerId, modelId] = splitRef(ref);

  const baseUrl = cleanBaseUrl(env.ROCKET_BASE_URL || env.ROCKET_META_BASE_URL || saved.base_url)
    ?? (providerId === DEFAULT_PROVIDER ? DEFAULT_BASE_URL : null);
  const providerType = inferType(providerId, env.ROCKET_PROVIDER_TYPE || saved.provider_type, baseUrl);
  if (providerType === "openai-compatible" && !baseUrl) {
    throw new ConfigError(`Provider "${providerId}" is OpenAI-compatible, so a base URL is required.`);
  }
  const providerName = env.ROCKET_PROVIDER_NAME || saved.provider_name
    || (has(NATIVE_PROVIDERS, providerId) ? NATIVE_PROVIDERS[providerId] : undefined)
    || (providerId === DEFAULT_PROVIDER ? "Meta Model API" : providerId);

  const reviewerDefault = providerId === DEFAULT_PROVIDER ? "meta/muse-wonder-1.0" : ref;
  return {
    configFile: file,
    providerId,
    modelId,
    modelRef: ref,
    providerType,
    baseUrl: providerType === "openai-compatible" ? baseUrl : null,
    providerName,
    smallModel: roleRef(env.ROCKET_SMALL_MODEL || saved.small_model, providerId, ref),
    tutorModel: roleRef(env.ROCKET_TUTOR_MODEL || saved.tutor_model, providerId, ref),
    reviewerModel: roleRef(env.ROCKET_REVIEWER_MODEL || saved.reviewer_model, providerId, reviewerDefault),
    apiKeyEnv: saved.api_key_env || providerEnvName(providerId),
    callLog: callLogFile(env),
  };
}

export function saveModelConfig(file: string, input: ModelSettings): EffectiveModelConfig {
  const provider = String(input.provider_id ?? "").trim();
  const model = String(input.model_id ?? "").trim();
  if (!PROVIDER_RE.test(provider)) throw new ConfigError("Use letters, digits, '.', '_' or '-' for the provider ID.");
  if (!model || model.startsWith("/") || /\s/.test(model)) throw new ConfigError("Enter a model ID with no spaces.");
  const found = findKey(input);
  if (found) throw new ConfigError(`API keys are stored separately; the model configuration never holds one (${found}).`);
  const baseUrl = cleanBaseUrl(input.base_url) ?? (provider === DEFAULT_PROVIDER ? DEFAULT_BASE_URL : null);
  const providerType = inferType(provider, input.provider_type, baseUrl);
  if (providerType === "openai-compatible" && !baseUrl) throw new ConfigError("A base URL is required for an OpenAI-compatible provider.");

  const saved: Record<string, unknown> = {
    version: 1,
    provider_id: provider,
    model_id: model,
    model_ref: `${provider}/${model}`,
    provider_type: providerType,
    base_url: providerType === "openai-compatible" ? baseUrl : null,
    provider_name: input.provider_name?.trim() || (has(NATIVE_PROVIDERS, provider) ? NATIVE_PROVIDERS[provider] : undefined) || provider,
  };
  for (const key of ["small_model", "tutor_model", "reviewer_model"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const ref = value.includes("/") ? value.trim() : `${provider}/${value.trim()}`;
      splitRef(ref);
      saved[key] = ref;
    }
  }
  if (input.models && typeof input.models === "object") saved.models = input.models;
  if (input.providers && typeof input.providers === "object") saved.providers = input.providers;
  if (input.api_key_env) saved.api_key_env = input.api_key_env;

  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(saved, null, 2) + "\n", { mode: 0o644 });
  renameSync(temporary, file);
  return effectiveModelConfig({ ROCKET_MODEL_CONFIG: file }, file);
}

// Everything dev.sh and opencode need, with a credential injected only into the environment.
export function modelEnv(config: EffectiveModelConfig, key: string, roleKeys: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    ROCKET_MODEL: config.modelRef,
    ROCKET_PROVIDER: config.providerId,
    ROCKET_MODEL_ID: config.modelId,
    ROCKET_PROVIDER_TYPE: config.providerType,
    ROCKET_PROVIDER_NAME: config.providerName,
    ROCKET_SMALL_MODEL: config.smallModel,
    ROCKET_TUTOR_MODEL: config.tutorModel,
    ROCKET_REVIEWER_MODEL: config.reviewerModel,
    ROCKET_MODEL_CONFIG: config.configFile,
    ROCKET_MODEL_CALL_LOG: config.callLog,
  };
  if (config.baseUrl) env.ROCKET_BASE_URL = config.baseUrl;
  // Every role may use a different provider, so each provider's key is injected under its own name.
  const providers = new Set<string>();
  for (const ref of [config.modelRef, config.smallModel, config.tutorModel, config.reviewerModel]) {
    const slash = ref.indexOf("/");
    if (slash > 0) providers.add(ref.slice(0, slash));
  }
  for (const provider of providers) {
    const value = provider === config.providerId ? key : roleKeys[provider];
    if (!value || KEYLESS_PROVIDERS.includes(provider)) continue;
    const type: ProviderType = provider === config.providerId
      ? config.providerType
      : (has(NATIVE_PROVIDERS, provider) ? "native" : "openai-compatible");
    for (const name of providerEnvNames(provider, type)) env[name] = value;
  }
  return env;
}
