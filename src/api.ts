// Client for the workspace server (server/workspace.ts). Everything the IDE shows comes from here
// or from the agent stream; there is no sample data.

export type ToolStatus = Record<string, boolean>;

export type WorkspaceStatus = {
  fuelHome: string;
  engineHome: string;
  engineFound: boolean;
  projectsDir: string;
  tools: ToolStatus;
  project: string | null;
};

export type EngineTool = { name: string; available: boolean; needs: string };
export type JobKind = { operation: string; tools: EngineTool[] };

export type Template = { id: string; title: string; description: string };
export type ProjectEntry = { name: string; title: string; description: string; modified: number };

export type ConstraintCheck = {
  id?: string;
  title?: string;
  metric: string;
  comparison: string;
  value: number;
  unit?: string;
  required?: boolean;
  expr?: string;
  control?: string[];
};

export type Constraints = {
  title?: string;
  description?: string;
  pdk?: string;
  domains?: string[];
  agent?: { iteration_limit?: number; mode?: string };
  simulation?: { operation?: string; sources?: string[]; analyses?: string[] };
  checks?: ConstraintCheck[];
};

export type ProjectSummary = {
  name: string;
  dir: string;
  branch: string;
  revision: string;
  dirty: boolean;
  constraints: Constraints;
  agent: { state: "starting" | "ready" | "error" | "stopped"; error?: string };
};

export type Commit = { hash: string; author: string; date: string; subject: string };

export type FileEntry = { path: string; size: number; modified: number; readOnly: boolean };

// value and margin are null when the engine measured no finite number (e.g. a perfect optical null, -inf dB).
export type Measurement = { name: string; value: number | null; unit: string; target: { min?: number; max?: number; min_db?: number; max_db?: number }; margin: number | null; status: "pass" | "fail" };

export type Verdict = { status: "PASS" | "FAIL" | "NOT_RUN" | "UNSUPPORTED"; reason?: string; measurements?: Measurement[]; finding_counts?: Record<string, number> };

export type Evidence = {
  producer: string;
  run_id: string;
  operation: string;
  verdict: Verdict;
  finished_at: string;
  source_commit: string | null;
  source_dirty: boolean | null;
  sources: string[];
  log: string;
  // Waveform files the run kept (ngspice ASCII rawfiles), e.g. results/engine-runs/<run_id>-ac.raw.
  datasets?: { analysis: string; path: string }[];
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `${method} ${path} failed (${response.status})`);
  return data as T;
}

export const api = {
  status: () => request<WorkspaceStatus>("GET", "/api/status"),
  engineJobs: () => request<JobKind[]>("GET", "/api/engine/jobs"),
  templates: () => request<Template[]>("GET", "/api/templates"),
  projects: () => request<ProjectEntry[]>("GET", "/api/projects"),
  createProject: (name: string, template: string) => request<{ name: string }>("POST", "/api/projects", { name, template }),
  openProject: (name: string) => request<ProjectSummary>("POST", `/api/projects/${encodeURIComponent(name)}/open`),
  closeProject: () => request<{ ok: true }>("POST", "/api/project/close"),
  project: () => request<ProjectSummary | null>("GET", "/api/project"),
  files: () => request<FileEntry[]>("GET", "/api/project/files"),
  readFile: (path: string) => request<{ path: string; content: string; readOnly: boolean }>("GET", `/api/project/file?path=${encodeURIComponent(path)}`),
  saveFile: (path: string, content: string) => request<ProjectSummary>("PUT", "/api/project/file", { path, content }),
  history: () => request<Commit[]>("GET", "/api/project/history"),
  evidence: () => request<Evidence[]>("GET", "/api/project/checks"),
  runChecks: () => request<{ run_id: string; state: string; verdict: Verdict }>("POST", "/api/project/checks/run"),
  exportUrl: "/api/project/export",
  engineOperations: () => request<string[]>("GET", "/api/engine/operations"),
  engineCall: (operation: string, args: Record<string, unknown>) => request<Record<string, unknown>>("POST", "/api/project/engine", { operation, args }),
  rawFile: async (path: string) => {
    const response = await fetch(`/api/project/raw?path=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Could not read ${path}`);
    return response.arrayBuffer();
  },
  openInKlayout: (path: string) => request<{ ok: true }>("POST", "/api/project/open-in", { path }),
};

export type CheckRow = {
  check: ConstraintCheck;
  status: Verdict["status"] | "NOT_RUN_YET";
  stale: boolean;
  measurement?: Measurement;
  evidence?: Evidence;
  reason?: string;
};

// A check's status comes only from the latest engine evidence that measured it. Evidence from an
// older commit, or from a working tree with unsaved design changes, is marked stale.
// Only a real FAIL is a failure: NOT_RUN and UNSUPPORTED mean the check never ran.
export function jobStatus(verdict: string): "passed" | "failed" | "not_run" {
  return verdict === "PASS" ? "passed" : verdict === "FAIL" ? "failed" : "not_run";
}

export function checkRows(constraints: Constraints, evidence: Evidence[], revision: string): CheckRow[] {
  return (constraints.checks ?? []).map((check) => {
    // A solver with no measurements, such as an HDL testbench, gives one verdict for the whole run.
    const latest = evidence.find(
      (e) => e.verdict.status === "NOT_RUN" || !e.verdict.measurements?.length || e.verdict.measurements.some((m) => m.name === check.metric),
    );
    if (!latest) return { check, status: "NOT_RUN_YET", stale: false };
    const stale = latest.source_commit !== revision || !!latest.source_dirty;
    if (latest.verdict.status === "NOT_RUN" || latest.verdict.status === "UNSUPPORTED") {
      return { check, status: latest.verdict.status, stale, evidence: latest, reason: latest.verdict.reason };
    }
    const measurement = latest.verdict.measurements?.find((m) => m.name === check.metric);
    if (!measurement) return { check, status: latest.verdict.status, stale, evidence: latest };
    return { check, status: measurement.status === "pass" ? "PASS" : "FAIL", stale, measurement, evidence: latest };
  });
}

export function targetText(check: ConstraintCheck) {
  return `${check.comparison} ${check.value}${check.unit ? ` ${check.unit}` : ""}`;
}

export function formatNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2);
}

export function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
