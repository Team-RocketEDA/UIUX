// The assistant's file edits become commits, like IDE saves. The engine stamps each run's evidence
// with the commit and dirty state of design/, tests/ and constraints.yaml, so an approved edit left
// uncommitted would mark the PASS that follows it stale.
import { execFile } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { FuelClient } from "../src/agent/fuel/client.ts";
import type { OpencodeEvent } from "../src/agent/fuel/view.ts";

const run = promisify(execFile);

// opencode's file-changing tools, as in Rocket Fuel's plugin/src/policy.ts.
const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "patch", "apply_patch"]);
const AUTHOR = "RocketEDA Assistant <assistant@rocketeda.local>";

// Project paths (relative, "/"-separated) that a finished edit tool call changed; none for any other event.
export function editedPaths(event: OpencodeEvent, dir: string): string[] {
  const part = event.properties?.part;
  if (event.type !== "message.part.updated" || part?.type !== "tool" || !EDIT_TOOLS.has(part.tool) || part.state?.status !== "completed") return [];
  const input = part.state.input ?? {};
  const targets: string[] = [input.filePath, input.path, input.file].filter((target) => typeof target === "string");
  if (typeof input.patchText === "string") {
    for (const match of input.patchText.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) targets.push(match[1].trim());
  }
  const root = path.resolve(dir);
  const paths = targets.map((target) => path.relative(root, path.resolve(root, target)));
  return [...new Set(paths.filter((rel) => rel && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)).map((rel) => rel.split(path.sep).join("/")))];
}

// Commits these paths, and only these, as the assistant's edit: results/ written meanwhile stays out.
// Returns the new short commit, or undefined when the paths have nothing to commit.
export async function commitAgentEdit(dir: string, paths: string[]): Promise<string | undefined> {
  const git = async (...args: string[]) =>
    (await run("git", ["-C", dir, "-c", "user.name=RocketEDA IDE", "-c", "user.email=ide@rocketeda.local", ...args])).stdout.trim();
  if (!paths.length || (await git("status", "--porcelain", "--", ...paths)) === "") return undefined;
  await git("add", "-A", "--", ...paths);
  await git("commit", "-q", "--author", AUTHOR, "-m", `Assistant edit: ${paths.join(", ")}`, "--", ...paths);
  return git("rev-parse", "--short", "HEAD");
}

// Follows the agent's event stream until the signal aborts, committing each edit as it finishes.
// That is while the model is still choosing its next step, so the engine run after it sees a clean
// tree. A dropped stream (agent restarting) is picked up again.
export async function followAgentEdits(client: Pick<FuelClient, "subscribe">, dir: string, signal: AbortSignal, keep: (rel: string) => boolean = () => true) {
  // One commit at a time, so two quick edits don't race for git's index lock.
  let commits = Promise.resolve();
  while (!signal.aborted) {
    await client
      .subscribe((event) => {
        const paths = editedPaths(event, dir).filter(keep);
        if (!paths.length) return;
        commits = commits
          .then(() => commitAgentEdit(dir, paths))
          .then(
            () => undefined,
            (error) => console.error(`Could not commit the assistant's edit of ${paths.join(", ")}: ${error?.stderr || error?.message}`),
          );
      }, signal)
      .catch(() => undefined);
    await delay(1000, undefined, { signal }).catch(() => undefined);
  }
  await commits;
}
