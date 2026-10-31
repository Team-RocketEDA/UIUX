// Node types are intentionally optional for the browser application workspace.
// @ts-ignore -- built-in module; exercised by node --experimental-strip-types.
import { test } from "node:test";
// @ts-ignore -- built-in module; no @types/node dependency required.
import assert from "node:assert/strict";
// @ts-ignore -- explicit TS extension for Node's native strip-types loader.
import { createEngineClient, LocalContractEngine, pollEngineEvents, filterKnownEvents, ENGINE_SCHEMA, RUN_OPERATIONS } from "./index.ts";
import type { EngineClient, EngineCommandEnvelope, EngineEvent, EngineResult, Measurement } from "./types";

const project_id = "chip";
const fresh = (extra: ConstructorParameters<typeof LocalContractEngine>[0] = {}) => new LocalContractEngine({
  projectId: project_id, initialRevision: "p12", initialDocs: { "design/top.sv": "module top;\nendmodule" }, ...extra,
});
function data<T>(result: EngineResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.data;
}
function failure(result: EngineResult<unknown>, code: string) {
  if (result.ok) throw new Error(`Expected ${code}, got success`);
  assert.equal(result.code, code);
  return result;
}
function command(extra: Partial<EngineCommandEnvelope> = {}): EngineCommandEnvelope {
  return { schema: ENGINE_SCHEMA, project_id, request_id: "req-1", expected_revision: "p12",
    operation: "run_spice", arguments: {}, actor: "rocket-fuel", ...extra };
}

test("Document CRUD advances p12 -> p13, returns attributed diffs and isolates returned objects", async () => {
  const client = fresh();
  const docs = data(await client.list_docs({ project_id }));
  assert.equal(docs.items[0].path, "design/top.sv");
  assert.equal(docs.next_cursor, null);
  assert.equal(data(await client.read_doc({ project_id, path: "design/top.sv" })).revision, "p12");
  const result = data(await client.write_doc({ project_id, path: "design/top.sv", content: "module updated;\nendmodule", expected_revision: "p12", actor: "human" }));
  assert.equal(result.revision, "p13");
  assert.deepEqual(result.diff_summary, [{ path: "design/top.sv", status: "modified", additions: 1, deletions: 1 }]);
  assert.equal(result.events[0].actor, "human");
  assert.equal(result.events[0].event, "doc_written");
  assert.ok(result.rewind_handle);
  result.events[0].data.corrupted = true;
  assert.equal(data(await client.get_events_since({ project_id })).events[0].data.corrupted, undefined);
  assert.equal(data(await client.read_doc({ project_id, path: "design/top.sv" })).content, "module updated;\nendmodule");
  const added = data(await client.write_doc({ project_id, expected_revision: "p13", path: "new.sv", content: "wire a;" }));
  assert.equal(added.diff_summary[0].status, "added");
  const deleted = data(await client.delete_doc({ project_id, path: "new.sv", expected_revision: "p14" }));
  assert.equal(deleted.revision, "p15");
  assert.equal(deleted.events[0].event, "doc_deleted");
  assert.equal(deleted.diff_summary[0].status, "deleted");
  failure(await client.read_doc({ project_id, path: "new.sv" }), "invalid_reference");
});

test("Every mutation rejects stale revisions without docs, ledger or revision changes", async () => {
  const client = fresh();
  data(await client.write_doc({ project_id, path: "a.sv", content: "a", expected_revision: "p12" }));
  const before = data(await client.get_project_snapshot({ project_id }));
  const attempts = [
    client.write_doc({ project_id, path: "a.sv", content: "changed", expected_revision: "p12" }),
    client.delete_doc({ project_id, path: "a.sv", expected_revision: "p12" }),
    client.apply_mutations({ project_id, mutations: [{ op: "write", path: "b.sv", content: "b" }], expected_revision: "p12" }),
  ];
  for (const attempt of attempts) assert.equal(failure(await attempt, "revision_conflict").current_revision, "p13");
  assert.deepEqual(data(await client.get_project_snapshot({ project_id })), before);
  assert.equal(data(await client.get_events_since({ project_id })).events.length, 1);
});

