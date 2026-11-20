import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, testConnection } from "../server/providerTest.ts";
import type { EffectiveModelConfig } from "../server/modelConfig.ts";

const KEY = "sk-test-not-a-real-key-123456";

function config(overrides: Partial<EffectiveModelConfig> = {}): EffectiveModelConfig {
  return {
    configFile: "/tmp/model.json",
    providerId: "custom",
    modelId: "house-model",
    modelRef: "custom/house-model",
    providerType: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    providerName: "House API",
    smallModel: "custom/house-model",
    tutorModel: "custom/house-model",
    reviewerModel: "custom/house-model",
    apiKeyEnv: "MODEL_API_KEY",
    callLog: "/tmp/model-calls.jsonl",
    ...overrides,
  };
}

function fakeFetch(reply: () => Response | Promise<Response>, seen: { url?: string; init?: RequestInit } = {}) {
  return (async (url: any, init: any) => {
    seen.url = String(url);
    seen.init = init;
    return reply();
  }) as typeof fetch;
}

const chat = (content: string) => Response.json({ choices: [{ message: { role: "assistant", content } }] });

test("a minimal real chat request is sent to the configured base URL with the key and model", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const result = await testConnection(config(), KEY, { fetchImpl: fakeFetch(() => chat("pong"), seen) });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(seen.url, "https://api.example.com/v1/chat/completions");
  const headers = seen.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(String(seen.init?.body));
  assert.equal(body.model, "house-model");
  assert.equal(body.stream, false);
  assert.ok(Array.isArray(body.messages));
});

test("a 401 is reported as an authentication problem, and the key is scrubbed", async () => {
  const reply = () => Response.json({ error: { message: `bad key ${KEY}` } }, { status: 401 });
  const result = await testConnection(config(), KEY, { fetchImpl: fakeFetch(reply) });
  assert.equal(result.ok, false);
  assert.equal(result.category, "auth");
  assert.match(result.message, /refused this API key/i);
  assert.ok(!result.message.includes(KEY));
});

test("a 404 is reported as a model or endpoint problem", async () => {
  const result = await testConnection(config(), KEY, {
    fetchImpl: fakeFetch(() => Response.json({ error: { message: "unknown model" } }, { status: 404 })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.category, "model");
});

test("a 200 that is not a chat completion is reported as a protocol problem", async () => {
  const result = await testConnection(config(), KEY, {
    fetchImpl: fakeFetch(() => new Response("<html>hello</html>", { status: 200, headers: { "content-type": "text/html" } })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.category, "protocol");
});

test("a reply that ignores the request is not counted as success", async () => {
  const result = await testConnection(config(), KEY, { fetchImpl: fakeFetch(() => chat("I am not sure what you mean")) });
  assert.equal(result.ok, false);
  assert.equal(result.category, "protocol");
  assert.match(result.message, /not to a chat completion/i);
});

test("an unreachable endpoint is an actionable endpoint error", async () => {
  const result = await testConnection(config(), KEY, {
    fetchImpl: fakeFetch(() => Promise.reject(new Error("getaddrinfo ENOTFOUND api.example.com"))),
  });
  assert.equal(result.ok, false);
  assert.equal(result.category, "endpoint");
  assert.match(result.message, /Could not reach https:\/\/api\.example\.com\/v1/);
});

test("rate limits and provider outages are distinguished", async () => {
  const limited = await testConnection(config(), KEY, {
    fetchImpl: fakeFetch(() => Response.json({ error: { message: "slow down" } }, { status: 429 })),
  });
  assert.equal(limited.category, "rate_limit");
  const down = await testConnection(config(), KEY, {
    fetchImpl: fakeFetch(() => Response.json({ error: { message: "unavailable" } }, { status: 503 })),
  });
  assert.equal(down.category, "unavailable");
});

test("an OpenAI-compatible provider with no base URL is not guessed at", async () => {
  const result = await testConnection(config({ baseUrl: null }), KEY, { fetchImpl: fakeFetch(() => chat("pong")) });
  assert.equal(result.ok, false);
  assert.equal(result.category, "endpoint");
  assert.match(result.message, /base URL/i);
});

test("classification is shared and provider-neutral", () => {
  assert.equal(classify(401, "").category, "auth");
  assert.equal(classify(403, "").category, "auth");
  assert.equal(classify(400, "model does not exist").category, "model");
  assert.equal(classify(400, "unsupported protocol").category, "protocol");
  assert.equal(classify(400, "insufficient permission").category, "auth");
  assert.equal(classify(400, "bad key").category, "auth");
  assert.equal(classify(500, "").category, "unavailable");
});
