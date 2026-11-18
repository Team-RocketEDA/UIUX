import assert from "node:assert/strict";
import { test } from "node:test";
// The Rocket Fuel plugin is Bun/TypeScript; the record builder has no runtime imports, so its logic can be
// exercised by the same Node test runner the rest of the IDE uses.
import { modelCallRecord } from "../../rocket_fuel/plugin/src/modelCalls.ts";

const completed = (overrides: Record<string, unknown> = {}) => ({
  type: "message.updated",
  properties: {
    info: {
      id: "msg_1",
      sessionID: "ses_1",
      role: "assistant",
      providerID: "openai",
      modelID: "gpt-5.1",
      mode: "rocket-approval",
      time: { created: 1_700_000_000_000, completed: 1_700_000_001_250 },
      tokens: { input: 1200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } },
      ...overrides,
    },
  },
});

test("a completed assistant message becomes one provider-neutral call record", () => {
  const record = modelCallRecord(completed());
  assert.ok(record);
  assert.equal(record.event, "call");
  assert.equal(record.provider, "openai");
  assert.equal(record.model, "gpt-5.1");
  assert.equal(record.status, 200);
  assert.equal(record.duration_ms, 1250);
  assert.equal(record.input_tokens, 1200);
  assert.equal(record.output_tokens, 300);
  assert.equal(record.session_id, "ses_1");
  assert.equal(record.message_id, "msg_1");
  assert.equal(record.agent, "rocket-approval");
  assert.equal(record.at, new Date(1_700_000_001_250).toISOString());
});

test("the same message streaming is not recorded until it completes", () => {
  const streaming = completed({ time: { created: 1_700_000_000_000 } });
  assert.equal(modelCallRecord(streaming), null);
});

test("user messages, other events and empty input are ignored", () => {
  assert.equal(modelCallRecord(null), null);
  assert.equal(modelCallRecord({ type: "message.part.updated" }), null);
  assert.equal(modelCallRecord(completed({ role: "user" })), null);
});

test("a failed turn keeps its HTTP status, and an unclassified failure is a 500", () => {
  const unauthorized = modelCallRecord(completed({
    error: { name: "ProviderAuthError", data: { statusCode: 401, message: "bad key" } },
  }));
  assert.equal(unauthorized?.status, 401);
  const unknown = modelCallRecord(completed({ error: { name: "UnknownError" } }));
  assert.equal(unknown?.status, 500);
});

test("token usage is optional", () => {
  const record = modelCallRecord(completed({ tokens: undefined }));
  assert.equal(record?.input_tokens, null);
  assert.equal(record?.output_tokens, null);
});

test("a record contains no prompt, message text, headers or key", () => {
  const record = modelCallRecord(completed());
  const text = JSON.stringify(record);
  for (const leak of ["prompt", "messages", "authorization", "api_key", "apiKey", "content", "sk-"]) {
    assert.ok(!text.toLowerCase().includes(leak.toLowerCase()), `record leaked ${leak}: ${text}`);
  }
});
