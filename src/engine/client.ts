// Explicit TS extensions are required by Node's native strip-types test runner.
// @ts-ignore -- app's bundler config predates allowImportingTsExtensions.
import { ENGINE_SCHEMA, EVENT_NAMES, RUN_OPERATIONS } from "./types.ts";
import type {
  Actor, CheckResult, CreateProjectArgs, DocumentDiff, DocumentMutation, EngineClient,
  EngineClientOptions, EngineCommandEnvelope, EngineDocument, EngineError, EngineEvent,
  EngineResult, EventCursor, EventPage, JobQuery, JobStatus, KnownEngineEvent,
  ListArgs, LocalEngineOptions, Measurement, MutationArgs, MutationResponse, Page,
  ProjectArgs, ProjectInfo, ProjectSnapshot, RunJobArgs, RunOperation, RunVerdict, SubmitAck,
} from "./types";

const copy = <T>(value: T): T => structuredClone(value);
const success = <T>(data: T): EngineResult<T> => ({ ok: true, data: copy(data) });
const error = (code: string, message: string, fields?: string[]): EngineError => ({
  ok: false, code, message, ...(fields ? { fields } : {}),
});
const validActor = (actor: unknown): actor is Actor =>
  actor === "human" || actor === "rocket-fuel" || actor === "system";
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

/** All local documents are project-relative POSIX paths, including on Windows. */
function invalidPath(path: unknown): boolean {
  if (typeof path !== "string" || !path || path.startsWith("/") || /[\\\x00-\x1f:]/.test(path)) return true;
  const parts = path.split("/");
  return parts.some(part => !part || part === "." || part === ".." ||
    ["results", ".rocket", ".git"].includes(part.toLowerCase()) || /%[0-9a-f]{2}/i.test(part));
}

function paginate<T>(items: T[], args: { cursor?: string; limit?: number }): EngineResult<Page<T>> {
  const start = args.cursor === undefined ? 0 : Number(args.cursor);
  const limit = args.limit ?? 100;
  if (!Number.isSafeInteger(start) || start < 0 || start > items.length ||
      !Number.isSafeInteger(limit) || limit < 1) return error("invalid_reference", "Invalid list cursor or limit");
  return success({ items: items.slice(start, start + limit), next_cursor: start + limit < items.length ? String(start + limit) : null });
}

export function filterKnownEvents(events: readonly EngineEvent[]): KnownEngineEvent[] {
  return events.filter((item): item is KnownEngineEvent =>
    item.schema === ENGINE_SCHEMA && (EVENT_NAMES as readonly string[]).includes(item.event));
}

/** Filtering never rewinds the wire cursor, even when every event is unknown. */
export async function pollEngineEvents(client: EngineClient, args: ProjectArgs & { cursor?: EventCursor }): Promise<EngineResult<EventPage>> {
  const result = await client.get_events_since(args);
  if (!result.ok) return result; // resync_required tells callers to load a fresh snapshot.
  return success({ ...result.data, events: filterKnownEvents(result.data.events) });
}

type StoredJob = { command: EngineCommandEnvelope; fingerprint: string; ack: SubmitAck; status: JobStatus; sourceRevision: string };
type Project = {
  info: ProjectInfo; revision: number; docs: Map<string, string>; checks: CheckResult[];
  seq: number; sourceRevision: string; events: EngineEvent[]; jobs: Map<string, StoredJob>;
};

// These are deterministic contract fixtures, never claims of EDA-tool execution.
function measurementsFor(operation: RunOperation): Measurement[] {
  const values: Record<RunOperation, [string, number, string, number, number][]> = {
    run_syntax: [["syntax_errors", 0, "count", 0, 0]],
    run_hdl_test: [["assertions_passed", 128, "count", 128, 0], ["coverage", 96.4, "%", 95, 1.4]],
    run_digital_flow: [["cell_area", 12450, "µm²", 15000, 2550], ["power", 2.84, "mW", 3.5, 0.66]],
    run_timing: [["setup_slack", 0.18, "ns", 0, 0.18], ["hold_slack", 0.07, "ns", 0, 0.07]],
    run_drc: [["drc_violations", 0, "count", 0, 0]],
    run_lvs: [["unmatched_devices", 0, "count", 0, 0], ["unmatched_nets", 0, "count", 0, 0]],
    run_spice: [["dc_gain", 68.4, "dB", 60, 8.4], ["gain_bandwidth", 12.6, "MHz", 10, 2.6], ["phase_margin", 64.2, "deg", 60, 4.2], ["power", 0.81, "mW", 1, 0.19]],
    run_optical: [["insertion_loss", 1.24, "dB", 2, 0.76], ["extinction_ratio", 24.6, "dB", 20, 4.6]],
    run_extraction: [["device_coverage", 100, "%", 100, 0]],
    generate_views: [["views_generated", 3, "count", 3, 0]],
    check_view_sync: [["view_mismatches", 0, "count", 0, 0]],
  };
  return values[operation].map(([name, value, unit, target, margin]) => ({ name, value, unit, target, margin, status: "PASS" }));
}

