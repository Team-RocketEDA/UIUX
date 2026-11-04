import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { previewFile, projectSlug } from "../server/visuals.ts";

const project = (files: string[]) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rocket-visuals-"));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), "x");
  }
  return dir;
};

test("prefers renders, and a top-level picture within them", () => {
  assert.equal(previewFile(project(["architecture/arch-pic.png", "renders/adc_block.png", "renders/mac_array_top.png"])), path.join("renders", "mac_array_top.png"));
});

test("falls back to other folders, and a project with no pictures has none", () => {
  assert.equal(previewFile(project(["architecture/arch-pic.png"])), path.join("architecture", "arch-pic.png"));
  assert.equal(previewFile(project(["design/a.cir"])), undefined);
});

test("names a project from what it's for", () => {
  assert.equal(projectSlug("A low-noise amplifier for my sensor board, please"), "a-low-noise-amplifier-for");
  assert.equal(projectSlug("  8-bit ADC!! "), "8-bit-adc");
  assert.equal(projectSlug("???"), "project");
  assert.match(projectSlug("x".repeat(90)), /^x{36}$/);
});
