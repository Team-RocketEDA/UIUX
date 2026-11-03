import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRows, jobStatus, type Constraints, type Evidence } from "../src/api.ts";

const constraints = { checks: [{ id: "a", title: "A", metric: "tb_pass", comparison: ">=", value: 1, required: true }] } as unknown as Constraints;
const run = (verdict: unknown) => ({ run_id: "r", finished_at: "2026-11-03T00:00:00Z", source_commit: "abc", verdict }) as unknown as Evidence;

test("a run with no measurements gives its verdict to the checks", () => {
  assert.equal(checkRows(constraints, [run({ status: "PASS" })], "abc")[0].status, "PASS");
  assert.equal(checkRows(constraints, [run({ status: "FAIL" })], "abc")[0].status, "FAIL");
});

test("a measured run only speaks for the metrics it measured", () => {
  const measured = run({ status: "PASS", measurements: [{ name: "other", status: "pass" }] });
  assert.equal(checkRows(constraints, [measured], "abc")[0].status, "NOT_RUN_YET");
});

test("a check that did not run stays NOT_RUN", () => {
  assert.equal(checkRows(constraints, [run({ status: "NOT_RUN", reason: "no tool" })], "abc")[0].status, "NOT_RUN");
});

test("the run console only calls a real FAIL failed", () => {
  assert.equal(jobStatus("PASS"), "passed");
  assert.equal(jobStatus("FAIL"), "failed");
  assert.equal(jobStatus("NOT_RUN"), "not_run");
  assert.equal(jobStatus("UNSUPPORTED"), "not_run");
});
