import { Fragment, useEffect, useState } from "react";
import { parseDocument } from "yaml";
import { api, checkRows, formatNumber, targetText, timeAgo, type CheckRow, type Commit, type Constraints, type Evidence, type ProjectSummary } from "../api";
import { toolNeeds, type EngineToolEntry } from "./TopBar";
import type { SurfaceId } from "../types";
import { downloadText } from "../utils";
import { Icon, type IconName } from "./icons";
import { StatusPill, SurfaceHeader } from "./ui";

// Project surfaces backed by the workspace server: constraints.yaml, engine evidence in
// results/engine-runs, and git. Nothing here is sample data.

type Common = { project: ProjectSummary; evidence: Evidence[] };

function rowPill(row: CheckRow) {
  const stale = row.stale ? " (stale)" : "";
  switch (row.status) {
    case "PASS":
      return <StatusPill status={row.stale ? "skipped" : "passed"} label={`PASS${stale}`} />;
    case "FAIL":
      return <StatusPill status="failed" label={`FAIL${stale}`} />;
    case "NOT_RUN":
      return <StatusPill status="skipped" label={`NOT RUN${stale}`} />;
    case "UNSUPPORTED":
      return <StatusPill status="unsupported" />;
    default:
      return <StatusPill status="skipped" label="NOT RUN YET" />;
  }
}

function measuredText(row: CheckRow) {
  if (!row.measurement) return row.reason ?? "—";
  const unit = row.check.unit ? ` ${row.check.unit}` : "";
  const margin = row.measurement.margin;
  return `${formatNumber(row.measurement.value)}${unit} (${margin !== null && margin >= 0 ? "+" : ""}${formatNumber(margin)})`;
}

type Action = { icon: IconName; title: string; detail: string; run: () => void };

