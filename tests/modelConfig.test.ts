import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ConfigError,
  callLogFile,
  effectiveModelConfig,
  modelConfigFile,
  modelEnv,
  saveModelConfig,
} from "../server/modelConfig.ts";

const tempFile = () => path.join(mkdtempSync(path.join(os.tmpdir(), "rocket-model-")), "rocketide", "model.json");

test("with nothing configured, the Meta default keeps working exactly as before", () => {
  const config = effectiveModelConfig({}, tempFile());
  assert.equal(config.modelRef, "meta/muse-spark-1.3");
  assert.equal(config.providerType, "openai-compatible");
  assert.equal(config.baseUrl, "https://api.meta.ai/v1");
  assert.equal(config.providerName, "Meta Model API");
  assert.equal(config.smallModel, "meta/muse-spark-1.3");
  assert.equal(config.tutorModel, "meta/muse-spark-1.3");
  assert.equal(config.reviewerModel, "meta/muse-wonder-1.0");
});

test("a native provider uses OpenCode's own integration and needs no base URL", () => {
  const config = effectiveModelConfig({ ROCKET_MODEL: "openai/gpt-5.1" }, tempFile());
  assert.equal(config.providerId, "openai");
  assert.equal(config.modelId, "gpt-5.1");
  assert.equal(config.providerType, "native");
  assert.equal(config.baseUrl, null);
  assert.equal(config.apiKeyEnv, "OPENAI_API_KEY");
  // Nothing Muse is assumed for a non-Meta provider.
  assert.equal(config.reviewerModel, "openai/gpt-5.1");
});

test("an unknown provider with a base URL is an OpenAI-compatible endpoint", () => {
  const config = effectiveModelConfig(
    { ROCKET_MODEL: "custom/house-model", ROCKET_BASE_URL: "https://api.example.com/v1/", ROCKET_PROVIDER_TYPE: "openai-compatible" },
    tempFile(),
  );
  assert.equal(config.providerType, "openai-compatible");
  assert.equal(config.baseUrl, "https://api.example.com/v1");
  assert.equal(config.modelRef, "custom/house-model");
});

test("an OpenAI-compatible provider without a base URL is refused with a useful message", () => {
  assert.throws(
    () => effectiveModelConfig({ ROCKET_MODEL: "custom/x", ROCKET_PROVIDER_TYPE: "openai-compatible" }, tempFile()),
    /base URL/i,
  );
});

test("role overrides are honoured, and a bare model ID inherits the provider", () => {
  const config = effectiveModelConfig({
    ROCKET_MODEL: "anthropic/claude-sonnet-4-5",
    ROCKET_SMALL_MODEL: "claude-haiku-4-5",
    ROCKET_TUTOR_MODEL: "openai/gpt-5-mini",
    ROCKET_REVIEWER_MODEL: "openai/gpt-5.1",
  }, tempFile());
  assert.equal(config.smallModel, "anthropic/claude-haiku-4-5");
  assert.equal(config.tutorModel, "openai/gpt-5-mini");
  assert.equal(config.reviewerModel, "openai/gpt-5.1");
});

test("unset roles inherit the main model, and the small model has a safe fallback", () => {
  const config = effectiveModelConfig({ ROCKET_MODEL: "groq/llama-3.3-70b" }, tempFile());
  assert.equal(config.smallModel, "groq/llama-3.3-70b");
  assert.equal(config.tutorModel, "groq/llama-3.3-70b");
  assert.equal(config.reviewerModel, "groq/llama-3.3-70b");
});

test("ROCKET_PROVIDER and ROCKET_MODEL_ID work without a combined ROCKET_MODEL", () => {
  const config = effectiveModelConfig({ ROCKET_PROVIDER: "deepseek", ROCKET_MODEL_ID: "deepseek-chat" }, tempFile());
  assert.equal(config.modelRef, "deepseek/deepseek-chat");
});

test("an explicitly exported model wins over the saved configuration", () => {
  const file = tempFile();
  saveModelConfig(file, { provider_id: "openai", model_id: "gpt-5.1", provider_type: "native" });
  assert.equal(effectiveModelConfig({}, file).modelRef, "openai/gpt-5.1");
  assert.equal(effectiveModelConfig({ ROCKET_MODEL: "meta/muse-spark-1.3" }, file).modelRef, "meta/muse-spark-1.3");
});

test("saving a configuration is read back unchanged, and holds no secret", () => {
  const file = tempFile();
  const saved = saveModelConfig(file, {
    provider_id: "custom",
    model_id: "house-model",
    provider_type: "openai-compatible",
    base_url: "https://api.example.com/v1",
    provider_name: "House API",
    tutor_model: "house-model-lite",
  });
  assert.equal(saved.modelRef, "custom/house-model");
  assert.equal(saved.baseUrl, "https://api.example.com/v1");
  assert.equal(saved.tutorModel, "custom/house-model-lite");
  const onDisk = readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("api_key"));
  assert.equal(statSync(file).mode & 0o777, 0o644);
  assert.equal(effectiveModelConfig({}, file).providerName, "House API");
});