/** Retains an attributed ledger for this engine's lifetime, independently of pollers.
 * Reuse the instance across clients; this in-memory adapter is not disk persistence.
 */
export class LocalContractEngine implements EngineClient {
  private readonly projects = new Map<string, Project>();
  private readonly options: LocalEngineOptions;
  private readonly retention: number;
  private tick = 0;

  constructor(options: LocalEngineOptions = {}) {
    this.options = { ...copy({ projectId: options.projectId, initialRevision: options.initialRevision,
      initialDocs: options.initialDocs, initialChecks: options.initialChecks,
      initialMeasurements: options.initialMeasurements, jobOutcomes: options.jobOutcomes }), now: options.now };
    this.retention = options.eventRetention ?? 1000;
    if (!Number.isSafeInteger(this.retention) || this.retention < 1) throw new Error("eventRetention must be a positive integer");
    if (!/^p(?:0|[1-9]\d*)$/.test(options.initialRevision ?? "p12") ||
        !Number.isSafeInteger(Number((options.initialRevision ?? "p12").slice(1)))) throw new Error("Invalid initialRevision");
    const result = this.addProject({ project_id: options.projectId ?? "rocketeda-project", docs: options.initialDocs });
    if (!result.ok) throw new Error(result.message);
  }

  private timestamp(): string {
    return this.options.now?.() ?? new Date(Date.UTC(2026, 0, 1) + this.tick++ * 1000).toISOString();
  }

  private project(id: string): Project | EngineError {
    return this.projects.get(id) ?? error("invalid_reference", `Unknown project: ${id}`, [id]);
  }

  private conflict(project: Project, expected: unknown): EngineError | undefined {
    if (expected !== project.info.current_revision) return {
      ok: false, code: "revision_conflict", message: `Expected ${String(expected)}; current revision is ${project.info.current_revision}`,
      current_revision: project.info.current_revision,
    };
  }

  private advance(project: Project): string {
    project.info.current_revision = `p${++project.revision}`;
    return project.info.current_revision;
  }

  private emit(project: Project, event: EngineEvent["event"], request_id: string, actor: Actor, data: Record<string, unknown>): EngineEvent {
    const entry: EngineEvent = {
      schema: ENGINE_SCHEMA, project_id: project.info.project_id, seq: ++project.seq,
      timestamp: this.timestamp(), event, request_id, actor, revision: project.info.current_revision, data: copy(data),
    };
    project.events.push(entry);
    if (project.events.length > this.retention) project.events.splice(0, project.events.length - this.retention);
    return copy(entry);
  }

  private addProject(args: CreateProjectArgs): EngineResult<ProjectInfo> {
    if (typeof args.project_id !== "string" || !args.project_id.trim()) return error("invalid_reference", "project_id is required");
    if (this.projects.has(args.project_id)) return error("request_conflict", `Project already exists: ${args.project_id}`);
    const docs = Array.isArray(args.docs) ? args.docs : Object.entries(args.docs ?? {}).map(([path, content]) => ({ path, content }));
    for (const doc of docs) if (invalidPath(doc.path) || typeof doc.content !== "string") return error("invalid_reference", `Invalid document: ${doc.path}`, [doc.path]);
    const revision = this.options.initialRevision ?? "p12";
    const project: Project = {
      info: { project_id: args.project_id, name: args.name ?? args.project_id, current_revision: revision },
      revision: Number(revision.slice(1)), docs: new Map(docs.map(doc => [doc.path, doc.content])),
      checks: copy(this.options.initialChecks ?? []), seq: 0, sourceRevision: revision, events: [], jobs: new Map(),
    };
    this.projects.set(args.project_id, project);
    return success(project.info);
  }

  async list_projects(args: { cursor?: string; limit?: number } = {}): Promise<EngineResult<Page<ProjectInfo>>> {
    return paginate([...this.projects.values()].map(project => project.info).sort((a, b) => a.project_id.localeCompare(b.project_id)), args);
  }

