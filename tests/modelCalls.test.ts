import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readModelCalls } from "../server/modelCalls.ts";

const logFile = () => path.join(mkdtempSync(path.join(os.tmpdir(), "rocket-calls-")), "calls.jsonl");
const response = (at: string, model: string, extra = {}) =>
  JSON.stringify({ at, event: "response", path: "/v1/chat/completions", status: 200, model, tokens_in: 5, tokens_out: 2, seconds: 1.5, request_id: "r1", ...extra }) + "\n";

test("shows this run's finished calls, newest first", () => {
  const file = logFile();
  writeFileSync(file, response("2026-11-04T10:00:00Z", "muse-spark-1.3") + response("2026-11-04T11:00:00Z", "muse-spark-1.3") + response("2026-11-04T11:00:05Z", "muse-wonder-1.0"));
  const calls = readModelCalls(file, "2026-11-04T10:30:00Z");
  assert.deepEqual(calls.map((call) => call.model), ["muse-wonder-1.0", "muse-spark-1.3"]);
  assert.deepEqual(calls[0], { at: "2026-11-04T11:00:05Z", model: "muse-wonder-1.0", status: 200, tokensIn: 5, tokensOut: 2, seconds: 1.5, requestId: "r1" });
});

test("leaves out requests still in flight and the check of a key", () => {
  const file = logFile();
  writeFileSync(file, JSON.stringify({ at: "2026-11-04T11:00:00Z", event: "request", model: "muse-spark-1.3" }) + "\n");
  appendFileSync(file, response("2026-11-04T11:00:01Z", "", { path: "/v1/models", model: null }));
  assert.deepEqual(readModelCalls(file, "2026-11-04T00:00:00Z"), []);
});

test("a call that failed is still shown, without a model", () => {
  const file = logFile();
  writeFileSync(file, response("2026-11-04T11:00:00Z", "", { status: 401, model: null, tokens_in: null, tokens_out: null }));
  const [call] = readModelCalls(file, "2026-11-04T00:00:00Z");
  assert.equal(call.status, 401);
  assert.equal(call.model, null);
});

test("no log yet, or a damaged line, is not an error", () => {
  assert.deepEqual(readModelCalls("/nonexistent/calls.jsonl", ""), []);
  const file = logFile();
  writeFileSync(file, 'not json\n{"at": "2026"\n' + response("2026-11-04T11:00:00Z", "muse-spark-1.3"));
  assert.equal(readModelCalls(file, "").length, 1);
});