test("a configuration file can never carry an API key", () => {
  const file = tempFile();
  assert.throws(
    () => saveModelConfig(file, { provider_id: "openai", model_id: "gpt-5.1", api_key: "sk-secret" }),
    /never holds one|separately/i,
  );
  // The same holds for a key hidden under a provider block, and for a file that was edited by hand.
  assert.throws(
    () => saveModelConfig(file, {
      provider_id: "custom", model_id: "m", provider_type: "openai-compatible", base_url: "https://api.example.com/v1",
      providers: { custom: { options: { apiKey: "sk-secret" } } },
    }),
    /never holds one|separately/i,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ provider_id: "openai", model_id: "gpt-5.1", providers: { openai: { apiKey: "sk-secret" } } }));
  assert.throws(() => effectiveModelConfig({}, file), /never be stored/i);
});

test("bad provider and model IDs, and a base URL with credentials, are refused", () => {
  const file = tempFile();
  assert.throws(() => saveModelConfig(file, { provider_id: "bad provider", model_id: "x" }), ConfigError);
  assert.throws(() => saveModelConfig(file, { provider_id: "openai", model_id: "has spaces" }), ConfigError);
  assert.throws(
    () => saveModelConfig(file, {
      provider_id: "custom", model_id: "x", provider_type: "openai-compatible",
      base_url: "https://user:pass@example.com/v1",
    }),
    /credentials/i,
  );
  assert.throws(() => effectiveModelConfig({ ROCKET_MODEL: "no-slash" }, file), /provider\/model/);
});

test("the agent environment carries the selected provider and injects the key only there", () => {
  const config = effectiveModelConfig({ ROCKET_MODEL: "openai/gpt-5.1" }, tempFile());
  const env = modelEnv(config, "sk-test-openai-123456");
  assert.equal(env.ROCKET_MODEL, "openai/gpt-5.1");
  assert.equal(env.ROCKET_PROVIDER_TYPE, "native");
  assert.equal(env.OPENAI_API_KEY, "sk-test-openai-123456");
  assert.ok(!JSON.stringify(env).includes("api_key"));
});

test("a custom OpenAI-compatible endpoint gets its own key variable, because its generated config reads it", () => {
  const config = effectiveModelConfig(
    { ROCKET_MODEL: "custom/house", ROCKET_BASE_URL: "https://api.example.com/v1", ROCKET_PROVIDER_TYPE: "openai-compatible" },
    tempFile(),
  );
  const env = modelEnv(config, "sk-house-123456");
  assert.equal(env.ROCKET_KEY_CUSTOM, "sk-house-123456");
  // The Meta capability keeps its own name, so a second endpoint cannot overwrite it.
  assert.equal(env.MODEL_API_KEY, undefined);
});

test("a role on another provider gets that provider's key too", () => {
  const config = effectiveModelConfig({
    ROCKET_MODEL: "openai/gpt-5.1",
    ROCKET_REVIEWER_MODEL: "anthropic/claude-sonnet-4-5",
  }, tempFile());
  const env = modelEnv(config, "sk-openai", { anthropic: "sk-anthropic" });
  assert.equal(env.OPENAI_API_KEY, "sk-openai");
  assert.equal(env.ANTHROPIC_API_KEY, "sk-anthropic");
});

test("the Meta default still reads MODEL_API_KEY", () => {
  const config = effectiveModelConfig({}, tempFile());
  assert.equal(modelEnv(config, "sk-meta").MODEL_API_KEY, "sk-meta");
});

test("local providers need no key, even when one is present", () => {
  const config = effectiveModelConfig({ ROCKET_MODEL: "ollama/llama3.3" }, tempFile());
  const env = modelEnv(config, "unused");
  assert.equal(env.OLLAMA_API_KEY, undefined);
  assert.equal(env.MODEL_API_KEY, undefined);
});

test("paths follow XDG_CONFIG_HOME and the overrides", () => {
  assert.equal(modelConfigFile({ XDG_CONFIG_HOME: "/x" }), "/x/rocketide/model.json");
  assert.equal(modelConfigFile({ ROCKET_MODEL_CONFIG: "/tmp/m.json", XDG_CONFIG_HOME: "/x" }), "/tmp/m.json");
  assert.equal(callLogFile({ XDG_CONFIG_HOME: "/x" }), "/x/rocketide/model-calls.jsonl");
  assert.equal(callLogFile({ XDG_CONFIG_HOME: "/x", ROCKET_META_CALL_LOG: "/tmp/old.jsonl" }), "/tmp/old.jsonl");
  assert.equal(callLogFile({ XDG_CONFIG_HOME: "/x", ROCKET_MODEL_CALL_LOG: "/tmp/new.jsonl" }), "/tmp/new.jsonl");
});
