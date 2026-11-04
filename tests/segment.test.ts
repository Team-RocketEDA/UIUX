import assert from "node:assert/strict";
import { test } from "node:test";
import { outputText, parseBoxes, segment } from "../server/segment.ts";

// The example line from the docs, with the mask payload elided as they do.
const LINE = "<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~abc|>,7<|box;x1=260;y1=382;x2=340;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,81,~def|>";
const stream = (text: string) =>
  [
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text.slice(0, 20) })}`,
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text.slice(20) })}`,
    `data: ${JSON.stringify({ type: "response.completed", response: { model: "sam-3.1" } })}`,
    "",
  ].join("\n\n");

test("reads each object's id and box, ignoring the mask", () => {
  assert.deepEqual(parseBoxes(LINE), [
    { id: 0, x1: 353, y1: 382, x2: 453, y2: 427, w: 537, h: 561 },
    { id: 7, x1: 260, y1: 382, x2: 340, y2: 427, w: 537, h: 561 },
  ]);
});

test("reads fields by key, so a confidence value doesn't matter", () => {
  assert.equal(parseBoxes("<0f>3<|box;c=0.91;x1=1;y1=2;x2=3;y2=4;w=10;h=10|>")[0].x2, 3);
});

test("no matches is an empty list", () => {
  assert.deepEqual(parseBoxes(outputText(stream(""))), []);
});

test("joins the stream's text deltas", () => {
  assert.equal(outputText(stream(LINE)), LINE);
});

test("a failed stream is an error, not an empty result", () => {
  const failed = `data: ${JSON.stringify({ type: "response.failed", response: { error: { message: "bad image" } } })}\n\n`;
  assert.throws(() => outputText(failed), /bad image/);
});

test("sends the prompt and picture to sam-3.1 with the key", async () => {
  let seen: any;
  const fake = (async (url: string, init: any) => {
    seen = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) };
    return new Response(stream(LINE));
  }) as unknown as typeof fetch;
  const result = await segment("data:image/png;base64,AAAA", "power rails", { MODEL_API_KEY: "k", ROCKET_META_BASE_URL: "http://relay/v1/" }, fake);
  assert.equal(seen.url, "http://relay/v1/responses");
  assert.equal(seen.auth, "Bearer k");
  assert.equal(seen.body.model, "sam-3.1");
  assert.deepEqual(seen.body.input[0].content[0], { type: "input_text", text: "power rails" });
  assert.equal(result.boxes.length, 2);
});

test("no key says what to do", async () => {
  await assert.rejects(segment("data:image/png;base64,AAAA", "x", {}), /Meta API key/);
});

test("an API error carries its message", async () => {
  const fake = (async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(segment("data:image/png;base64,AAAA", "x", { MODEL_API_KEY: "k" }, fake), /quota/);
});