export function OverviewView({
  project,
  evidence,
  onNavigate,
  onOpenAssistant,
  onAsk,
  onRunChecks,
  running,
  engineTools,
}: Common & {
  onNavigate: (s: SurfaceId) => void;
  onOpenAssistant: () => void;
  onAsk: (text: string) => void;
  onRunChecks: () => void;
  running: boolean;
  engineTools: EngineToolEntry[] | null;
}) {
  const rows = checkRows(project.constraints, evidence, project.revision);
  const [commits, setCommits] = useState<Commit[]>([]);
  useEffect(() => {
    api.history().then(setCommits).catch(() => setCommits([]));
  }, [project.revision]);
  const passing = rows.filter((r) => r.status === "PASS" && !r.stale).length;
  const failing = rows.filter((r) => r.status === "FAIL").length;
  const latest = evidence[0];
  const verdict = rows.length === 0 ? "No checks defined" : passing === rows.length ? "All checks pass" : failing ? "Needs attention" : "Not verified yet";

  return (
    <div className="page-surface">
      <SurfaceHeader
        eyebrow={`Project · ${project.name}`}
        title={project.constraints.title ?? project.name}
        subtitle={project.constraints.description}
        actions={
          <>
            <button className="secondary-button" onClick={onOpenAssistant}>
              <Icon name="sparkles" size={13} />
              Ask the assistant
            </button>
            <button className="primary-button" onClick={onRunChecks} disabled={running || !project.constraints.simulation}>
              <Icon name="play" size={13} />
              {running ? "Running…" : "Run checks"}
            </button>
          </>
        }
      />
      <div className="stat-grid">
        <div>
          <span className="eyebrow">Design status</span>
          <b className={failing ? "failed" : passing === rows.length && rows.length ? "passed" : ""}>{verdict}</b>
        </div>
        <div>
          <span className="eyebrow">Checks passing</span>
          <b>{passing} / {rows.length}</b>
        </div>
        <div>
          <span className="eyebrow">Revision</span>
          <b>{project.revision || "—"}{project.dirty ? " +changes" : ""}</b>
        </div>
        <div>
          <span className="eyebrow">Last run</span>
          <b>{latest ? timeAgo(latest.finished_at) : "never"}</b>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Checks</span>
          <button className="text-button" onClick={() => onNavigate("verification")}>
            All evidence <Icon name="chevronRight" size={12} />
          </button>
        </div>
        <ChecksTable rows={rows} />
      </div>

      <div className="overview-columns">
        <div className="panel">
          <div className="panel-heading">
            <span className="eyebrow">Next actions</span>
          </div>
          <div className="action-list">
            {nextActions(project, rows, evidence, { onNavigate, onAsk, onRunChecks }).map((action) => (
              <button key={action.title} className="action-row" onClick={action.run}>
                <span className="action-icon"><Icon name={action.icon} size={14} /></span>
                <span>
                  <b>{action.title}</b>
                  <small>{action.detail}</small>
                </span>
                <Icon name="chevronRight" size={13} />
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-heading">
            <span className="eyebrow">Recent activity</span>
            <small className="muted">Commits and engine runs</small>
          </div>
          <ul className="activity-feed">
            {recentActivity(commits, evidence).map((item) => (
              <li key={item.key}>
                <span className={`dot ${item.tone}`} />
                <span className="feed-text">{item.text}</span>
                <span className="mono muted">{item.ref}</span>
                <time>{timeAgo(item.date)}</time>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Engine tool registry</span>
          <small className="muted">What Rocket Engine says it can run on this machine (get_capabilities)</small>
        </div>
        {!engineTools ? (
          <p className="panel-copy">Asking the engine…</p>
        ) : engineTools.length === 0 ? (
          <p className="panel-copy">Rocket Engine was not found, so no tools are available.</p>
        ) : (
          <table className="rw-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Domain</th>
                <th>Runs</th>
                <th>On this machine</th>
              </tr>
            </thead>
            <tbody>
              {engineTools.map((tool) => (
                <tr key={tool.name}>
                  <td className="mono">{tool.name}</td>
                  <td>{tool.domain}</td>
                  <td className="mono">{tool.operations.join(", ")}</td>
                  <td title={tool.readiness.map((r) => `${r.operation}: ${r.readiness}${r.reason ? ` (${r.reason})` : ""}`).join("\n")}>
                    {tool.available ? <StatusPill status="ready" label="Ready" /> : <span className="muted">{toolNeeds(tool) || "Not available"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Agent</span>
        </div>
        <p className="panel-copy">
          {project.agent.state === "ready" && "The assistant is running on this project. Describe what you want; it edits design files, runs the checks on the engine, and asks before changes."}
          {project.agent.state === "starting" && "Starting the assistant for this project…"}
          {project.agent.state === "error" && `The assistant failed to start: ${project.agent.error}`}
          {project.agent.state === "stopped" && "The assistant is not running."}
        </p>
      </div>
    </div>
  );
}

// What to do next, read off the real check status.
function nextActions(
  project: ProjectSummary,
  rows: CheckRow[],
  evidence: Evidence[],
  go: { onNavigate: (s: SurfaceId) => void; onAsk: (text: string) => void; onRunChecks: () => void },
): Action[] {
  if (!rows.length) {
    return [
      { icon: "sliders", title: "Define measurable checks", detail: "No targets yet; nothing can pass or fail.", run: () => go.onNavigate("constraints") },
      { icon: "sparkles", title: "Ask the assistant to propose constraints", detail: "It drafts checks you approve.", run: () => go.onAsk("Propose measurable constraints for this design.") },
    ];
  }
  const actions: Action[] = [];
  if (!evidence.length) actions.push({ icon: "play", title: "Run the checks", detail: "No engine run yet for this project.", run: go.onRunChecks });
  for (const row of rows.filter((r) => r.status === "FAIL").slice(0, 2)) {
    const name = row.check.title ?? row.check.metric;
    actions.push({
      icon: "warning",
      title: `Fix ${name}`,
      detail: `Measured ${measuredText(row)} against ${targetText(row.check)}.`,
      run: () => go.onAsk(`Bring ${name} (${row.check.metric}) to spec, ${targetText(row.check)}, without breaking the other checks.`),
    });
  }
  const stale = rows.filter((r) => r.stale);
  if (stale.length && evidence.length) {
    actions.push({ icon: "refresh", title: "Re-run the checks", detail: `${stale.length} result${stale.length > 1 ? "s are" : " is"} from an older revision than ${project.revision}.`, run: go.onRunChecks });
  }
  const notRun = rows.filter((r) => r.status === "NOT_RUN" || r.status === "UNSUPPORTED");
  if (notRun.length) actions.push({ icon: "verification", title: "See why checks did not run", detail: notRun[0].reason ?? "The engine could not run them.", run: () => go.onNavigate("verification") });
  if (!actions.length) actions.push({ icon: "export", title: "Export the verified design", detail: "Every check passes at this revision.", run: () => go.onNavigate("export") });
  return actions;
}

function recentActivity(commits: Commit[], evidence: Evidence[]) {
  return [
    ...commits.map((c) => ({ key: `c${c.hash}`, date: c.date, text: c.subject, ref: c.hash, tone: "" })),
    ...evidence.map((e) => ({
      key: `r${e.run_id}`,
      date: e.finished_at,
      text: `${e.operation} ${e.verdict.status.replace("_", " ")}${e.verdict.measurements ? ` · ${e.verdict.measurements.filter((m) => m.status === "pass").length}/${e.verdict.measurements.length} checks` : ""}`,
      ref: e.source_commit ?? "",
      tone: e.verdict.status === "PASS" ? "green" : e.verdict.status === "FAIL" ? "red" : "amber",
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
}

function ChecksTable({ rows, detailed = false }: { rows: CheckRow[]; detailed?: boolean }) {
  if (rows.length === 0) {
    return <p className="panel-copy">No checks in constraints.yaml yet. Add targets there, or ask the assistant to propose them.</p>;
  }
  return (
    <table className="rw-table">
      <thead>
        <tr>
          <th>Check</th>
          <th>Target</th>
          <th>Measured (margin)</th>
          <th>Status</th>
          {detailed && <th>Run</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.check.id ?? row.check.metric}>
            <td>
              <b>{row.check.title ?? row.check.metric}</b>
              <small>{row.check.metric}{row.check.required === false ? " · optional" : ""}</small>
            </td>
            <td className="mono">{targetText(row.check)}</td>
            <td className="mono">{measuredText(row)}</td>
            <td>{rowPill(row)}</td>
            {detailed && (
              <td className="mono">
                {row.evidence ? `${row.evidence.source_commit ?? "?"} · ${timeAgo(row.evidence.finished_at)}` : "—"}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type ConstraintsDraft = {
  pdk: string;
  domains: string[];
  mode: "approval" | "auto";
  limit: string;
  checks: { comparison: string; value: string; required: boolean }[];
};

const DOMAINS = ["analog", "digital", "mixed-signal", "photonic"];
const PDKS = ["none", "sky130", "gf180mcu", "ihp-sg13g2", "cspdk"];

function draftOf(c: Constraints): ConstraintsDraft {
  return {
    pdk: c.pdk ?? "none",
    domains: c.domains ?? [],
    mode: c.agent?.mode === "auto" ? "auto" : "approval",
    limit: String(c.agent?.iteration_limit ?? 3),
    checks: (c.checks ?? []).map((check) => ({ comparison: check.comparison, value: String(check.value), required: check.required !== false })),
  };
}

function draftProblems(draft: ConstraintsDraft): string[] {
  const problems: string[] = [];
  if (!/^\d+$/.test(draft.limit) || Number(draft.limit) < 1 || Number(draft.limit) > 50) problems.push("The repair limit must be a whole number from 1 to 50.");
  draft.checks.forEach((check, index) => {
    if (!Number.isFinite(Number(check.value)) || check.value.trim() === "") problems.push(`Check ${index + 1}: the target must be a number.`);
  });
  if (!draft.pdk.trim()) problems.push("Name a PDK, or choose none.");
  return problems;
}

// Form over constraints.yaml. Saving rewrites only the fields changed here (comments and the
// rest of the file stay) and commits it, like any other save.
export function ConstraintsView({
  project,
  readFile,
  onSave,
  onOpenFile,
}: {
  project: ProjectSummary;
  readFile: (path: string) => Promise<string>;
  onSave: (path: string, content: string) => Promise<void>;
  onOpenFile: (path: string) => void;
}) {
  const c = project.constraints;
  const [draft, setDraft] = useState<ConstraintsDraft>(() => draftOf(c));
  const [saving, setSaving] = useState(false);
  const baseline = JSON.stringify(draftOf(c));
  const dirty = JSON.stringify(draft) !== baseline;
  const problems = draftProblems(draft);

  // The file changed underneath (the assistant, or the raw editor): follow it unless there are edits here.
  useEffect(() => {
    if (!dirty) setDraft(draftOf(c));
  }, [baseline]);

  const set = (patch: Partial<ConstraintsDraft>) => setDraft((previous) => ({ ...previous, ...patch }));
  const setCheck = (index: number, patch: Partial<ConstraintsDraft["checks"][number]>) =>
    setDraft((previous) => ({ ...previous, checks: previous.checks.map((check, i) => (i === index ? { ...check, ...patch } : check)) }));

  const save = async () => {
    setSaving(true);
    try {
      const doc = parseDocument(await readFile("constraints.yaml"));
      doc.set("pdk", draft.pdk.trim());
      doc.set("domains", doc.createNode(draft.domains, { flow: true }));
      doc.setIn(["agent", "mode"], draft.mode);
      doc.setIn(["agent", "iteration_limit"], Number(draft.limit));
      draft.checks.forEach((check, index) => {
        doc.setIn(["checks", index, "comparison"], check.comparison);
        doc.setIn(["checks", index, "value"], Number(check.value));
        doc.setIn(["checks", index, "required"], check.required);
      });
      await onSave("constraints.yaml", doc.toString({ flowCollectionPadding: false, lineWidth: 0 }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-surface">
      <SurfaceHeader
        eyebrow="Project · verification gates"
        title="Constraints"
        subtitle="Targets and required checks are explicit before generation. The engine measures against these and the agent cannot change them without your approval. Saved to constraints.yaml as a commit."
        actions={
          <>
            {dirty && <span className="unsaved-pill">UNSAVED</span>}
            <button className="secondary-button" onClick={() => onOpenFile("constraints.yaml")}>
              <Icon name="code" size={13} />
              constraints.yaml
            </button>
            {dirty && (
              <button className="secondary-button" onClick={() => setDraft(draftOf(c))} disabled={saving}>
                Discard
              </button>
            )}
            <button className="primary-button" onClick={() => void save()} disabled={!dirty || saving || problems.length > 0}>
              <Icon name="save" size={13} />
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      />
      {problems.length > 0 && dirty && <div className="notice error">{problems.join(" ")}</div>}

      <div className="form-grid">
        <section className="panel form-panel">
          <span className="eyebrow">Process and domains</span>
          <label className="field">
            <span>Process design kit</span>
            <input list="pdk-options" value={draft.pdk} onChange={(event) => set({ pdk: event.target.value })} />
            <datalist id="pdk-options">
              {PDKS.map((pdk) => <option key={pdk} value={pdk} />)}
            </datalist>
            <small>"none" uses the generic level-1 models in the netlist.</small>
          </label>
          <div className="field">
            <span>Design domains</span>
            <div className="check-row">
              {DOMAINS.map((domain) => (
                <label key={domain} className={`toggle-chip ${draft.domains.includes(domain) ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={draft.domains.includes(domain)}
                    onChange={(event) =>
                      set({ domains: event.target.checked ? [...draft.domains, domain] : draft.domains.filter((d) => d !== domain) })
                    }
                  />
                  {domain}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="panel form-panel">
          <span className="eyebrow">Repair loop and stop rule</span>
          <div className="field">
            <span>Autonomy</span>
            <div className="segmented" role="radiogroup" aria-label="Autonomy">
              <button role="radio" aria-checked={draft.mode === "approval"} className={draft.mode === "approval" ? "active" : ""} onClick={() => set({ mode: "approval" })}>
                Approval
              </button>
              <button role="radio" aria-checked={draft.mode === "auto"} className={draft.mode === "auto" ? "active" : ""} onClick={() => set({ mode: "auto" })}>
                Automatic repair
              </button>
            </div>
            <small>{draft.mode === "auto" ? "The assistant applies design edits without asking." : "You approve every design edit before it is written."}</small>
          </div>
          <label className="field">
            <span>Maximum repair iterations</span>
            <input type="number" min={1} max={50} value={draft.limit} onChange={(event) => set({ limit: event.target.value })} />
            <small>Engine runs per session before the assistant must stop and ask.</small>
          </label>
        </section>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Numeric targets</span>
          <small className="muted">No green without a run: a check only passes on engine evidence.</small>
        </div>
        {draft.checks.length === 0 ? (
          <p className="panel-copy">No checks defined yet. Add them in constraints.yaml, or ask the assistant to propose some.</p>
        ) : (
          <table className="rw-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Target</th>
                <th>Measured by</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {(c.checks ?? []).map((check, index) => {
                const row = draft.checks[index];
                if (!row) return null;
                return (
                  <tr key={check.id ?? check.metric}>
                    <td>
                      <b>{check.title ?? check.metric}</b>
                      <small>{check.metric}</small>
                    </td>
                    <td>
                      <span className="target-edit">
                        <select value={row.comparison} onChange={(event) => setCheck(index, { comparison: event.target.value })} aria-label={`${check.metric} comparison`}>
                          {[">=", "<=", ">", "<", "=="].map((op) => <option key={op} value={op}>{op.replace(">=", "≥").replace("<=", "≤")}</option>)}
                        </select>
                        <input value={row.value} onChange={(event) => setCheck(index, { value: event.target.value })} aria-label={`${check.metric} target`} />
                        <span className="muted">{check.unit}</span>
                      </span>
                    </td>
                    <td className="mono">{[...(check.control ?? []), check.expr].filter(Boolean).join(" ; ") || "—"}</td>
                    <td>
                      <input type="checkbox" checked={row.required} onChange={(event) => setCheck(index, { required: event.target.checked })} aria-label={`${check.metric} required`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {c.simulation && (
        <div className="panel">
          <div className="panel-heading">
            <span className="eyebrow">What Run checks simulates</span>
          </div>
          <p className="panel-copy mono">
            {c.simulation.operation ?? "run_spice"} · {(c.simulation.sources ?? []).join(", ")} · {(c.simulation.analyses ?? []).join(" ; ")}
          </p>
        </div>
      )}
    </div>
  );
}

type Filter = "all" | "passed" | "failed" | "not-run";

export function ChecksView({
  project,
  evidence,
  running,
  onRunChecks,
  onExportReport,
  onOpenFile,
}: Common & { running: boolean; onRunChecks: () => void; onExportReport: () => void; onOpenFile: (path: string) => void }) {
  const rows = checkRows(project.constraints, evidence, project.revision);
  const [filter, setFilter] = useState<Filter>("all");
  const [openRun, setOpenRun] = useState<string>();
  const counts = {
    all: rows.length,
    passed: rows.filter((r) => r.status === "PASS" && !r.stale).length,
    failed: rows.filter((r) => r.status === "FAIL").length,
    "not-run": rows.filter((r) => r.status !== "FAIL" && (r.status !== "PASS" || r.stale)).length,
  };
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "passed" ? r.status === "PASS" && !r.stale : filter === "failed" ? r.status === "FAIL" : r.status !== "FAIL" && (r.status !== "PASS" || r.stale),
  );
  const required = rows.filter((r) => r.check.required !== false);
  const requiredPassing = required.filter((r) => r.status === "PASS" && !r.stale).length;
  // How each metric moved from run to run (oldest first), from the recorded evidence.
  const measuredRuns = evidence.filter((e) => e.verdict.measurements?.length).slice(0, 12).reverse();
  const metrics = (project.constraints.checks ?? []).map((check) => check.metric);
  const limit = project.constraints.agent?.iteration_limit;

  return (
    <div className="page-surface">
      <SurfaceHeader
        eyebrow="Evidence · checks"
        title="Verification"
        subtitle="Every row records a target, a measured value, the source revision and the run that produced it. Statuses come only from Rocket Engine runs in results/engine-runs; runs on an older revision are stale."
        actions={
          <>
            <button className="secondary-button" onClick={onExportReport} disabled={!evidence.length}>
              <Icon name="download" size={13} />
              Report
            </button>
            <button className="primary-button" onClick={onRunChecks} disabled={running || !project.constraints.simulation}>
              <Icon name="play" size={13} />
              {running ? "Running…" : "Run checks"}
            </button>
          </>
        }
      />
      <div className="stat-grid">
        <div>
          <span className="eyebrow">Required gates</span>
          <b className={required.length && requiredPassing === required.length ? "passed" : ""}>{requiredPassing} / {required.length} passing</b>
          <div className="gate-bar" aria-hidden="true"><span style={{ width: `${required.length ? (100 * requiredPassing) / required.length : 0}%` }} /></div>
        </div>
        <div>
          <span className="eyebrow">Last run</span>
          <b>{evidence[0] ? timeAgo(evidence[0].finished_at) : "never"}</b>
        </div>
        <div>
          <span className="eyebrow">Source revision</span>
          <b>{project.revision || "—"}{project.dirty ? " +changes" : ""}</b>
        </div>
        <div>
          <span className="eyebrow">Stop rule</span>
          <b>{limit ? `${limit} repair runs` : "—"}</b>
        </div>
      </div>
      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Checks at {project.revision || "—"}</span>
          <div className="segmented" role="tablist" aria-label="Filter checks">
            {(["all", "passed", "failed", "not-run"] as Filter[]).map((id) => (
              <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
                {id === "not-run" ? "Not run / stale" : id[0].toUpperCase() + id.slice(1)} {counts[id]}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 && rows.length > 0 ? <p className="panel-copy">No checks in this filter.</p> : <ChecksTable rows={shown} detailed />}
      </div>
      {measuredRuns.length > 1 && (
        <div className="panel">
          <div className="panel-heading">
            <span className="eyebrow">Iteration history</span>
            <small className="muted">Each column is an engine run, oldest first</small>
          </div>
          <div className="table-scroll">
            <table className="rw-table history-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  {measuredRuns.map((run) => (
                    <th key={run.run_id} className="mono" title={new Date(run.finished_at).toLocaleString()}>
                      {run.source_commit ?? "?"}
                      <small>{new Date(run.finished_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => (
                  <tr key={metric}>
                    <td className="mono">{metric}</td>
                    {measuredRuns.map((run) => {
                      const m = run.verdict.measurements?.find((x) => x.name === metric);
                      return (
                        <td key={run.run_id} className={`mono ${m ? (m.status === "pass" ? "cell-pass" : "cell-fail") : ""}`}>
                          {m ? formatNumber(m.value) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td>Verdict</td>
                  {measuredRuns.map((run) => (
                    <td key={run.run_id} className={run.verdict.status === "PASS" ? "cell-pass" : "cell-fail"}>{run.verdict.status.replace("_", " ")}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Run history</span>
          <small className="muted">Click a run for its tool output</small>
        </div>
        {evidence.length === 0 ? (
          <p className="panel-copy">No runs yet. Run the checks, or ask the assistant to.</p>
        ) : (
          <table className="rw-table runs-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Operation · tool</th>
                <th>Revision</th>
                <th>Verdict</th>
                <th>Measurements</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((e) => (
                <Fragment key={e.run_id}>
                  <tr className={`run-row ${openRun === e.run_id ? "open" : ""}`} onClick={() => setOpenRun(openRun === e.run_id ? undefined : e.run_id)}>
                    <td>{new Date(e.finished_at).toLocaleString()}</td>
                    <td className="mono">{e.operation} · {e.producer}</td>
                    <td className="mono">{e.source_commit ?? "?"}{e.source_dirty ? " +changes" : ""}</td>
                    <td>
                      <StatusPill
                        status={e.verdict.status === "PASS" ? "passed" : e.verdict.status === "FAIL" ? "failed" : "skipped"}
                        label={e.verdict.status.replace("_", " ")}
                      />
                    </td>
                    <td className="mono">
                      {e.verdict.measurements?.map((m) => `${m.name} ${formatNumber(m.value)}`).join(" · ") ?? e.verdict.reason ?? ""}
                    </td>
                  </tr>
                  {openRun === e.run_id && (
                    <tr className="run-detail">
                      <td colSpan={5}>
                        <div className="run-detail-head">
                          <span className="mono">run {e.run_id}</span>
                          <span className="mono muted">{e.sources.join(", ")}</span>
                          <button className="text-button" onClick={() => onOpenFile(`results/engine-runs/${e.run_id}.json`)}>
                            Open artifact <Icon name="chevronRight" size={12} />
                          </button>
                        </div>
                        <pre className="tool-output">{e.log ? e.log.split("\n").slice(-60).join("\n") : "No tool output recorded."}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function ExportView({ project, evidence, onExportReport }: Common & { onExportReport: () => void }) {
  return (
    <div className="page-surface">
      <SurfaceHeader eyebrow="Export" title="Export" subtitle="Download the project and its evidence. Generated output is not a foundry-approved tapeout." />
      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Project archive</span>
        </div>
        <p className="panel-copy">
          All project files at {project.revision || "the current revision"}, including results/ evidence ({evidence.length} run
          {evidence.length === 1 ? "" : "s"}), as a .tar.gz.
        </p>
        <a className="primary-button export-link" href={api.exportUrl} download>
          <Icon name="download" size={13} />
          Download {project.name}.tar.gz
        </a>
      </div>
      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Verification report</span>
        </div>
        <p className="panel-copy">Markdown report of every check with its real status, measured value and the revision it ran on.</p>
        <button className="secondary-button" onClick={onExportReport} disabled={!evidence.length}>
          <Icon name="download" size={13} />
          Download report
        </button>
      </div>
    </div>
  );
}

export function verificationReport(project: ProjectSummary, evidence: Evidence[]) {
  const rows = checkRows(project.constraints, evidence, project.revision);
  const lines = [
    `# Verification report: ${project.name}`,
    "",
    `Revision ${project.revision}${project.dirty ? " (with unsaved design changes)" : ""} · generated ${new Date().toISOString()}`,
    "",
    "| Check | Target | Measured | Margin | Status | Run revision |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) =>
      `| ${r.check.title ?? r.check.metric} | ${targetText(r.check)} | ${r.measurement ? formatNumber(r.measurement.value) : "—"} | ${
        r.measurement ? formatNumber(r.measurement.margin) : "—"
      } | ${r.status.replace(/_/g, " ")}${r.stale ? " (stale)" : ""} | ${r.evidence?.source_commit ?? "—"} |`,
    ),
    "",
    "Statuses come only from Rocket Engine runs recorded in results/engine-runs. NOT RUN and stale results are not passes.",
    "Generated output is not a foundry-approved tapeout.",
  ];
  downloadText(`verification-${project.name}-${project.revision}.md`, lines.join("\n") + "\n", "text/markdown");
}
