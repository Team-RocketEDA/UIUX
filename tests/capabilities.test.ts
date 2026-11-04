import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { capabilityKinds } from "../server/capabilities.ts";

// Trimmed from a real get_capabilities answer (engine GREEN bebfdb2, macOS, SAX installed, no Magic or KLayout).
const answer = JSON.parse(readFileSync(new URL("./fixtures/get-capabilities.json", import.meta.url), "utf8"));

test("keeps only operations that run on a tool, with the engine's readiness", () => {
  const kinds = capabilityKinds(answer);
  assert.deepEqual(kinds.map((k) => [k.operation, k.readiness]), [
    ["run_drc", "blocked"],
    ["run_optical", "ready"],
    ["run_post_layout", "ready"],
    ["run_spice", "ready"],
  ]);
});

test("passes on the engine's availability, missing list, remedy and reason unchanged", () => {
  const drc = capabilityKinds(answer).find((k) => k.operation === "run_drc")!;
  assert.equal(drc.reason, "No run_drc tool resolves on this machine.");
  const magic = drc.tools.find((t) => t.name === "magic")!;
  assert.equal(magic.available, false);
  assert.deepEqual(magic.missing, ["magic"]);
  assert.match(magic.remedy ?? "", /^Install Magic from source/);
  const optical = capabilityKinds(answer).find((k) => k.operation === "run_optical")!;
  assert.deepEqual(optical.tools.map((t) => [t.name, t.available]), [["sax", true], ["circulax", true]]);
  assert.equal(optical.reason, undefined);
});

test("an engine error is an error, not an empty tool list", () => {
  assert.throws(() => capabilityKinds({ error: { code: "unknown_project" } }), /unknown_project/);
  assert.throws(() => capabilityKinds(null), /no operations/);
});
