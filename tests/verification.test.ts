import assert from "node:assert/strict";
import { test } from "node:test";
import { gauge, moduleCoverage, splitSources, toolFor, trend } from "../src/verification.ts";

const run = (over: Record<string, unknown>) =>
  ({ run_id: "r", operation: "run_spice", finished_at: "2026", source_commit: "abc", source_dirty: false, sources: [], verdict: { status: "PASS", measurements: [] }, ...over }) as any;
const module = (name: string, file = `src/${name}.v`) => ({ name, file, ports: [], instances: [] });

test("a gauge shows both numbers on its bar, with the passing side known", () => {
  const above = gauge({ comparison: ">=", value: 1.5 }, 0.159)!;
  assert.equal(above.passAbove, true);
  assert.ok(above.valueAt < above.targetAt, "the measurement sits below the target");
  for (const at of [above.valueAt, above.targetAt]) assert.ok(at > 0 && at < 100);
  const below = gauge({ comparison: "<=", value: 1.7 }, 0.159)!;
  assert.equal(below.passAbove, false);
});

test("a gauge copes with equal numbers, zero and nonsense", () => {
  const same = gauge({ comparison: ">=", value: 0 }, 0)!;
  assert.ok(Number.isFinite(same.valueAt));
  assert.equal(gauge({ comparison: ">=", value: 1 }, Number.NaN), undefined);
});

test("a trend is oldest first, and skips runs that didn't measure it", () => {
  const evidence = [
    run({ source_commit: "new", verdict: { status: "PASS", measurements: [{ name: "gain", value: 21, status: "pass" }] } }),
    run({ source_commit: "mid", verdict: { status: "NOT_RUN" } }),
    run({ source_commit: "old", verdict: { status: "FAIL", measurements: [{ name: "gain", value: 6, status: "fail" }] } }),
  ];
  assert.deepEqual(trend("gain", evidence).map((point) => [point.value, point.passed, point.revision]), [[6, false, "old"], [21, true, "new"]]);
  assert.deepEqual(trend("other", evidence), []);
});

test("a block counts as tested only if a run simulated its file at this revision", () => {
  const modules = [module("mac_unit"), module("div_unit"), module("old_block"), module("alone")];
  const entries = [{ path: "src/tb/div_unit/tb_div_unit.v" }, { path: "src/alone.v" }];
  const evidence = [run({ sources: ["src/mac_unit.v", "src/tb/tb_mac_unit.v"] }), run({ source_commit: "older", sources: ["/work/src/old_block.v"] })];
  const states = Object.fromEntries(moduleCoverage(modules, entries, evidence, "abc").map((item) => [item.module, item.state]));
  assert.deepEqual(states, { mac_unit: "passed", div_unit: "testbench", old_block: "stale", alone: "none" });
});

test("a module defined in two files counts once, by its most telling state", () => {
  const result = moduleCoverage([module("a", "other/a.v"), module("a", "src/a.v")], [], [run({ sources: ["src/a.v"] })], "abc");
  assert.deepEqual(result.map((item) => [item.module, item.state]), [["a", "passed"]]);
});

test("a failing run shows, and comes first", () => {
  const result = moduleCoverage([module("a"), module("b")], [], [run({ sources: ["src/b.v"], verdict: { status: "FAIL" } })], "abc");
  assert.deepEqual(result[0], { module: "b", file: "src/b.v", state: "failed", testbench: undefined });
});

test("uncommitted changes make a pass stale", () => {
  assert.equal(moduleCoverage([module("a")], [], [run({ sources: ["src/a.v"], source_dirty: true })], "abc")[0].state, "stale");
});

test("names the tool, and separates design files from tests", () => {
  assert.equal(toolFor("run_hdl_test"), "Icarus Verilog");
  assert.equal(toolFor("run_new_thing"), "new thing");
  assert.deepEqual(splitSources(["design/a.cir", "tests/tb_a.cir", "src/tb/tb_x.v", "src/x.v"]), { design: ["design/a.cir", "src/x.v"], tests: ["tests/tb_a.cir", "src/tb/tb_x.v"] });
});
