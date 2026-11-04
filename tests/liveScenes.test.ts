import assert from "node:assert/strict";
import { test } from "node:test";
import { aroundChanges, highlight, languageOf, lineDelay, lineDiff, scenesFromSteps, titleFor } from "../src/agent/liveScenes.ts";

const DIR = "/p";
const step = (id: string, tool: string, input: Record<string, unknown>, time: number, status = "completed") => ({ id, tool, label: tool, status, input, time }) as any;

test("a new file is all additions, with line numbers", () => {
  assert.deepEqual(lineDiff("", "a\nb\n"), [
    { kind: "add", text: "a", newNumber: 1 },
    { kind: "add", text: "b", newNumber: 2 },
  ]);
});

test("a change shows removed, added and unchanged lines", () => {
  const diff = lineDiff("a\nb\nc", "a\nx\nc");
  assert.deepEqual(diff.map((line) => `${line.kind}:${line.text}`), ["same:a", "remove:b", "add:x", "same:c"]);
  assert.deepEqual([diff[1].oldNumber, diff[2].newNumber, diff[3].oldNumber, diff[3].newNumber], [2, 2, 3, 3]);
});

test("a huge file still gives an answer", () => {
  const big = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join("\n");
  const diff = lineDiff(big, `${big}\nmore`);
  assert.equal(diff.filter((line) => line.kind === "add").length, 1001);
});

test("long unchanged stretches are left out", () => {
  const before = Array.from({ length: 30 }, (_, index) => `l${index}`).join("\n");
  const shown = aroundChanges(lineDiff(before, before.replace("l15", "changed")), 2);
  assert.ok(shown.length <= 6 && shown.some((line) => line.text === "changed"));
});

test("colours Verilog", () => {
  const tokens = highlight("  output reg [7:0] count; // the value", "verilog");
  assert.equal(tokens.find((token) => token.text === "output")?.kind, "keyword");
  assert.equal(tokens.find((token) => token.text === "7")?.kind, "number");
  assert.equal(tokens.find((token) => token.text === "// the value")?.kind, "comment");
  assert.equal(tokens.map((token) => token.text).join(""), "  output reg [7:0] count; // the value");
});

test("colours SPICE, YAML and Markdown, and never loses text", () => {
  assert.equal(highlight("* a filter", "spice")[0].kind, "comment");
  assert.equal(highlight(".param R1=1k", "spice")[0].kind, "keyword");
  assert.equal(highlight("R1 in out 10k", "spice")[0].kind, "name");
  assert.equal(highlight("title: Filter # why", "yaml")[0].kind, "keyword");
  assert.equal(highlight("# Heading", "markdown")[0].kind, "heading");
  for (const [line, language] of [["C1 out gnd {C1}", "spice"], ["value: 60", "yaml"], ["use `x` **now**", "markdown"], ["weird <>&", "plain"]] as const) {
    assert.equal(highlight(line, language).map((token) => token.text).join(""), line);
  }
});

test("names steps in plain words", () => {
  assert.equal(titleFor("constraints.yaml"), "Setting the targets");
  assert.equal(titleFor("design/filter.cir"), "Writing the design");
  assert.equal(titleFor("tests/tb_filter.cir"), "Writing the test");
  assert.equal(titleFor("README.md"), "Writing the README");
  assert.equal(titleFor("docs/diagrams/filter.svg"), "Drawing the diagram");
  assert.equal(languageOf("src/a.v"), "verilog");
});

test("a design file becomes code, then its drawing", () => {
  const scenes = scenesFromSteps([step("1", "write", { filePath: `${DIR}/src/a.v`, content: "module a; endmodule\n" }, 1)], DIR);
  assert.deepEqual(scenes.map((scene) => [scene.kind, scene.drawing]), [["code", undefined], ["drawing", "blocks"]]);
  assert.equal(scenes[0].added, 1);
  assert.equal(scenes[0].file, "a.v");
});

test("a test has code but no drawing, and an SVG is only drawn", () => {
  const scenes = scenesFromSteps(
    [step("1", "write", { filePath: `${DIR}/tests/tb_a.v`, content: "x\n" }, 1), step("2", "write", { filePath: `${DIR}/docs/d.svg`, content: "<svg/>" }, 2)],
    DIR,
  );
  assert.deepEqual(scenes.map((scene) => [scene.title, scene.kind]), [["Writing the test", "code"], ["Drawing the diagram", "drawing"]]);
  assert.equal(scenes[1].source, "<svg/>");
});

test("an edit shows red and green, against what the session wrote", () => {
  const scenes = scenesFromSteps(
    [
      step("1", "write", { filePath: `${DIR}/README.md`, content: "one\ntwo\nthree\n" }, 1),
      step("2", "edit", { filePath: `${DIR}/README.md`, oldString: "two", newString: "2" }, 2),
    ],
    DIR,
  );
  assert.deepEqual([scenes[1].added, scenes[1].removed], [1, 1]);
  assert.deepEqual(scenes[1].lines!.map((line) => line.kind), ["same", "remove", "add", "same"]);
});

test("reads, failures and files elsewhere aren't scenes; a run is, and says when it's finished", () => {
  const scenes = scenesFromSteps(
    [
      step("1", "read", { filePath: `${DIR}/a.v` }, 1),
      step("2", "write", { filePath: `${DIR}/results/x`, content: "x" }, 2, "error"),
      step("3", "write", { filePath: "/etc/x", content: "x" }, 3),
      step("4", "engine_run_spice", {}, 4, "running"),
    ],
    DIR,
  );
  assert.deepEqual(scenes.map((scene) => [scene.kind, scene.title, scene.ready]), [["run", "Simulating with ngspice", false]]);
});

test("short files aren't rushed, long ones don't drag, and a queue speeds things up", () => {
  assert.equal(lineDelay(5, 0), 90);
  assert.equal(lineDelay(1000, 0), 14);
  assert.ok(lineDelay(40, 3) < lineDelay(40, 0));
});