  async create_project(args: CreateProjectArgs): Promise<EngineResult<ProjectInfo>> { return this.addProject(args); }

  private documents(project: Project): EngineDocument[] {
    return [...project.docs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, content, revision: project.info.current_revision }));
  }

  async list_docs(args: ListArgs): Promise<EngineResult<Page<EngineDocument>>> {
    const project = this.project(args.project_id);
    return "ok" in project ? project : paginate(this.documents(project), args);
  }

  async read_doc(args: ProjectArgs & { path: string }): Promise<EngineResult<EngineDocument>> {
    const project = this.project(args.project_id);
    if ("ok" in project) return project;
    if (invalidPath(args.path)) return error("invalid_reference", `Invalid document: ${args.path}`, [args.path]);
    const content = project.docs.get(args.path);
    return content === undefined ? error("invalid_reference", `Document not found: ${args.path}`, [args.path]) :
      success({ path: args.path, content, revision: project.info.current_revision });
  }

  async write_doc(args: MutationArgs & { path: string; content: string }): Promise<EngineResult<MutationResponse>> {
    return this.mutate(args, [{ op: "write", path: args.path, content: args.content }], "doc_written");
  }

  async delete_doc(args: MutationArgs & { path: string }): Promise<EngineResult<MutationResponse>> {
    return this.mutate(args, [{ op: "delete", path: args.path }], "doc_deleted");
  }

  async apply_mutations(args: MutationArgs & { mutations: DocumentMutation[] }): Promise<EngineResult<MutationResponse>> {
    return this.mutate(args, args.mutations, "mutations_applied");
  }

  private mutate(args: MutationArgs, mutations: DocumentMutation[], event: string): EngineResult<MutationResponse> {
    const project = this.project(args.project_id);
    if ("ok" in project) return project;
    const conflict = this.conflict(project, args.expected_revision);
    if (conflict) return conflict;
    const actor = args.actor ?? "human";
    if (!validActor(actor)) return error("invalid_command", "Invalid actor", ["actor"]);
    if (!Array.isArray(mutations) || !mutations.length) return error("invalid_command", "At least one mutation is required", ["mutations"]);
    // Stage every change, including deletes, before replacing authoritative docs.
    const staged = new Map(project.docs);
    const paths = new Set<string>();
    for (const item of mutations) {
      if (!item || invalidPath(item.path) || !["write", "delete"].includes(item.op) ||
          (item.op === "write" && typeof item.content !== "string")) {
        return error("invalid_reference", `Invalid document mutation: ${item?.path ?? "unknown"}`, [item?.path ?? "mutations"]);
      }
      if (item.op === "delete" && !staged.has(item.path)) return error("invalid_reference", `Document not found: ${item.path}`, [item.path]);
      paths.add(item.path);
      if (item.op === "write") staged.set(item.path, item.content!);
      else staged.delete(item.path);
    }
    const diff_summary: DocumentDiff[] = [];
    for (const path of paths) {
      const before = project.docs.get(path), after = staged.get(path);
      if (before === after) continue;
      const oldLines = before === undefined || before === "" ? [] : before.split("\n");
      const newLines = after === undefined || after === "" ? [] : after.split("\n");
      let prefix = 0, suffix = 0;
      while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
      while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix &&
             oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix++;
      diff_summary.push({ path, status: before === undefined ? "added" : after === undefined ? "deleted" : "modified",
        additions: newLines.length - prefix - suffix, deletions: oldLines.length - prefix - suffix });
    }
    const previous = project.info.current_revision;
    project.docs = staged;
    const revision = this.advance(project);
    project.sourceRevision = revision;
    project.checks = project.checks.map(check => ({ ...check, freshness: "stale" }));
    const request_id = args.request_id ?? `mutation:${args.project_id}:${revision}`;
    const entry = this.emit(project, event, request_id, actor, { diff_summary, previous_revision: previous });
    return success({ project_id: args.project_id, revision, actor, diff_summary,
      rewind_handle: `rewind:${args.project_id}:${previous}`, events: [entry] });
  }

  async get_events_since(args: ProjectArgs & { cursor?: EventCursor }): Promise<EngineResult<EventPage>> {
    const project = this.project(args.project_id);
    if ("ok" in project) return project;
    const cursor = args.cursor === undefined ? 0 : Number(args.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > project.seq) return error("invalid_reference", "Invalid event cursor", ["cursor"]);
    const oldest = project.events[0]?.seq ?? project.seq + 1;
    if (cursor < oldest - 1) return { ...error("resync_required", "Cursor predates retained events; reload get_project_snapshot"), current_revision: project.info.current_revision };
    return success({ events: project.events.filter(entry => entry.seq > cursor), cursor: project.seq,
      next_cursor: project.seq, current_revision: project.info.current_revision });
  }

  async get_project_snapshot(args: ProjectArgs): Promise<EngineResult<ProjectSnapshot>> {
    const project = this.project(args.project_id);
    if ("ok" in project) return project;
    return success({ ...project.info, revision: project.info.current_revision,
      snapshot_id: `snapshot:${args.project_id}:${project.info.current_revision}`,
      docs: this.documents(project), checks: project.checks, cursor: project.seq });
  }

  async list_job_kinds(args: Partial<ProjectArgs> = {}) {
    if (args.project_id) { const project = this.project(args.project_id); if ("ok" in project) return project; }
    return success({ items: RUN_OPERATIONS.map(operation => ({ operation, source: "local-contract" as const })), next_cursor: null });
  }

  async submit(command: EngineCommandEnvelope): Promise<EngineResult<SubmitAck>> {
    const project = this.project(command.project_id);
    if ("ok" in project) return project;
    const allowed = ["schema", "request_id", "project_id", "expected_revision", "operation", "actor", "target", "arguments"];
    if (Object.keys(command).some(key => !allowed.includes(key)) || command.schema !== ENGINE_SCHEMA ||
        !command.request_id || !command.arguments || typeof command.arguments !== "object" || Array.isArray(command.arguments) ||
        (command.actor !== undefined && !validActor(command.actor))) return error("invalid_command", "Invalid v0.2 command envelope");
    if (!(RUN_OPERATIONS as readonly string[]).includes(command.operation)) return error("unsupported_operation", `Unsupported operation: ${command.operation}`);
    if (command.target && (!command.target.id || !command.target.revision || !["project", "global"].includes(command.target.scope))) return error("invalid_reference", "Invalid target reference", ["target"]);
    const fingerprint = canonical(command);
    const previous = project.jobs.get(command.request_id);
    if (previous) return previous.fingerprint === fingerprint ? success(previous.ack) : error("request_conflict", "request_id is already bound to a different command");
    const conflict = this.conflict(project, command.expected_revision);
    if (conflict) return conflict;
    const run_id = `run:${command.project_id}:${command.request_id}`;
    const snapshot_id = `snapshot:${command.project_id}:${project.info.current_revision}`;
    const current_revision = this.advance(project);
    const ack: SubmitAck = { request_id: command.request_id, run_id, snapshot_id, state: "queued", current_revision };
    project.jobs.set(command.request_id, { command: copy(command), fingerprint, ack,
      sourceRevision: project.sourceRevision, status: { project_id: command.project_id, request_id: command.request_id, run_id, snapshot_id, state: "queued" } });
    this.emit(project, "job_queued", command.request_id, command.actor ?? "human", { run_id, snapshot_id, operation: command.operation });
    return success(ack);
  }

  async run_job(args: RunJobArgs): Promise<EngineResult<RunVerdict>> {
    const project = this.project(args.project_id);
    if ("ok" in project) return project;
    const job = project.jobs.get(args.request_id);
    if (!job) return error("unknown_request", `Unknown request_id: ${args.request_id}`);
    if (args.expected_revision !== undefined) { const conflict = this.conflict(project, args.expected_revision); if (conflict) return conflict; }
    if (job.status.result) return success(job.status.result);
    job.status.state = "running";
    const started_at = this.timestamp();
    const outcome = this.options.jobOutcomes?.[job.command.operation];
    const measurements = copy(outcome?.measurements ?? this.options.initialMeasurements ?? measurementsFor(job.command.operation));
    const status = outcome?.status ?? (measurements.some(item => item.status === "FAIL") ? "FAIL" :
      measurements.some(item => item.status === "NOT_RUN") ? "NOT_RUN" :
      measurements.some(item => item.status === "UNSUPPORTED") ? "UNSUPPORTED" : "PASS");
    const current_revision = this.advance(project);
    const verdict: RunVerdict = {
      project_id: args.project_id, request_id: args.request_id, run_id: job.ack.run_id,
      snapshot_id: job.ack.snapshot_id, operation: job.command.operation, check_id: job.command.operation,
      status, state: status === "FAIL" || status === "NOT_RUN" || status === "UNSUPPORTED" ? "error" : "completed",
      project_revision: job.command.expected_revision, current_revision,
      started_at, finished_at: this.timestamp(), measurements,
      freshness: project.sourceRevision === job.sourceRevision ? "fresh" : "stale",
      artifacts: [], source: "local-contract",
      log_excerpt: `Local contract simulation: ${job.command.operation} ${status}. No external EDA tool executed.`,
      ...(outcome?.reason || status === "NOT_RUN" || status === "UNSUPPORTED" ? { reason: outcome?.reason ?? "Local contract outcome; no external EDA runner" } : {}),
    };
    // Results from an old input snapshot stay visible but never pretend to be fresh.
    job.status = { ...job.status, state: verdict.state, result: verdict };
    project.checks = [...project.checks.filter(check => check.check_id !== verdict.check_id), verdict];
    this.emit(project, verdict.state === "error" ? "run_failed" : "run_completed", args.request_id,
      job.command.actor ?? "human", { run_id: verdict.run_id, snapshot_id: verdict.snapshot_id,
        check_id: verdict.check_id, status, measurements, source: "local-contract" });
    return success(verdict);
  }

  private findJob(project: Project, args: JobQuery): StoredJob | undefined {
    return args.request_id ? project.jobs.get(args.request_id) : [...project.jobs.values()].find(job => job.ack.run_id === args.run_id);
  }

  async get_job_status(args: JobQuery): Promise<EngineResult<JobStatus>> {
    const project = this.project(args.project_id);
    if ("ok" in project) return project;
    const job = this.findJob(project, args);
    return job ? success(job.status) : error("unknown_request", "Unknown request_id or run_id");
  }

  async get_check_results(args: ListArgs): Promise<EngineResult<Page<CheckResult>>> {
    const project = this.project(args.project_id);
    return "ok" in project ? project : paginate(project.checks, args);
  }

  async list_artifacts(args: ListArgs & { run_id?: string }) {
    const project = this.project(args.project_id);
    if ("ok" in project) return project;
    const jobs = [...project.jobs.values()].filter(job => !args.run_id || job.ack.run_id === args.run_id);
    return paginate(jobs.flatMap(job => job.status.result?.artifacts ?? []), args);
  }

  async get_logs(args: JobQuery) {
    const project = this.project(args.project_id);
    if ("ok" in project) return project;
    const job = this.findJob(project, args);
    return job ? success({ run_id: job.ack.run_id, lines: [job.status.result?.log_excerpt ?? "Local contract job queued; not executed"], source: "local-contract" as const }) :
      error("unknown_request", "Unknown request_id or run_id");
  }
}

