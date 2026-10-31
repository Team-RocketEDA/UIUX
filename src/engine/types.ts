export const ENGINE_SCHEMA = "rocketeda/tooling/v0.2" as const;
export const RUN_OPERATIONS = [
  "run_syntax", "run_hdl_test", "run_digital_flow", "run_timing", "run_drc",
  "run_lvs", "run_spice", "run_optical", "run_extraction", "generate_views", "check_view_sync",
] as const;
export type RunOperation = typeof RUN_OPERATIONS[number];
export type Actor = "human" | "rocket-fuel" | "system";
export type CheckStatus = "PASS" | "FAIL" | "NOT_RUN" | "UNSUPPORTED";
export type EngineResult<T> = { ok: true; data: T } | EngineError;
export type EngineError = {
  ok: false; code: string; message: string; fields?: string[]; current_revision?: string;
};
export type EngineCommandEnvelope = {
  schema: typeof ENGINE_SCHEMA; request_id: string; project_id: string;
  expected_revision: string; operation: RunOperation; actor?: Actor;
  target?: { scope: "project" | "global"; id: string; revision: string };
  arguments: Record<string, unknown>;
};
export type SubmitAck = {
  request_id: string; run_id: string; snapshot_id: string; state: "queued"; current_revision: string;
};
export const EVENT_NAMES = [
  "job_queued", "run_completed", "run_failed", "doc_written", "doc_deleted", "mutations_applied",
] as const;
export type EventName = typeof EVENT_NAMES[number];
// Unknown names remain representable on the wire; consumers filter them.
export type EngineEvent = {
  schema: typeof ENGINE_SCHEMA; project_id: string; seq: number; timestamp: string;
  event: string; request_id: string; actor: Actor; revision: string; data: Record<string, unknown>;
};
export type KnownEngineEvent = EngineEvent & { event: EventName };
export type EventCursor = number | string;
export type EventPage = {
  events: EngineEvent[]; cursor: number; next_cursor: number; current_revision: string;
};
export type DocumentMutation = { op: "write" | "delete"; path: string; content?: string };
export type DocumentDiff = {
  path: string; status: "added" | "modified" | "deleted"; additions: number; deletions: number;
};
export type MutationResponse = {
  project_id: string; revision: string; actor: Actor; diff_summary: DocumentDiff[];
  rewind_handle: string; events: EngineEvent[];
};
export type EngineDocument = { path: string; content: string; revision: string };
export type DocumentInput = { path: string; content: string };
export type InitialDocs = Record<string, string> | DocumentInput[];
export type ProjectInfo = { project_id: string; name: string; current_revision: string };
export type Measurement = {
  name: string; value: number; unit: string; target: number | string; margin: number; status: CheckStatus;
};
export type Artifact = { id: string; kind: string; relpath: string; mime: string; bytes: number; digest: string };
export type CheckResult = {
  check_id: string; status: CheckStatus; measurements: Measurement[]; reason?: string;
  run_id?: string; project_revision?: string; snapshot_id?: string;
  freshness?: "fresh" | "stale"; source?: "local-contract" | "engine";
};
export type RunVerdict = CheckResult & {
  request_id: string; run_id: string; project_id: string; snapshot_id: string;
  operation: RunOperation; state: "completed" | "error"; current_revision: string;
  project_revision: string; started_at: string; finished_at: string;
  artifacts: Artifact[]; log_excerpt: string;
};
export type JobStatus = {
  project_id: string; request_id: string; run_id: string; snapshot_id: string;
  state: "queued" | "running" | "completed" | "error"; result?: RunVerdict;
};
export type ProjectSnapshot = ProjectInfo & {
  snapshot_id: string; revision: string; docs: EngineDocument[]; checks: CheckResult[]; cursor: number;
};
export type Page<T> = { items: T[]; next_cursor: string | null };
export type ProjectArgs = { project_id: string };
export type ListArgs = ProjectArgs & { cursor?: string; limit?: number };
export type MutationArgs = ProjectArgs & { expected_revision: string; actor?: Actor; request_id?: string };
export type RunJobArgs = ProjectArgs & { request_id: string; expected_revision?: string };
export type JobQuery = ProjectArgs & { request_id?: string; run_id?: string };
export type CreateProjectArgs = {
  project_id: string; name?: string; docs?: InitialDocs; actor?: Actor;
};
export type EngineClient = {
  list_projects(args?: { cursor?: string; limit?: number }): Promise<EngineResult<Page<ProjectInfo>>>;
  create_project(args: CreateProjectArgs): Promise<EngineResult<ProjectInfo>>;
  list_docs(args: ListArgs): Promise<EngineResult<Page<EngineDocument>>>;
  read_doc(args: ProjectArgs & { path: string }): Promise<EngineResult<EngineDocument>>;
  write_doc(args: MutationArgs & { path: string; content: string }): Promise<EngineResult<MutationResponse>>;
  delete_doc(args: MutationArgs & { path: string }): Promise<EngineResult<MutationResponse>>;
  apply_mutations(args: MutationArgs & { mutations: DocumentMutation[] }): Promise<EngineResult<MutationResponse>>;
  get_events_since(args: ProjectArgs & { cursor?: EventCursor }): Promise<EngineResult<EventPage>>;
  get_project_snapshot(args: ProjectArgs): Promise<EngineResult<ProjectSnapshot>>;
  list_job_kinds(args?: Partial<ProjectArgs>): Promise<EngineResult<Page<{ operation: RunOperation; source: "local-contract" | "engine" }>>>;
  submit(command: EngineCommandEnvelope): Promise<EngineResult<SubmitAck>>;
  run_job(args: RunJobArgs): Promise<EngineResult<RunVerdict>>;
  get_job_status(args: JobQuery): Promise<EngineResult<JobStatus>>;
  get_check_results(args: ListArgs): Promise<EngineResult<Page<CheckResult>>>;
  list_artifacts(args: ListArgs & { run_id?: string }): Promise<EngineResult<Page<Artifact>>>;
  get_logs(args: JobQuery): Promise<EngineResult<{ run_id: string; lines: string[]; source: "local-contract" | "engine" }>>;
};
export type LocalEngineOptions = {
  projectId?: string; initialRevision?: string; initialDocs?: InitialDocs;
  initialChecks?: CheckResult[]; initialMeasurements?: Measurement[];
  eventRetention?: number; now?: () => string;
  jobOutcomes?: Partial<Record<RunOperation, { status: CheckStatus; reason?: string; measurements?: Measurement[] }>>;
};
export type EngineClientOptions = LocalEngineOptions & {
  baseUrl?: string; fetch?: typeof globalThis.fetch; localEngine?: EngineClient;
};
