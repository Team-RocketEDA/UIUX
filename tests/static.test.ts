// Run: node --test tests/  (Node 22.18+ runs TypeScript directly)
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { staticPath } from "../server/static.ts";

// A build root (dist/) inside a folder of its own, so there is something outside it to try to reach.
function builtUi() {
  const root = path.join(mkdtempSync(path.join(os.tmpdir(), "rocketeda-ui-")), "dist");
  mkdirSync(path.join(root, "assets"), { recursive: true });
  writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  writeFileSync(path.join(root, "assets", "app.js"), "");
  return root;
}

test("serves files under the build root", () => {
  const root = builtUi();
  assert.equal(staticPath(root, "/assets/app.js"), path.join(root, "assets", "app.js"));
  assert.equal(staticPath(root, "/index.html"), path.join(root, "index.html"));
});

test("serves the app for paths without an extension", () => {
  const root = builtUi();
  assert.equal(staticPath(root, "/"), path.join(root, "index.html"));
  assert.equal(staticPath(root, "/projects/opamp"), path.join(root, "index.html"));
});

test("a missing asset is not answered with the app", () => {
  const root = builtUi();
  assert.equal(staticPath(root, "/assets/missing.js"), undefined);
});

test("refuses paths that leave the build root", () => {
  const root = builtUi();
  writeFileSync(path.join(path.dirname(root), "secret.txt"), "");
  assert.equal(staticPath(root, "/../secret.txt"), undefined);
  assert.equal(staticPath(root, "/%2e%2e/secret.txt"), undefined);
  assert.equal(staticPath(root, "/..%2fsecret.txt"), undefined);
  assert.equal(staticPath(root, "/%00"), undefined);
  assert.equal(staticPath(root, "/%E0%A4%A"), undefined);
});

test("without a build there is nothing to serve", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rocketeda-empty-"));
  assert.equal(staticPath(root, "/"), undefined);
});