/** HTTP mapping: POST <baseUrl>/<frozen operation name>, JSON args -> EngineResult.
 * The handover defines payloads, not routes; mount these names on the server/proxy.
 */
export function createEngineClient(options: EngineClientOptions = {}): EngineClient {
  if (!options.baseUrl) return options.localEngine ?? new LocalContractEngine(options);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  async function request<T>(operation: string, args: unknown): Promise<EngineResult<T>> {
    try {
      const response = await fetchImpl(`${baseUrl}/${operation}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args),
      });
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "ok" in body) {
        const result = body as EngineResult<T>;
        if (result.ok === false && typeof result.code === "string" && typeof result.message === "string") return result;
        if (response.ok && result.ok === true && "data" in result) return result;
      }
      return error("transport_error", `Invalid engine response (${response.status}) for ${operation}`);
    } catch (cause) {
      return error("transport_error", cause instanceof Error ? cause.message : String(cause));
    }
  }
  return {
    list_projects: (args = {}) => request("list_projects", args),
    create_project: args => request("create_project", args),
    list_docs: args => request("list_docs", args), read_doc: args => request("read_doc", args),
    write_doc: args => request("write_doc", args), delete_doc: args => request("delete_doc", args),
    apply_mutations: args => request("apply_mutations", args),
    get_events_since: args => request("get_events_since", args),
    get_project_snapshot: args => request("get_project_snapshot", args),
    list_job_kinds: (args = {}) => request("list_job_kinds", args),
    submit: args => request("submit", args), run_job: args => request("run_job", args),
    get_job_status: args => request("get_job_status", args),
    get_check_results: args => request("get_check_results", args),
    list_artifacts: args => request("list_artifacts", args), get_logs: args => request("get_logs", args),
  };
}
