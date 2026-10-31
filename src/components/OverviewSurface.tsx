import type { Check, ConstraintSet, Domain, SurfaceId, ToolDefinition } from "../types";
import { pdkLabel } from "../data";
import { Icon, ToolIcon } from "./icons";
import { DomainTag, ProgressBar, StatusPill, SurfaceHeader } from "./ui";

export function OverviewSurface({
  checks,
  constraints,
  iteration,
  tools,
  onNavigate,
  onOpenFile,
  onRunChecks,
  onOpenAssistant,
}: {
  checks: Check[];
  constraints: ConstraintSet;
  iteration: number;
  tools: ToolDefinition[];
  onNavigate: (surface: SurfaceId) => void;
  onOpenFile: (path: string) => void;
  onRunChecks: () => void;
  onOpenAssistant: () => void;
}) {
  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const pending = checks.filter((check) => ["not_run", "skipped"].includes(check.status)).length;
  const unsupported = checks.filter((check) => check.status === "unsupported").length;
  const running = checks.some((check) => check.status === "running");
  return <div className="page-surface overview-surface">
    <SurfaceHeader eyebrow="PROJECT" title="Design overview" actions={<>
      <button className="secondary-button" onClick={onOpenAssistant}><Icon name="terminal" size={13} />Assistant</button>
      <button className="primary-button" onClick={onRunChecks} disabled={running}><Icon name="play" size={12} />{running ? "Running…" : "Run checks"}</button>
    </>} />
    <div className="engineering-statusbar">
      <button onClick={() => onNavigate("verification")}><span className={`status-dot ${failed ? "failed" : passed === checks.length && checks.length ? "passed" : "not_run"}`} />{failed ? `${failed} failing` : checks.length && passed === checks.length ? "Checks passed" : "Evidence incomplete"}</button>
      <span className="passed">{passed} PASS</span><span>{pending} NOT_RUN</span><span>{unsupported} UNSUPPORTED</span>
      <span className="engineering-progress"><ProgressBar value={checks.length ? passed / checks.length * 100 : 0} /></span>
      <button onClick={onOpenAssistant}>Iteration {iteration}/{constraints.maxIterations}</button>
      <button onClick={() => onNavigate("constraints")}>{pdkLabel(constraints.pdk)}</button>
      <span className="muted">{tools.filter((t) => t.available).length}/{tools.length} tools ready</span>
    </div>
    <section className="panel spec-matrix-panel">
      <div className="panel-heading"><h2>Verification &amp; Spec Matrix</h2><span className="registry-count">{checks.length} checks</span></div>
      <div className="engineering-table-scroll"><table className="engineering-table">
        <thead><tr>{["Check ID", "Domain", "Tool", "Target", "Measured", "Status", "Artifact"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{checks.map((check) => <tr key={check.id}>
          <td title={check.name}><button className="matrix-check-link" onClick={() => onNavigate("verification")}>{check.id}</button></td>
          <td><DomainTag domain={check.domain} /></td><td>{check.tool}</td><td>{check.target}</td>
          <td className={check.status}>{check.measured}</td><td><StatusPill status={check.status} /></td>
          <td>{check.artifact && check.artifact !== "—" ? <button className="artifact-link" onClick={() => onOpenFile(check.artifact)} title={check.artifact}><Icon name="file" size={12} />{check.artifact.split("/").pop()}</button> : <span className="muted">—</span>}</td>
        </tr>)}</tbody>
      </table>{!checks.length && <div className="empty-state">No checks registered.</div>}</div>
    </section>
  </div>;
}
