// Provider-aware connection testing. For an OpenAI-compatible endpoint this makes a real minimal chat
// request, not just a /models probe. For a native OpenCode provider it asks the pinned OpenCode runtime to
// complete the same request, so authentication, model resolution and protocol handling are OpenCode's own.
// Keys stay on the server and are scrubbed from every message returned to the browser.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { EffectiveModelConfig } from "./modelConfig.ts";

const run = promisify(execFile);

export type TestResult = {
  ok: boolean;
  verified: boolean;
  category: "ok" | "auth" | "model" | "endpoint" | "protocol" | "rate_limit" | "unavailable" | "unknown";
  message: string;
  status?: number;
};

function scrub(text: string, key: string): string {
  return key ? text.split(key).join("***") : text;
}

function messageFromBody(body: string): string {
  try {
    const data = JSON.parse(body);
    return String(data?.error?.message ?? data?.message ?? data?.error ?? "").slice(0, 300);
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 300);
  }
}

export function classify(status: number, message: string): { category: TestResult["category"]; text: string } {
  const text = message || `HTTP ${status}`;
  if (status === 401 || status === 403) return { category: "auth", text: `The provider refused this API key. ${text}` };
  if (status === 404) return { category: "model", text: `The endpoint or model was not found. ${text}` };
  if (status === 429) return { category: "rate_limit", text: `The provider is rate limiting requests. ${text}` };
  if (status >= 500) return { category: "unavailable", text: `The provider is unavailable right now. ${text}` };
  if (/\bmodel\b.{0,40}(not found|unknown|does not exist)|unknown model|no such model/i.test(text)) {
    return { category: "model", text: `The provider does not know that model. ${text}` };
  }
  if (/bad key|invalid.{0,20}key|unauthori[sz]ed|authentication/i.test(text)) {
    return { category: "auth", text: `The provider refused this API key. ${text}` };
  }
  if (/permission|not authorized|insufficient/i.test(text)) return { category: "auth", text: `The provider refused permission. ${text}` };
  if (/unsupported|protocol/i.test(text)) return { category: "protocol", text: `The endpoint does not speak the expected protocol. ${text}` };
  return { category: status >= 400 ? "unknown" : "ok", text };
}

async function testOpenAICompatible(
  config: EffectiveModelConfig,
  key: string,
  fetchImpl: typeof fetch,
): Promise<TestResult> {
  if (!config.baseUrl) {
    return { ok: false, verified: false, category: "endpoint", message: "Enter the endpoint's base URL (for example https://api.example.com/v1)." };
  }
  const body = JSON.stringify({
    model: config.modelId,
    messages: [{ role: "user", content: "Reply with exactly the word: pong" }],
    max_tokens: 16,
    stream: false,
  });
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error: any) {
    return {
      ok: false,
      verified: false,
      category: "endpoint",
      message: scrub(`Could not reach ${config.baseUrl}: ${error?.message ?? error}`, key),
    };
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const detail = scrub(messageFromBody(text), key);
    const { category, text: message } = classify(response.status, detail);
    return { ok: false, verified: false, category, message, status: response.status };
  }
  let answer = "";
  try {
    const data = JSON.parse(text);
    answer = String(data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "");
  } catch {
    // A 2xx with a non-chat body means the endpoint isn't the protocol we asked for.
    return {
      ok: false,
      verified: false,
      category: "protocol",
      status: response.status,
      message: "The endpoint answered, but not with an OpenAI-compatible chat completion.",
    };
  }
  if (!/\bpong\b/i.test(answer)) {
    return {
      ok: false,
      verified: false,
      category: "protocol",
      status: response.status,
      message: `The model answered, but not to a chat completion request: ${scrub(answer.slice(0, 160), key)}`,
    };
  }
  return { ok: true, verified: true, category: "ok", status: response.status, message: `Connected: ${config.modelRef} completed a minimal request.` };
}

async function testNative(config: EffectiveModelConfig, key: string, fuelHome: string): Promise<TestResult> {
  const helper = path.join(fuelHome, "scripts", "test_connection.py");
  const env: NodeJS.ProcessEnv = { ...process.env, ROCKET_FUEL_HOME: fuelHome };
  const keyEnv = config.apiKeyEnv || "MODEL_API_KEY";
  if (key) env[keyEnv] = key;
  try {
    const { stdout } = await run("python3", ["-I", helper, "--provider", config.providerId, "--model", config.modelId,
      "--type", config.providerType, ...(config.baseUrl ? ["--base-url", config.baseUrl] : []), "--fuel-home", fuelHome],
      { env, timeout: 60000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
    return {
      ok: Boolean(result.ok),
      verified: Boolean(result.ok),
      category: result.category ?? (result.ok ? "ok" : "unknown"),
      message: scrub(String(result.message ?? (result.ok ? "Connected." : "The provider did not complete a request.")), key),
      status: result.status,
    };
  } catch (error: any) {
    const detail = String(error?.stdout || error?.stderr || error?.message || error).trim().split("\n").pop() || "unknown error";
    return { ok: false, verified: false, category: "unknown", message: scrub(`Connection test failed: ${detail.slice(0, 300)}`, key) };
  }
}

export async function testConnection(
  config: EffectiveModelConfig,
  key: string,
  options: { fuelHome?: string; fetchImpl?: typeof fetch } = {},
): Promise<TestResult> {
  if (config.providerType === "openai-compatible") {
    return testOpenAICompatible(config, key, options.fetchImpl ?? fetch);
  }
  return testNative(config, key, options.fuelHome || process.env.ROCKET_FUEL_HOME || path.resolve(process.cwd(), "..", "rocket_fuel"));
}
