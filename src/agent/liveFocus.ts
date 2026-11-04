// What the agent is doing, read from its tool calls: which file it touched last, and whether it's running a check.
import type { ToolStep } from "./fuel";

export type StepKind = "edit" | "run" | "read" | "other";

export function stepKind(step: ToolStep): StepKind {
  const tool = step.tool;
  if (/^(edit|write|patch|multiedit)$/i.test(tool) || /apply_revision/.test(tool)) return "edit";
  if (/run_|run$|_run|run_job/.test(tool)) return "run";
  if (/^(read|glob|grep|list)$/i.test(tool) || /_(get|list|read)_/.test(tool)) return "read";
  return "other";
}

// The step's file, relative to the project. Outside the project there's nothing here to show.
export function stepFile(step: ToolStep, projectDir: string): string | undefined {
  const input = step.input as Record<string, unknown>;
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const raw = [input.filePath, input.file, input.path, sources[0]].find((value): value is string => typeof value === "string" && value.length > 0);
  if (!raw) return undefined;
  const root = projectDir.replace(/\/+$/, "") + "/";
  if (raw.startsWith(root)) return raw.slice(root.length);
  return raw.startsWith("/") || raw.startsWith("..") ? undefined : raw.replace(/^\.\//, "");
}

export type LiveFocus = { kind: "file"; path: string } | { kind: "run"; stepId: string } | { kind: "none" };

// The most recent thing worth watching: a file it wrote, or a check it ran.
export function liveFocus(steps: ToolStep[], projectDir: string): LiveFocus {
  const newest = [...steps].sort((a, b) => b.time - a.time);
  for (const step of newest) {
    const kind = stepKind(step);
    if (kind === "run") return { kind: "run", stepId: step.id };
    if (kind === "edit" && step.status !== "error") {
      const path = stepFile(step, projectDir);
      if (path) return { kind: "file", path };
    }
  }
  return { kind: "none" };
}

export function changedFiles(steps: ToolStep[], projectDir: string): Set<string> {
  const files = new Set<string>();
  for (const step of steps) {
    if (stepKind(step) !== "edit" || step.status === "error") continue;
    const path = stepFile(step, projectDir);
    if (path) files.add(path);
  }
  return files;
}
