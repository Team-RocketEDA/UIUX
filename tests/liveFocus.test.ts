import assert from "node:assert/strict";
import { test } from "node:test";
import { changedFiles, liveFocus, stepFile, stepKind } from "../src/agent/liveFocus.ts";

const step = (id: string, tool: string, input: Record<string, unknown>, time: number, status = "completed") =>
  ({ id, tool, label: tool, status, input, time }) as any;
const DIR = "/home/me/projects/chip";

test("sorts tools into what they do", () => {
  assert.equal(stepKind(step("a", "write", {}, 1)), "edit");
  assert.equal(stepKind(step("a", "rocket_apply_revision", {}, 1)), "edit");
  assert.equal(stepKind(step("a", "engine_run_spice", {}, 1)), "run");
  assert.equal(stepKind(step("a", "rocket_run_job", {}, 1)), "run");
  assert.equal(stepKind(step("a", "read", {}, 1)), "read");
  assert.equal(stepKind(step("a", "engine_get_check_results", {}, 1)), "read");
});

test("a file is shown relative to the project, and one outside it isn't shown", () => {
  assert.equal(stepFile(step("a", "write", { filePath: `${DIR}/src/a.v` }, 1), DIR), "src/a.v");
  assert.equal(stepFile(step("a", "write", { filePath: "./src/a.v" }, 1), DIR), "src/a.v");
  assert.equal(stepFile(step("a", "write", { filePath: "/etc/passwd" }, 1), DIR), undefined);
  assert.equal(stepFile(step("a", "write", { filePath: "../other/a.v" }, 1), DIR), undefined);
  assert.equal(stepFile(step("a", "engine_run_spice", { sources: ["design/a.cir"] }, 1), DIR), "design/a.cir");
});

test("follows the latest write or run, not what it only read", () => {
  const steps = [step("1", "write", { filePath: `${DIR}/src/a.v` }, 1), step("2", "read", { filePath: `${DIR}/README.md` }, 2)];
  assert.deepEqual(liveFocus(steps, DIR), { kind: "file", path: "src/a.v" });
  assert.deepEqual(liveFocus([...steps, step("3", "engine_run_hdl_test", {}, 3)], DIR), { kind: "run", stepId: "3" });
});

test("a failed write is skipped, and nothing yet is nothing", () => {
  const steps = [step("1", "write", { filePath: `${DIR}/a.v` }, 1), step("2", "write", { filePath: `${DIR}/results/x` }, 2, "error")];
  assert.deepEqual(liveFocus(steps, DIR), { kind: "file", path: "a.v" });
  assert.deepEqual([...changedFiles(steps, DIR)], ["a.v"]);
  assert.deepEqual(liveFocus([], DIR), { kind: "none" });
});
