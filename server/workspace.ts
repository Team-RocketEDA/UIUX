// Workspace server: the local backend the IDE talks to. Runs inside the Vite dev server (see
// vite.config.ts) and inside Electron main for the desktop app (electron/main.ts). It owns:
//   /api/*    projects, files (saves are git commits), checks through Rocket Engine, export
//   /agent/*  the open project's agent (opencode + Rocket Fuel), proxied with its password,
//             so no password or model key ever reaches browser code.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

const run = promisify(execFile);

export type WorkspaceOptions = { fuelHome: string; engineHome: string; projectsDir: string; agentUrl?: string };

type Agent = { port: number; password: string; proc: ChildProcess; state: "starting" | "ready" | "error"; error?: string };
type Open = { name: string; dir: string; agent?: Agent };

const TEMPLATES = ["opamp-engine", "empty"];
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const HIDDEN = new Set([".git", ".opencode", ".rocket", "node_modules"]);
// Written only by the engine / project service, never edited in the IDE.
const READ_ONLY_TOP = new Set(["results", "exports"]);
const READ_ONLY_FILES = new Set(["ip/manifest.yaml"]);
const TOOLS = ["ngspice", "verilator", "iverilog", "yosys", "klayout", "magic", "netgen", "openroad"];
// What each engine tool needs on this machine: a binary on PATH, or a module in the engine's Python.
const ENGINE_TOOLS: Record<string, { binary?: string; module?: string }> = {
  ngspice: { binary: "ngspice" },
  klayout: { binary: "klayout" },
  magic: { binary: "magic" },
  netgen: { binary: "netgen" },
  icarus: { binary: "iverilog" },
  slang: { binary: "slang" },
  sax: { module: "sax" },
};