test("Atomic batches reject invalid/protected paths and missing deletes without partial application", async () => {
  for (const path of ["results/report.txt", ".rocket/state", ".git/config", "../outside", "a/../outside", "/absolute", "C:\\secret", "a\\..\\b", "%2e%2e/out", "a/.git/config"]) {
    const client = fresh();
    const before = data(await client.get_project_snapshot({ project_id }));
    const result = failure(await client.apply_mutations({ project_id, expected_revision: "p12", mutations: [
      { op: "write", path: "valid.sv", content: "staged" }, { op: "write", path, content: "invalid" },
    ] }), "invalid_reference");
    assert.deepEqual(result.fields, [path]);
    assert.deepEqual(data(await client.get_project_snapshot({ project_id })), before);
    assert.equal(data(await client.get_events_since({ project_id })).events.length, 0);
  }
  const client = fresh();
  failure(await client.apply_mutations({ project_id, expected_revision: "p12", mutations: [
    { op: "write", path: "a.sv", content: "a" }, { op: "delete", path: "missing.sv" },
  ] }), "invalid_reference");
  failure(await client.read_doc({ project_id, path: "a.sv" }), "invalid_reference");
  assert.equal(data(await client.get_project_snapshot({ project_id })).revision, "p12");
});

test("Atomic valid batch advances once, attributes the ledger, and reports the final net diff", async () => {
  const client = fresh();
  const result = data(await client.apply_mutations({ project_id, expected_revision: "p12", actor: "rocket-fuel", request_id: "edit-1", mutations: [
    { op: "delete", path: "design/top.sv" }, { op: "write", path: "new.sv", content: "line 1\nline 2" },
    { op: "write", path: "temporary.sv", content: "temp" }, { op: "delete", path: "temporary.sv" },
  ] }));
  assert.equal(result.revision, "p13");
  assert.equal(result.diff_summary.length, 2);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event, "mutations_applied");
  assert.equal(result.events[0].request_id, "edit-1");
  assert.equal(result.events[0].actor, "rocket-fuel");
  assert.deepEqual(data(await client.list_docs({ project_id })).items.map(doc => doc.path), ["new.sv"]);
});

test("Two-phase submit only queues, run_job resolves request_id and updates checks with measurements", async () => {
  const client = fresh({ initialChecks: [{ check_id: "run_spice", status: "NOT_RUN", measurements: [], reason: "Not run" }] });
  failure(await client.run_job({ project_id, request_id: "unknown" }), "unknown_request");
  const ack = data(await client.submit(command()));
  assert.deepEqual(ack, { request_id: "req-1", run_id: "run:chip:req-1", snapshot_id: "snapshot:chip:p12", state: "queued", current_revision: "p13" });
  assert.equal(data(await client.get_job_status({ project_id, request_id: "req-1" })).state, "queued");
  assert.equal(data(await client.get_check_results({ project_id })).items[0].status, "NOT_RUN");
  failure(await client.run_job({ project_id, request_id: "req-1", expected_revision: "p12" }), "revision_conflict");
  const result = data(await client.run_job({ project_id, request_id: "req-1", expected_revision: "p13" }));
  assert.equal(result.current_revision, "p14");
  assert.equal(result.project_revision, "p12");
  assert.equal(result.snapshot_id, ack.snapshot_id);
  assert.equal(result.status, "PASS");
  assert.equal(result.source, "local-contract");
  assert.equal(result.freshness, "fresh");
  assert.ok(result.measurements.length >= 3);
  for (const measurement of result.measurements) {
    assert.equal(typeof measurement.value, "number");
    assert.equal(typeof measurement.margin, "number");
    assert.ok(measurement.name && measurement.unit);
    assert.notEqual(measurement.target, undefined);
  }
  assert.equal(data(await client.get_check_results({ project_id })).items[0].status, "PASS");
  assert.equal(data(await client.get_job_status({ project_id, run_id: ack.run_id })).state, "completed");
  assert.match(data(await client.get_logs({ project_id, request_id: "req-1" })).lines[0], /No external EDA tool executed/);
  assert.deepEqual(data(await client.list_artifacts({ project_id })).items, []);
});

