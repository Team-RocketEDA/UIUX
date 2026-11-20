import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanKey, credentialsFile, currentKey, keyStatus, removeProviderKey, saveProviderKey } from "../server/modelKey.ts";

const KEY = "sk-test-not-a-real-key";
const tempFile = () => path.join(mkdtempSync(path.join(os.tmpdir(), "rocket-key-")), "nested", "credentials");

test("a saved key is private to this user, and so is its folder", () => {
  const file = tempFile();
  saveProviderKey(file, "meta", KEY);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).keys.meta, KEY);
});

test("keys are kept separately by provider, and a saved key wins over .env", () => {
  const file = tempFile();
  saveProviderKey(file, "meta", KEY);
  saveProviderKey(file, "openai", "sk-openai-test-123456");
  assert.equal(currentKey({ MODEL_API_KEY: "from-dot-env" }, file, "meta"), KEY);
  assert.equal(currentKey({ OPENAI_API_KEY: "from-dot-env" }, file, "openai"), "sk-openai-test-123456");
  assert.equal(currentKey({ ANTHROPIC_API_KEY: "from-dot-env" }, file, "anthropic"), "from-dot-env");
  assert.deepEqual(keyStatus({ OPENAI_API_KEY: "x" }, file, "openai"), { configured: true, source: "saved", provider: "openai" });
});

test("a custom endpoint's key can come from its own environment name", () => {
  const file = tempFile();
  assert.equal(currentKey({ ROCKET_KEY_HOUSE: "sk-house-test" }, file, "house"), "sk-house-test");
  assert.deepEqual(keyStatus({ ROCKET_KEY_HOUSE: "sk-house-test" }, file, "house"), { configured: true, source: "env", provider: "house" });
  // MODEL_API_KEY is still accepted for an existing custom/ Meta setup.
  assert.equal(currentKey({ MODEL_API_KEY: "sk-legacy" }, file, "house"), "sk-legacy");
});

test("the original MODEL_API_KEY file still reads as the Meta key", () => {
  const file = tempFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `MODEL_API_KEY=${KEY}\n`);
  assert.equal(currentKey({}, file, "meta"), KEY);
  assert.deepEqual(keyStatus({}, file, "meta"), { configured: true, source: "saved", provider: "meta" });
});

test("removing one provider's key keeps the others", () => {
  const file = tempFile();
  saveProviderKey(file, "meta", KEY);
  saveProviderKey(file, "openai", "sk-openai-test-123456");
  removeProviderKey(file, "meta");
  assert.equal(currentKey({}, file, "meta"), "");
  assert.equal(currentKey({}, file, "openai"), "sk-openai-test-123456");
  removeProviderKey(file, "openai");
  assert.deepEqual(keyStatus({}, file, "openai"), { configured: false, source: null, provider: "openai" });
});

test("the status never holds a key", () => {
  const file = tempFile();
  saveProviderKey(file, "meta", KEY);
  assert.ok(!JSON.stringify(keyStatus({}, file, "meta")).includes(KEY));
});

test("removing a key that isn't there is fine", () => {
  assert.doesNotThrow(() => removeProviderKey(tempFile(), "meta"));
});

test("the file's location can be set, for a container's volume", () => {
  assert.equal(credentialsFile({ ROCKET_CREDENTIALS_FILE: "/stores/credentials" }), "/stores/credentials");
  assert.equal(credentialsFile({ XDG_CONFIG_HOME: "/x" }), "/x/rocketide/credentials");
});

test("spaces around a pasted key are removed", () => {
  assert.equal(cleanKey(`  ${KEY}\n`), KEY);
});

test("anything that could add a line, or isn't a key, is refused", () => {
  for (const bad of ["short", "two words here", `${KEY}\nEVIL=1`, "", undefined, 42, "x".repeat(513)]) {
    assert.throws(() => cleanKey(bad), /doesn't look like/);
  }
});
