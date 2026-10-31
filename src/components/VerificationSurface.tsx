import { useState } from "react";
import type { Check, ConstraintSet } from "../types";
import { Icon } from "./icons";
import { DomainTag, ProgressBar, StatusPill, SurfaceHeader } from "./ui";

type Filter = "all" | "passed" | "failed" | "not_run" | "unsupported";

const statusCopy: Record<Check["status"], string> = {
  passed: "Actual tool output met the acceptance criterion for this revision.",
  failed: "The run completed but missed the target. This stays failed until a new run passes.",
  running: "A runner job is active. Results are not evidence until the run completes.",
  not_run: "No run completed for this revision (missing dependency, input, or not yet queued). Not a pass.",
  unsupported: "No compatible tool or deck was available. This is not a pass and is not counted as one.",
  skipped: "Required checks are never silently skipped. Skipped means no evidence was produced.",
};

export function VerificationSurface({
  checks,
  constraints,
  iteration,
  onRunChecks,
  onExportReport,
  onOpenFile,
}: {
  checks: Check[];
  constraints: ConstraintSet;
  iteration: number;
  onRunChecks: () => void;
  onExportReport: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["static-timing"]));

  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const unsupported = checks.filter((check) => check.status === "unsupported").length;
  const running = checks.some((check) => check.status === "running");
  const notRun = checks.filter((check) => check.status === "not_run" || check.status === "skipped").length;

  const filteredChecks = checks.filter((check) => {
    if (filter === "all") return true;
    return check.status === filter || (filter === "not_run" && check.status === "skipped");
  });

  const toggleExpanded = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const limitReached = iteration >= constraints.maxIterations;

  return (
    <div className="page-surface verification-surface">
      <SurfaceHeader
        eyebrow="EVIDENCE / CHECKS"
        title="Verification"
        subtitle="Every row records a target, a measured value, the tool version, the source revision and an artifact reference."
        actions={
          <>
            <button className="secondary-button" onClick={onExportReport}>
              <Icon name="download" size={13} />
              Export report
            </button>
            <button className="primary-button" onClick={onRunChecks} disabled={running}>
              <Icon name="play" size={12} />
              {running ? "Checks running…" : "Run supported checks"}
            </button>
          </>
        }
      />

      <div className="verification-summary">
        <div className="verify-stat">
          <span className="eyebrow">PASS</span>
          <b className="pass">{passed}</b>
          <small>actual runs met targets</small>
        </div>
        <div className="verify-stat">
          <span className="eyebrow">FAIL</span>
          <b className="fail">{failed}</b>
          <small>evidence retained</small>
        </div>
        <div className="verify-stat">
          <span className="eyebrow">UNSUPPORTED</span>
          <b className="skip">{unsupported}</b>
          <small>not counted as passes</small>
        </div>
        <div className="verify-stat"><span className="eyebrow">NOT_RUN</span><b>{notRun}</b><small>no completed evidence</small></div>
        <div className="verify-progress">
          <div className="summary-progress-label">
            <span>Required gate progress</span>
            <b>
              {passed}/{checks.length}
            </b>
          </div>
          <ProgressBar value={checks.length ? (passed / checks.length) * 100 : 0} />
          <small>
            {constraints.requiredChecks.length} gates configured · max {constraints.maxIterations}{" "}
            repair iterations
          </small>
        </div>
      </div>

      <div className="filter-bar" role="tablist" aria-label="Filter checks">
        {(
          [
            ["all", "All", checks.length],
            ["passed", "PASS", passed],
            ["failed", "FAIL", failed],
            ["not_run", "NOT_RUN", notRun],
            ["unsupported", "UNSUPPORTED", unsupported],
          ] as [Filter, string, number][]
        ).map(([id, label, count]) => (
          <button
            key={id}
            role="tab"
            aria-selected={filter === id}
            className={`filter-chip ${filter === id ? "active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
        <span className="filter-note">
          <Icon name="lock" size={12} />
          Unsupported checks stay distinct from passes.
        </span>
      </div>

      <section className="panel check-panel">
        {filteredChecks.length === 0 ? (
          <div className="empty-state">
            <Icon name="verification" size={22} />
            <b>No checks in this filter</b>
            <span>Switch filters or run the supported verification gates.</span>
          </div>
        ) : (
          filteredChecks.map((check) => {
            const isExpanded = expanded.has(check.id);
            const required = constraints.requiredChecks.includes(check.id);
            return (
              <article className={`check-item ${isExpanded ? "expanded" : ""}`} key={check.id}>
                <button
                  className="check-summary"
                  onClick={() => toggleExpanded(check.id)}
                  aria-expanded={isExpanded}
                >
                  <StatusPill status={check.status} />
                  <span className="check-title">
                    <b title={check.name}>{check.id}</b>
                    <small>
                      {check.tool} · updated {check.updated}
                      {!required && " · not required"}
                    </small>
                  </span>
                  <DomainTag domain={check.domain} />
                  <span className="check-target">
                    <small>Target</small>
                    <b>{check.target}</b>
                  </span>
                  <span className={`check-measured ${check.status}`}>
                    <small>Measured</small>
                    <b>{check.measured}</b>
                  </span>
                  <Icon name={isExpanded ? "chevronDown" : "chevronRight"} size={14} />
                </button>

                {isExpanded && (
                  <div className="check-detail">
                    <div className="evidence-grid">
                      <div>
                        <span className="eyebrow">TARGET</span>
                        <b>{check.target}</b>
                      </div>
                      <div>
                        <span className="eyebrow">MEASURED</span>
                        <b className={check.status}>{check.measured}</b>
                      </div>
                      <div>
                        <span className="eyebrow">TOOL / VERSION</span>
                        <b>{check.tool}</b>
                      </div>
                      <div>
                        <span className="eyebrow">SOURCE REVISION</span>
                        <b>{check.revision}</b>
                      </div>
                      <div>
                        <span className="eyebrow">PDK</span>
                        <b>{constraints.pdk === "cspdk" && check.domain === "digital" ? "—" : constraints.pdk}</b>
                      </div>
                      <div>
                        <span className="eyebrow">LAST RUN</span>
                        <b>{check.updated}</b>
                      </div>
                    </div>

                    <div className={`status-explainer ${check.status}`}>
                      <span className="status-dot" />
                      {statusCopy[check.status]}
                    </div>

                    <div className="check-log-row">
                      <div className="check-log">
                        <span className="eyebrow">TOOL OUTPUT</span>
                        <pre>{check.log}</pre>
                      </div>
                      <div className="check-artifact">
                        <span className="eyebrow">ARTIFACT</span>
                        {!check.artifact || check.artifact === "—" ? (
                          <span className="artifact-missing">No artifact — no run</span>
                        ) : (
                          <button
                            className="artifact-link"
                            onClick={() => onOpenFile(check.artifact)}
                            title={`Open ${check.artifact}`}
                          >
                            <Icon name="file" size={13} />
                            {check.artifact}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      <div className="verification-footer">
        <span><Icon name="history" size={12} />Iteration {iteration}/{constraints.maxIterations}</span>
        <span>{constraints.requiredChecks.length} required gates</span>
        <span className={limitReached ? "failed" : "muted"}>{limitReached ? "Repair limit reached · awaiting direction" : `${Math.max(0, constraints.maxIterations - iteration)} iterations remaining`}</span>
        <span>Evidence revisions: {[...new Set(checks.map((check) => check.revision))].join(", ") || "—"}</span>
      </div>
    </div>
  );
}