test("Submit retries return identical ack, conflicting reuse rejects, completed runs are idempotent", async () => {
  const client = fresh();
  const first = data(await client.submit(command({ arguments: { a: 1, b: 2 } })));
  assert.deepEqual(data(await client.submit(command({ arguments: { b: 2, a: 1 } }))), first);
  failure(await client.submit(command({ arguments: { a: 9 } })), "request_conflict");
  failure(await client.submit(command({ request_id: "req-2" })), "revision_conflict");
  const verdict = data(await client.run_job({ project_id, request_id: "req-1" }));
  assert.deepEqual(data(await client.run_job({ project_id, request_id: "req-1" })), verdict);
  assert.deepEqual(data(await client.submit(command({ arguments: { a: 1, b: 2 } }))), first);
  assert.equal(data(await client.get_events_since({ project_id })).events.length, 2);
});

test("Ledger is ordered, retained across polls, attributed and cursor resumable", async () => {
  const client = fresh();
  data(await client.write_doc({ project_id, expected_revision: "p12", path: "a.sv", content: "a", actor: "human" }));
  data(await client.submit(command({ expected_revision: "p13" })));
  data(await client.run_job({ project_id, request_id: "req-1" }));
  const page = data(await client.get_events_since({ project_id, cursor: 0 }));
  assert.deepEqual(page.events.map(event => event.seq), [1, 2, 3]);
  assert.deepEqual(page.events.map(event => event.revision), ["p13", "p14", "p15"]);
  assert.deepEqual(page.events.map(event => event.event), ["doc_written", "job_queued", "run_completed"]);
  assert.deepEqual(page.events.map(event => event.actor), ["human", "rocket-fuel", "rocket-fuel"]);
  for (const event of page.events) {
    assert.equal(event.schema, ENGINE_SCHEMA);
    assert.equal(event.project_id, project_id);
    assert.ok(event.request_id);
    assert.ok(Number.isFinite(Date.parse(event.timestamp)));
  }
  assert.deepEqual(data(await client.get_events_since({ project_id, cursor: 0 })), page);
  assert.deepEqual(data(await client.get_events_since({ project_id, cursor: "1" })).events.map(event => event.seq), [2, 3]);
  assert.deepEqual(data(await client.get_events_since({ project_id, cursor: page.next_cursor })).events, []);
  failure(await client.get_events_since({ project_id, cursor: 999 }), "invalid_reference");
  failure(await client.get_events_since({ project_id, cursor: -1 }), "invalid_reference");
});

test("Unknown event names are ignored without losing cursor progress", async () => {
  const known: EngineEvent = { schema: ENGINE_SCHEMA, project_id, seq: 1, timestamp: "2026-01-01T00:00:00Z", event: "doc_written", request_id: "edit", actor: "human", revision: "p13", data: {} };
  const unknown = { ...known, seq: 2, event: "future_additive_event" };
  assert.deepEqual(filterKnownEvents([known, unknown]), [known]);
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ ok: true, data: {
    events: [known, unknown], cursor: 2, next_cursor: 2, current_revision: "p14",
  } }));
  const client = createEngineClient({ baseUrl: "https://engine.invalid", fetch: fetchImpl });
  const page = data(await pollEngineEvents(client, { project_id, cursor: 0 }));
  assert.deepEqual(page.events, [known]);
  assert.equal(page.next_cursor, 2);
});

test("Expired cursors return resync_required; a snapshot cursor resumes at retention boundary", async () => {
  const client = fresh({ eventRetention: 2 });
  for (let i = 0; i < 3; i++) data(await client.write_doc({ project_id, expected_revision: `p${12 + i}`, path: "a.sv", content: String(i) }));
  const failureResult = failure(await pollEngineEvents(client, { project_id, cursor: 0 }), "resync_required");
  assert.equal(failureResult.current_revision, "p15");
  assert.deepEqual(data(await client.get_events_since({ project_id, cursor: 1 })).events.map(event => event.seq), [2, 3]);
  const snapshot = data(await client.get_project_snapshot({ project_id }));
  assert.equal(snapshot.cursor, 3);
  assert.deepEqual(data(await pollEngineEvents(client, { project_id, cursor: snapshot.cursor })).events, []);
});

test("All frozen domain operations execute in two phases with complete measurements", async () => {
  for (const operation of RUN_OPERATIONS) {
    const client = fresh();
    data(await client.submit(command({ operation })));
    const result = data(await client.run_job({ project_id, request_id: "req-1" }));
    assert.equal(result.operation, operation);
    assert.ok(result.measurements.length > 0);
    assert.equal(result.current_revision, "p14");
  }
  assert.deepEqual(data(await fresh().list_job_kinds()).items.map(item => item.operation), RUN_OPERATIONS);
});

