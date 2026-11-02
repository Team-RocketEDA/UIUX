// Run: node --test tests/  (Node 22.18+ runs TypeScript directly)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { commitAgentEdit, editedPaths, followAgentEdits } from "../server/agentEdits.ts";
import { FuelClient } from "../src/agent/fuel/client.ts";

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

// A project as the IDE creates it: one commit, results/ not ignored so a stray add would show.
function project() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rocketeda-project-"));
  mkdirSync(path.join(dir, "design"));
  writeFileSync(path.join(dir, "design", "opamp.cir"), ".param L2=0.5\n");
  writeFileSync(path.join(dir, "constraints.yaml"), "checks: []\n");
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "Create project from opamp-engine");
  return dir;
}

// The approved edit, then the engine's evidence for the run after it.
function approveAndRun(dir: string) {
  writeFileSync(path.join(dir, "design", "opamp.cir"), ".param L2=1.0\n");
  mkdirSync(path.join(dir, "results", "engine-runs"), { recursive: true });
  writeFileSync(path.join(dir, "results", "engine-runs", "run-1.json"), "{}");
}

// opencode's events for an edit tool call, as in rocket_fuel's evals/recordings.
function editPart(dir: string, status: string, tool = "edit", input: Record<string, unknown> = { filePath: path.join(dir, "design", "opamp.cir") }) {
  return { type: "message.part.updated", properties: { part: { type: "tool", tool, callID: "call-1", state: { status, input } } } };
}

// What the engine checks for source_dirty (rocket-engine adapters/mcp/server.py _source_state).
const engineDirty = (dir: string) => git(dir, "status", "--porcelain", "--", "design", "tests", "constraints.yaml") !== "";

test("a finished edit names the project file it changed", () => {
  const dir = "/projects/opamp";
  assert.deepEqual(editedPaths(editPart(dir, "completed"), dir), ["design/opamp.cir"]);
  assert.deepEqual(editedPaths(editPart(dir, "completed", "write", { filePath: "tests/tb.cir" }), dir), ["tests/tb.cir"]);
});

test("pending or running edits, other tools and other events change nothing", () => {
  const dir = "/projects/opamp";
  assert.deepEqual(editedPaths(editPart(dir, "running"), dir), []);
  assert.deepEqual(editedPaths(editPart(dir, "error"), dir), []);
  assert.deepEqual(editedPaths(editPart(dir, "completed", "read"), dir), []);
  assert.deepEqual(editedPaths({ type: "permission.asked", properties: { permission: "edit", metadata: { filepath: `${dir}/design/opamp.cir` } } }, dir), []);
});

test("a patch names every file it adds, updates, deletes or moves to", () => {
  const dir = "/projects/opamp";
  const patchText = "*** Begin Patch\n*** Update File: design/opamp.cir\n*** Move to: design/opamp2.cir\n@@\n-.param L2=0.5\n+.param L2=1.0\n*** Delete File: design/old.cir\n*** End Patch";
  assert.deepEqual(editedPaths(editPart(dir, "completed", "apply_patch", { patchText }), dir), ["design/opamp.cir", "design/opamp2.cir", "design/old.cir"]);
});

test("paths outside the project are left alone", () => {
  const dir = "/projects/opamp";
  assert.deepEqual(editedPaths(editPart(dir, "completed", "edit", { filePath: "/projects/other/design/opamp.cir" }), dir), []);
  assert.deepEqual(editedPaths(editPart(dir, "completed", "edit", { filePath: "../opamp/../x.cir" }), dir), []);
});

test("commits the edited file as the assistant and leaves results/ out", async () => {
  const dir = project();
  approveAndRun(dir);
  const commit = await commitAgentEdit(dir, ["design/opamp.cir"]);
  assert.equal(commit, git(dir, "rev-parse", "--short", "HEAD"));
  assert.equal(git(dir, "log", "-1", "--format=%an|%s"), "RocketEDA Assistant|Assistant edit: design/opamp.cir");
  assert.equal(git(dir, "show", "--name-only", "--format=", "HEAD"), "design/opamp.cir");
  assert.equal(engineDirty(dir), false);
  assert.equal(git(dir, "status", "--porcelain"), "?? results/");
  // Seen again (restored history, a second stream): nothing left to commit.
  assert.equal(await commitAgentEdit(dir, ["design/opamp.cir"]), undefined);
});

test("following the agent's stream commits an approved edit as it finishes", async () => {
  const dir = project();
  const before = git(dir, "rev-parse", "--short", "HEAD");
  // A stand-in for opencode's GET /event: the approval, then the edit tool call finishing.
  const agent = http.createServer((req, res) => {
    assert.equal(req.url, "/event");
    assert.equal(req.headers.authorization, "Basic " + Buffer.from("opencode:secret").toString("base64"));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: "permission.asked", properties: { id: "per-1", permission: "edit", patterns: ["design/opamp.cir"] } });
    send(editPart(dir, "running"));
    approveAndRun(dir);
    send({ type: "permission.replied", properties: { requestID: "per-1", reply: "once" } });
    send(editPart(dir, "completed"));
  });
  await new Promise<void>((resolve) => agent.listen(0, "127.0.0.1", resolve));
  const client = new FuelClient({ baseUrl: `http://127.0.0.1:${(agent.address() as AddressInfo).port}`, password: "secret" });
  const stop = new AbortController();
  const following = followAgentEdits(client, dir, stop.signal);
  try {
    for (let i = 0; i < 100 && git(dir, "rev-parse", "--short", "HEAD") === before; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(git(dir, "log", "-1", "--format=%s"), "Assistant edit: design/opamp.cir");
    assert.equal(engineDirty(dir), false);
  } finally {
    stop.abort();
    agent.closeAllConnections();
    agent.close();
    await following;
  }
});