export type EngineTool = { name: string; available: boolean; needs: string };
export type JobKind = { operation: string; tools: EngineTool[] };

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// This server edits files, runs tools and drives the agent, so only this page may call it:
// the Host must be loopback (no DNS rebinding) and a browser's Origin, when sent, must be this server.
function crossSite(req: IncomingMessage): string | undefined {
  const host = req.headers.host ?? "";
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) return `Refused: Host ${host} is not this machine.`;
  const origin = req.headers.origin;
  if (origin && origin !== "null") {
    try {
      if (new URL(origin).host === host) return undefined;
    } catch {
      // fall through
    }
    return `Refused: requests from ${origin} are not allowed.`;
  }
  if (origin === "null" && req.method !== "GET" && req.method !== "HEAD") return "Refused: opaque origin.";
  return undefined;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function which(tool: string): Promise<boolean> {
  try {
    await run("sh", ["-c", `command -v ${tool}`]);
    return true;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function git(dir: string, ...args: string[]) {
  const { stdout } = await run("git", ["-C", dir, "-c", "user.name=RocketEDA IDE", "-c", "user.email=ide@rocketeda.local", ...args]);
  return stdout.trim();
}

function readConstraints(dir: string): any {
  const file = path.join(dir, "constraints.yaml");
  if (!existsSync(file)) return { checks: [] };
  return parseYaml(readFileSync(file, "utf8")) ?? { checks: [] };
}

function insideProject(dir: string, rel: string): string {
  const full = path.resolve(dir, rel);
  if (full !== dir && !full.startsWith(dir + path.sep)) throw new HttpError(400, `Outside the project: ${rel}`);
  return full;
}

function isReadOnly(rel: string) {
  return READ_ONLY_TOP.has(rel.split("/")[0]) || READ_ONLY_FILES.has(rel);
}

type Listed = { path: string; size: number; modified: number; readOnly: boolean };

function listFiles(dir: string, base = ""): Listed[] {
  const out: Listed[] = [];
  for (const entry of readdirSync(path.join(dir, base), { withFileTypes: true })) {
    if (HIDDEN.has(entry.name) || entry.name === ".gitkeep") continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else if (entry.isFile()) {
      const stat = statSync(path.join(dir, rel));
      out.push({ path: rel, size: stat.size, modified: stat.mtimeMs, readOnly: isReadOnly(rel) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function readEvidence(dir: string): any[] {
  const folder = path.join(dir, "results", "engine-runs");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(path.join(folder, name), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)));
}

export function createWorkspace(options: WorkspaceOptions) {
  const fuelHome = path.resolve(options.fuelHome);
  const engineHome = path.resolve(options.engineHome);
  const projectsDir = path.resolve(options.projectsDir);
  mkdirSync(projectsDir, { recursive: true });
  let current: Open | null = null;

  function project(): Open {
    if (!current) throw new HttpError(409, "No project is open.");
    return current;
  }

  function stopAgent() {
    if (current?.agent?.proc.pid) {
      try {
        process.kill(-current.agent.proc.pid, "SIGTERM");
      } catch {
        current.agent.proc.kill("SIGTERM");
      }
    }
    if (current) current.agent = undefined;
  }

  async function startAgent(open: Open) {
    const port = await freePort();
    const password = randomBytes(18).toString("base64url");
    const env: NodeJS.ProcessEnv = { ...process.env, OPENCODE_SERVER_PASSWORD: password };
    if (existsSync(engineHome)) env.ROCKET_ENGINE_HOME = engineHome;
    const proc = spawn(path.join(fuelHome, "scripts", "dev.sh"), [open.dir, "serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      env,
      detached: true,
      stdio: "ignore",
    });
    const agent: Agent = { port, password, proc, state: "starting" };
    open.agent = agent;
    proc.on("exit", (code) => {
      if (agent.state !== "error") {
        agent.state = "error";
        agent.error = `Agent exited (${code}).`;
      }
    });
    const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
    for (let i = 0; i < 120 && agent.state === "starting"; i++) {
      try {
        // A request sent while opencode is still loading can stall, so each attempt times out.
        const response = await fetch(`http://127.0.0.1:${port}/session`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(2000) });
        if (response.ok) agent.state = "ready";
        else await new Promise((r) => setTimeout(r, 500));
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (agent.state === "starting") {
      agent.state = "error";
      agent.error = "Agent did not start within 60 s.";
    }
  }

  async function summary(open: Open) {
    let revision = "";
    let branch = "";
    let dirty = false;
    try {
      branch = await git(open.dir, "rev-parse", "--abbrev-ref", "HEAD");
      revision = await git(open.dir, "rev-parse", "--short", "HEAD");
      dirty = (await git(open.dir, "status", "--porcelain", "--", "design", "tests", "constraints.yaml")) !== "";
    } catch {
      // not a git repo yet
    }
    return {
      name: open.name,
      dir: open.dir,
      branch,
      revision,
      dirty,
      constraints: readConstraints(open.dir),
      agent: open.agent ? { state: open.agent.state, error: open.agent.error } : { state: "stopped" },
    };
  }

  // The engine's own job kinds (list_job_kinds), each tool marked by whether it can run here.
  // Asking the engine takes seconds, so the answer is kept until the server restarts.
  let jobKinds: Promise<JobKind[]> | undefined;
  function engineJobKinds(): Promise<JobKind[]> {
    jobKinds ??= (async () => {
      if (!existsSync(engineHome)) return [];
      const engine = ["run", "--quiet", "--project", engineHome, "python"];
      const { stdout } = await run("uv", [...engine, "-m", "rocket_engine.adapters.mcp.server", "--project", "catalog", "--call", "list_job_kinds", "--args", "{}"], { timeout: 60_000 });
      const kinds: { operation: string; tools: string[] }[] = JSON.parse(stdout).job_kinds ?? [];
      const checked = new Map<string, Promise<boolean>>();
      const available = (tool: string) => {
        const need = ENGINE_TOOLS[tool] ?? { binary: tool };
        if (!checked.has(tool)) {
          checked.set(tool, need.module
            ? run("uv", [...engine, "-c", `import ${need.module}`], { timeout: 60_000 }).then(() => true, () => false)
            : which(need.binary!));
        }
        return checked.get(tool)!;
      };
      return Promise.all(kinds.map(async (kind) => ({
        operation: kind.operation,
        tools: await Promise.all(kind.tools.map(async (name) => {
          const need = ENGINE_TOOLS[name] ?? { binary: name };
          return { name, available: await available(name), needs: need.module ? `the ${need.module} Python package in the engine environment` : `${need.binary} on PATH` };
        })),
      })));
    })();
    jobKinds.catch(() => (jobKinds = undefined));
    return jobKinds;
  }

  async function runChecks(open: Open) {
    const constraints = readConstraints(open.dir);
    const sim = constraints.simulation;
    if (!sim?.sources?.length) throw new HttpError(400, "constraints.yaml has no simulation block (sources, analyses) to run.");
    const checks: any[] = constraints.checks ?? [];
    if (!checks.length) throw new HttpError(400, "constraints.yaml has no checks to measure.");
    const args = { sources: sim.sources, analyses: sim.analyses ?? [], measurements: checks.map((c) => ({ name: c.metric })) };
    return callEngine(open, sim.operation ?? "run_spice", args);
  }

  // One engine operation through the project-bound MCP server (validation, two-phase runs, evidence).
  async function callEngine(open: Open, operation: string, args: Record<string, unknown>) {
    if (!existsSync(engineHome)) throw new HttpError(503, `Rocket Engine not found at ${engineHome} (set ROCKET_ENGINE_HOME).`);
    try {
      const { stdout } = await run(
        "uv",
        ["run", "--quiet", "--project", engineHome, "python", "-m", "rocket_engine.adapters.mcp.server",
         "--project", open.name, "--project-dir", open.dir, "--call", operation, "--args", JSON.stringify(args)],
        { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    } catch (error: any) {
      const out = error?.stdout ? String(error.stdout).trim() : "";
      if (out.startsWith("{")) return JSON.parse(out);
      throw new HttpError(500, `Engine call failed: ${error?.stderr || error?.message}`);
    }
  }

  // Read-only engine queries, plus the run operations the engine itself lists.
  const ENGINE_QUERIES = ["list_job_kinds", "get_check_results", "get_job_status", "get_logs"];
  async function consoleOperations() {
    return [...ENGINE_QUERIES, ...(await engineJobKinds().catch(() => [])).map((kind) => kind.operation)];
  }

  async function routeApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case "GET /api/status": {
        const tools: Record<string, boolean> = {};
        for (const tool of TOOLS) tools[tool] = await which(tool);
        return json(res, 200, {
          fuelHome, engineHome, engineFound: existsSync(path.join(engineHome, "src", "adapters", "mcp", "server.py")),
          projectsDir, tools, project: current?.name ?? null,
        });
      }
      case "GET /api/engine/jobs":
        return json(res, 200, await engineJobKinds());
      case "GET /api/templates":
        return json(res, 200, TEMPLATES.filter((id) => existsSync(path.join(fuelHome, "examples", id))).map((id) => {
          const c = readConstraints(path.join(fuelHome, "examples", id));
          return { id, title: c.title ?? id, description: c.description ?? "" };
        }));
      case "GET /api/projects":
        return json(res, 200, readdirSync(projectsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && existsSync(path.join(projectsDir, e.name, "constraints.yaml")))
          .map((e) => {
            const dir = path.join(projectsDir, e.name);
            const c = readConstraints(dir);
            return { name: e.name, title: c.title ?? e.name, description: c.description ?? "", modified: statSync(path.join(dir, "constraints.yaml")).mtimeMs };
          })
          .sort((a, b) => b.modified - a.modified));
      case "POST /api/projects": {
        const { name, template } = await readBody(req);
        if (!NAME_RE.test(name ?? "")) throw new HttpError(400, "Use lowercase letters, digits, - or _ (max 41 characters).");
        if (!TEMPLATES.includes(template)) throw new HttpError(400, `Unknown template: ${template}`);
        const dir = path.join(projectsDir, name);
        if (existsSync(dir)) throw new HttpError(409, `A project named ${name} already exists.`);
        cpSync(path.join(fuelHome, "examples", template), dir, { recursive: true });
        await git(dir, "init", "-q");
        await git(dir, "add", "-A");
        await git(dir, "commit", "-q", "-m", `Create project from ${template}`);
        return json(res, 201, { name });
      }
      case "POST /api/project/close":
        stopAgent();
        current = null;
        return json(res, 200, { ok: true });
      case "GET /api/project":
        return json(res, 200, current ? await summary(current) : null);
      case "GET /api/project/files":
        return json(res, 200, listFiles(project().dir));
      case "GET /api/project/file": {
        const rel = url.searchParams.get("path") ?? "";
        const full = insideProject(project().dir, rel);
        if (!existsSync(full)) throw new HttpError(404, `No such file: ${rel}`);
        return json(res, 200, { path: rel, content: readFileSync(full, "utf8"), readOnly: isReadOnly(rel) });
      }
      case "PUT /api/project/file": {
        const open = project();
        const { path: rel, content } = await readBody(req);
        if (isReadOnly(rel)) throw new HttpError(403, `${rel} is written only by the engine and project service.`);
        const full = insideProject(open.dir, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, content);
        await git(open.dir, "add", "--", rel);
        if ((await git(open.dir, "status", "--porcelain", "--", rel)) !== "") await git(open.dir, "commit", "-q", "-m", `Edit ${rel}`, "--", rel);
        return json(res, 200, await summary(open));
      }
      case "GET /api/project/history": {
        // Commits are the project's record of edits: IDE saves, the agent's changes, project creation.
        const log = await git(project().dir, "log", "-n", "30", "--format=%h%x09%an%x09%aI%x09%s").catch(() => "");
        return json(res, 200, log.split("\n").filter(Boolean).map((line) => {
          const [hash, author, date, ...subject] = line.split("\t");
          return { hash, author, date, subject: subject.join("\t") };
        }));
      }
      case "GET /api/project/checks":
        return json(res, 200, readEvidence(project().dir));
      case "POST /api/project/checks/run":
        return json(res, 200, await runChecks(project()));
      case "GET /api/engine/operations":
        return json(res, 200, await consoleOperations());
      case "POST /api/project/engine": {
        // The engine console: one engine operation by name with JSON arguments, nothing else.
        const { operation, args } = await readBody(req);
        if (!(await consoleOperations()).includes(operation)) throw new HttpError(400, `Not an engine operation: ${operation}`);
        if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) throw new HttpError(400, "Arguments must be a JSON object.");
        return json(res, 200, await callEngine(project(), operation, args ?? {}));
      }
      case "GET /api/project/raw": {
        // Binary project files (GDS for the layout viewer).
        const rel = url.searchParams.get("path") ?? "";
        const full = insideProject(project().dir, rel);
        if (!existsSync(full)) throw new HttpError(404, `No such file: ${rel}`);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(readFileSync(full));
        return;
      }
      case "POST /api/project/open-in": {
        // Open a project layout in KLayout on this machine.
        const { path: rel } = await readBody(req);
        if (!(await which("klayout"))) throw new HttpError(404, "KLayout is not installed on this machine.");
        const full = insideProject(project().dir, String(rel ?? ""));
        if (!/\.(gds|gds2|gdsii|oas|oasis)$/i.test(full) || !existsSync(full)) throw new HttpError(400, `Not a layout file in the project: ${rel}`);
        spawn("klayout", [full], { detached: true, stdio: "ignore" }).unref();
        return json(res, 200, { ok: true });
      }
      case "GET /api/project/export": {
        const open = project();
        res.writeHead(200, { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${open.name}.tar.gz"` });
        const tar = spawn("tar", ["czf", "-", "--exclude=.git", "--exclude=.opencode", "--exclude=.rocket", "-C", open.dir, "."]);
        tar.stdout.pipe(res);
        return;
      }
    }
    const opened = route.match(/^POST \/api\/projects\/([^/]+)\/open$/);
    if (opened) {
      const name = decodeURIComponent(opened[1]);
      const dir = path.join(projectsDir, name);
      if (!NAME_RE.test(name) || !existsSync(path.join(dir, "constraints.yaml"))) throw new HttpError(404, `No project ${name}.`);
      stopAgent();
      current = { name, dir };
      void startAgent(current);
      return json(res, 200, await summary(current));
    }
    throw new HttpError(404, `No route ${route}`);
  }

  // Streams to and from the open project's agent, adding its password here.
  function proxyAgent(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (options.agentUrl) return proxyTo(new URL(options.agentUrl), undefined, req, res, url);
    const agent = current?.agent;
    if (!agent || agent.state !== "ready") return json(res, 503, { error: "agent_unavailable", state: agent?.state ?? "stopped" });
    proxyTo(new URL(`http://127.0.0.1:${agent.port}`), "Basic " + Buffer.from(`opencode:${agent.password}`).toString("base64"), req, res, url);
  }

  function proxyTo(target: URL, authorization: string | undefined, req: IncomingMessage, res: ServerResponse, url: URL) {
    const headers = { ...req.headers, host: target.host, ...(authorization ? { authorization } : {}) };
    const upstream = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: url.pathname.replace(/^\/agent/, "") + url.search, headers },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) json(res, 502, { error: "agent_unreachable", message: error.message });
      else res.end();
    });
    req.pipe(upstream);
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
      const url = new URL(req.url ?? "/", "http://localhost");
      try {
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/agent/")) {
          const refused = crossSite(req);
          if (refused) return json(res, 403, { error: refused });
        }
        if (url.pathname.startsWith("/api/")) return await routeApi(req, res, url);
        if (url.pathname.startsWith("/agent/")) return proxyAgent(req, res, url);
        next();
      } catch (error: any) {
        json(res, error instanceof HttpError ? error.status : 500, { error: error?.message ?? String(error) });
      }
    },
    close: stopAgent,
  };
}

export function defaultOptions(env: Record<string, string | undefined>, cwd: string): WorkspaceOptions {
  return {
    fuelHome: env.ROCKET_FUEL_HOME || path.resolve(cwd, "..", "rocket_fuel"),
    engineHome: env.ROCKET_ENGINE_HOME || path.resolve(cwd, "..", "rocket-engine"),
    projectsDir: env.ROCKET_PROJECTS_DIR || path.join(os.homedir(), "RocketEDA", "projects"),
    // Replay: stream a recording (rocket_fuel evals/replay_server.py) instead of the project's agent.
    agentUrl: env.ROCKET_AGENT_URL || undefined,
  };
}