test("Configured FAIL, NOT_RUN and UNSUPPORTED remain distinct with run_failed events", async () => {
  for (const status of ["FAIL", "NOT_RUN", "UNSUPPORTED"] as const) {
    const client = fresh({ jobOutcomes: { run_spice: { status, reason: "Fixture outcome", measurements: [] } } });
    data(await client.submit(command()));
    const result = data(await client.run_job({ project_id, request_id: "req-1" }));
    assert.equal(result.status, status);
    assert.equal(result.reason, "Fixture outcome");
    assert.equal(data(await client.get_check_results({ project_id })).items[0].status, status);
    assert.equal(data(await client.get_events_since({ project_id })).events[1].event, "run_failed");
  }
});

test("Injected measurements are retained, and edits make completed or queued evidence stale", async () => {
  const measurements: Measurement[] = [{ name: "gain", value: 48, unit: "dB", target: 60, margin: -12, status: "FAIL" }];
  const client = fresh({ initialMeasurements: measurements });
  measurements[0].value = 999;
  data(await client.submit(command()));
  const result = data(await client.run_job({ project_id, request_id: "req-1" }));
  assert.equal(result.status, "FAIL");
  assert.equal(result.measurements[0].value, 48);
  data(await client.write_doc({ project_id, path: "a.sv", content: "a", expected_revision: "p14" }));
  assert.equal(data(await client.get_check_results({ project_id })).items[0].freshness, "stale");
  data(await client.submit(command({ request_id: "req-2", expected_revision: "p15" })));
  data(await client.write_doc({ project_id, path: "a.sv", content: "b", expected_revision: "p16" }));
  assert.equal(data(await client.run_job({ project_id, request_id: "req-2" })).freshness, "stale");
});

test("Project creation, pagination and isolation work through the factory", async () => {
  const client: EngineClient = createEngineClient({ projectId: project_id, initialDocs: { "a.sv": "a", "b.sv": "b" } });
  data(await client.create_project({ project_id: "second", name: "Second chip", docs: [{ path: "second.sv", content: "s" }] }));
  failure(await client.create_project({ project_id: "second" }), "request_conflict");
  const projects = data(await client.list_projects({ limit: 1 }));
  assert.equal(projects.next_cursor, "1");
  assert.equal(data(await client.list_projects({ cursor: "1" })).items[0].project_id, "second");
  const page = data(await client.list_docs({ project_id, limit: 1 }));
  assert.equal(page.next_cursor, "1");
  assert.equal(data(await client.list_docs({ project_id, cursor: page.next_cursor! })).items[0].path, "b.sv");
  failure(await client.read_doc({ project_id, path: "second.sv" }), "invalid_reference");
  failure(await client.list_docs({ project_id: "missing" }), "invalid_reference");
  failure(await client.list_docs({ project_id, limit: 0 }), "invalid_reference");
  failure(await client.submit(command({ operation: "run_formal" as EngineCommandEnvelope["operation"] })), "unsupported_operation");
});

test("Remote HTTP preserves frozen operation names, request payloads and structured errors", async () => {
  const requests: { url: string; method: string | undefined; body: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: false, code: "revision_conflict", message: "Stale revision", current_revision: "p99" }), { status: 409 });
  };
  const client = createEngineClient({ baseUrl: "https://engine.invalid/api/", fetch: fetchImpl });
  const args = { project_id, path: "a.sv", content: "a", expected_revision: "p12" };
  assert.equal(failure(await client.write_doc(args), "revision_conflict").current_revision, "p99");
  failure(await client.submit(command()), "revision_conflict");
  failure(await client.run_job({ project_id, request_id: "req-1" }), "revision_conflict");
  assert.deepEqual(requests[0], { url: "https://engine.invalid/api/write_doc", method: "POST", body: args });
  assert.equal(requests[1].url, "https://engine.invalid/api/submit");
  assert.equal(requests[2].url, "https://engine.invalid/api/run_job");
});

test("Network failures and malformed responses become transport_error results", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("offline"); },
    async () => new Response("not json", { status: 502 }),
    async () => new Response(JSON.stringify({ ok: true })),
  ]) {
    const client = createEngineClient({ baseUrl: "https://engine.invalid", fetch: fetchImpl });
    failure(await client.list_projects(), "transport_error");
  }
});
