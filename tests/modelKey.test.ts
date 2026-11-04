import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkKey, cleanKey, credentialsFile, currentKey, keyStatus, removeKey, saveKey } from "../server/modelKey.ts";

const KEY = "sk-test-not-a-real-key";
const tempFile = () => path.join(mkdtempSync(path.join(os.tmpdir(), "rocket-key-")), "nested", "credentials");

test("a saved key is private to this user, and so is its folder", () => {
  const file = tempFile();
  saveKey(file, KEY);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(readFileSync(file, "utf8"), `MODEL_API_KEY=${KEY}\n`);
});

test("a saved key wins over .env, and removing it falls back", () => {
  const file = tempFile();
  const env = { MODEL_API_KEY: "from-dot-env" };
  assert.equal(currentKey(env, file), "from-dot-env");
  assert.deepEqual(keyStatus(env, file), { configured: true, source: "env" });
  saveKey(file, KEY);
  assert.equal(currentKey(env, file), KEY);
  assert.deepEqual(keyStatus(env, file), { configured: true, source: "saved" });
  removeKey(file);
  assert.equal(currentKey(env, file), "from-dot-env");
});

test("no key anywhere is reported as such, and the status never holds a key", () => {
  assert.deepEqual(keyStatus({}, tempFile()), { configured: false, source: null });
  const file = tempFile();
  saveKey(file, KEY);
  assert.ok(!JSON.stringify(keyStatus({}, file)).includes(KEY));
});

test("removing a key that isn't there is fine", () => {
  assert.doesNotThrow(() => removeKey(tempFile()));
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

const answering = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;

test("the check sends the key to the API's models route", async () => {
  let seen: any;
  const fake = (async (url: string, init: any) => {
    seen = { url, auth: init.headers.Authorization };
    return new Response("{}");
  }) as unknown as typeof fetch;
  assert.deepEqual(await checkKey(KEY, { ROCKET_META_BASE_URL: "http://relay/v1/" }, fake), { verified: true });
  assert.deepEqual(seen, { url: "http://relay/v1/models", auth: `Bearer ${KEY}` });
});

test("a key the API refuses is an error, and the message doesn't repeat the key", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(checkKey(KEY, {}, answering(status)), (error: Error) => /refused/.test(error.message) && !error.message.includes(KEY));
  }
});

test("if the API can't say, the key isn't called verified", async () => {
  assert.deepEqual(await checkKey(KEY, {}, answering(500)), { verified: false });
  const down = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.deepEqual(await checkKey(KEY, {}, down), { verified: false });
});
