import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readModelCalls } from "../server/modelCalls.ts";

const logFile = () => path.join(mkdtempSync(path.join(os.tmpdir(), "rocket-calls-")), "calls.jsonl");
const call = (at: string, provider: string, model: string, extra = {}) =>
  JSON.stringify({ at, event: "call", provider, model, status: 200, input_tokens: 5, output_tokens: 2, duration_ms: 1500, message_id: "m1", ...extra }) + "\n";
const response = (at: string, model: string, extra = {}) =>
  JSON.stringify({ at, event: "response", path: "/v1/chat/completions", status: 200, model, tokens_in: 5, tokens_out: 2, seconds: 1.5, request_id: "r1", ...extra }) + "\n";

test("shows this run's completed calls, newest first, with their provider", () => {
  const file = logFile();
  writeFileSync(file, call("2026-11-04T10:00:00Z", "meta", "muse-spark-1.3") + call("2026-11-04T11:00:00Z", "openai", "gpt-5.1") + call("2026-11-04T11:00:05Z", "anthropic", "claude-sonnet-4-5"));
  const calls = readModelCalls(file, "2026-11-04T10:30:00Z");
  assert.deepEqual(calls.map((entry) => `${entry.provider}/${entry.model}`), ["anthropic/claude-sonnet-4-5", "openai/gpt-5.1"]);
  assert.deepEqual(calls[0], { at: "2026-11-04T11:00:05Z", provider: "anthropic", model: "claude-sonnet-4-5", status: 200, tokensIn: 5, tokensOut: 2, seconds: 1.5, requestId: "m1" });
});

test("legacy Meta relay records still show", () => {
  const file = logFile();
  writeFileSync(file, response("2026-11-04T11:00:00Z", "muse-spark-1.3"));
  const [entry] = readModelCalls(file, "2026-11-04T00:00:00Z");
  assert.equal(entry.provider, null);
  assert.equal(entry.model, "muse-spark-1.3");
  assert.equal(entry.seconds, 1.5);
});

test("when both sources are present, the plugin's calls win so nothing is counted twice", () => {
  const file = logFile();
  writeFileSync(file, response("2026-11-04T11:00:00Z", "muse-spark-1.3") + call("2026-11-04T11:00:01Z", "meta", "muse-spark-1.3"));
  const calls = readModelCalls(file, "2026-11-04T00:00:00Z");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "meta");
});

test("leaves out requests still in flight and the check of a key", () => {
  const file = logFile();
  writeFileSync(file, JSON.stringify({ at: "2026-11-04T11:00:00Z", event: "request", model: "muse-spark-1.3" }) + "\n");
  appendFileSync(file, response("2026-11-04T11:00:01Z", "", { path: "/v1/models", model: null }));
  assert.deepEqual(readModelCalls(file, "2026-11-04T00:00:00Z"), []);
});

test("a call that failed is still shown, without a model", () => {
  const file = logFile();
  writeFileSync(file, call("2026-11-04T11:00:00Z", "openai", "", { status: 401, model: null, input_tokens: null, output_tokens: null }));
  const [entry] = readModelCalls(file, "2026-11-04T00:00:00Z");
  assert.equal(entry.status, 401);
  assert.equal(entry.model, null);
});

test("no log yet, or a damaged line, is not an error", () => {
  assert.deepEqual(readModelCalls("/nonexistent/calls.jsonl", ""), []);
  const file = logFile();
  writeFileSync(file, 'not json\n{"at": "2026"\n' + call("2026-11-04T11:00:00Z", "meta", "muse-spark-1.3"));
  assert.equal(readModelCalls(file, "").length, 1);
});
