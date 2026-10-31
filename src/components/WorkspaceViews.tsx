import type { ReactNode } from "react";
import { api, checkRows, formatNumber, targetText, timeAgo, type CheckRow, type Evidence, type ProjectSummary } from "../api";
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
  return `${formatNumber(row.measurement.value)}${unit} (${margin >= 0 ? "+" : ""}${formatNumber(margin)})`;
}

export function OverviewView({
  project,
  evidence,
  onNavigate,
  onOpenAssistant,
  onRunChecks,
  running,
  tools,
}: Common & { onNavigate: (s: SurfaceId) => void; onOpenAssistant: () => void; onRunChecks: () => void; running: boolean; tools: Record<string, boolean> }) {
  const rows = checkRows(project.constraints, evidence, project.revision);
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

      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Tools on this machine</span>
        </div>
        <div className="tool-chips">
          {Object.entries(tools).map(([tool, found]) => (
            <span key={tool} className={`tool-chip ${found ? "found" : ""}`} title={found ? (tool === "ngspice" ? "Installed and wired to the engine (run_spice)" : "Installed; no engine operation wired yet") : "Not installed"}>
              {tool}
              {found && tool !== "ngspice" ? " · not wired" : ""}
            </span>
          ))}
        </div>
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

export function ConstraintsView({ project, onOpenFile }: { project: ProjectSummary; onOpenFile: (path: string) => void }) {
  const c = project.constraints;
  return (
    <div className="page-surface">
      <SurfaceHeader
        eyebrow="Constraints"
        title="Targets and checks"
        subtitle="Read from constraints.yaml. The engine takes targets and measurement formulas from here; the agent cannot change them without your approval."
        actions={
          <button className="primary-button" onClick={() => onOpenFile("constraints.yaml")}>
            <Icon name="code" size={13} />
            Edit constraints.yaml
          </button>
        }
      />
      <div className="stat-grid">
        <div>
          <span className="eyebrow">PDK</span>
          <b>{c.pdk ?? "—"}</b>
        </div>
        <div>
          <span className="eyebrow">Repair limit</span>
          <b>{c.agent?.iteration_limit ?? "—"} iterations</b>
        </div>
        <div>
          <span className="eyebrow">Autonomy</span>
          <b>{c.agent?.mode === "auto" ? "Automatic" : "Approval"}</b>
        </div>
        <div>
          <span className="eyebrow">Simulation</span>
          <b>{c.simulation?.operation ?? "none"}</b>
        </div>
      </div>
      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Checks</span>
        </div>
        {(c.checks ?? []).length === 0 ? (
          <p className="panel-copy">No checks defined yet.</p>
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
              {(c.checks ?? []).map((check) => (
                <tr key={check.id ?? check.metric}>
                  <td>
                    <b>{check.title ?? check.metric}</b>
                    <small>{check.metric}</small>
                  </td>
                  <td className="mono">{targetText(check)}</td>
                  <td className="mono">{[...(check.control ?? []), check.expr].filter(Boolean).join(" ; ") || "—"}</td>
                  <td>{check.required === false ? "no" : "yes"}</td>
                </tr>
              ))}
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
            {(c.simulation.sources ?? []).join(", ")} · {(c.simulation.analyses ?? []).join(" ; ")}
          </p>
        </div>
      )}
    </div>
  );
}

export function ChecksView({
  project,
  evidence,
  running,
  onRunChecks,
  onExportReport,
}: Common & { running: boolean; onRunChecks: () => void; onExportReport: () => void }) {
  const rows = checkRows(project.constraints, evidence, project.revision);
  return (
    <div className="page-surface">
      <SurfaceHeader
        eyebrow="Verification"
        title="Evidence"
        subtitle="Every status comes from a real engine run recorded in results/engine-runs, by you or the assistant. Runs on an older revision are marked stale."
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
      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Checks at {project.revision || "—"}</span>
        </div>
        <ChecksTable rows={rows} detailed />
      </div>
      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">Run history</span>
        </div>
        {evidence.length === 0 ? (
          <p className="panel-copy">No runs yet. Run the checks, or ask the assistant to.</p>
        ) : (
          <table className="rw-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Operation</th>
                <th>Revision</th>
                <th>Verdict</th>
                <th>Measurements</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((e) => (
                <tr key={e.run_id}>
                  <td>{new Date(e.finished_at).toLocaleString()}</td>
                  <td className="mono">{e.operation}</td>
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

const EMPTY: Partial<Record<SurfaceId, { icon: IconName; title: string; body: string }>> = {
  schematic: {
    icon: "schematic",
    title: "No schematic view yet",
    body: "Schematic views will come from the engine's generate_views operation, which isn't wired yet. The netlists in design/ are the source of truth; open them from the explorer.",
  },
  layout: {
    icon: "layout",
    title: "No layout yet",
    body: "This project has no GDS or layout view. Layouts appear here once a layout flow (GDSFactory, LibreLane, Magic) runs through the engine.",
  },
  plots: {
    icon: "plot",
    title: "No waveforms recorded",
    body: "Runs currently record measured values, not full waveforms. The measurements are under Verification.",
  },
  terminal: {
    icon: "terminal",
    title: "Terminal not connected",
    body: "Shell and Python execution stay disabled until they run in the engine's isolated worker with per-run approval.",
  },
};

export function EmptyView({ surface }: { surface: SurfaceId }): ReactNode {
  const info = EMPTY[surface];
  if (!info) return null;
  return (
    <div className="empty-state page-surface">
      <Icon name={info.icon} size={24} />
      <b>{info.title}</b>
      <span>{info.body}</span>
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
