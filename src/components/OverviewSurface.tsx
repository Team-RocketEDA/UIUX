import type { Check, ConstraintSet, Domain, SurfaceId, ToolDefinition } from "../types";
import { activityFeed, pdkLabel } from "../data";
import { Icon } from "./icons";
import { ProgressBar, StatusPill, SurfaceHeader } from "./ui";

const domainMeta: Record<
  Domain,
  { label: string; detail: string; icon: string; surface: SurfaceId; action: string }
> = {
  digital: {
    label: "Digital · RISC-V + GPIO",
    detail: "RTL → Sky130 GDS",
    icon: "D",
    surface: "layout",
    action: "Open layout",
  },
  analog: {
    label: "Analog · two-stage op-amp",
    detail: "Transistor-level SPICE",
    icon: "A",
    surface: "plots",
    action: "Open plots",
  },
  photonic: {
    label: "Photonic · MZI filter",
    detail: "GDSFactory + SAX at 1550 nm",
    icon: "P",
    surface: "plots",
    action: "Open plots",
  },
};

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
  const unsupported = checks.filter((check) => check.status === "unsupported").length;
  const running = checks.some((check) => check.status === "running");
  const total = checks.length;
  const status = failed > 0 ? "Needs attention" : passed === total ? "Ready for review" : "In progress";
  const availableTools = tools.filter((tool) => tool.available).length;

  const domains: Domain[] = ["digital", "analog", "photonic"];
  const domainSummary = domains.map((domain) => {
    const scoped = checks.filter((check) => check.domain === domain);
    const scopedPassed = scoped.filter((check) => check.status === "passed").length;
    const scopedFailed = scoped.some((check) => check.status === "failed");
    const scopedUnsupported = scoped.filter((check) => check.status === "unsupported").length;
    return { domain, scoped, scopedPassed, scopedFailed, scopedUnsupported };
  });

  return (
    <div className="page-surface overview-surface">
      <SurfaceHeader
        eyebrow={`PROJECT / ${constraints.pdk.toUpperCase()} / MIXED DOMAIN`}
        title="Design overview"
        subtitle="Set constraints, direct the agent, inspect source, and review verification evidence before export."
        actions={
          <>
            <button className="secondary-button" onClick={onOpenAssistant}>
              <Icon name="sparkles" size={13} />
              Open assistant
            </button>
            <button className="primary-button" onClick={onRunChecks} disabled={running}>
              <Icon name="play" size={12} />
              {running ? "Checks running…" : "Run checks"}
            </button>
          </>
        }
      />

      <div className="metric-grid">
        <button className="metric-card" onClick={() => onNavigate("verification")}>
          <span className="eyebrow">DESIGN STATUS</span>
          <div className={`metric-value ${failed > 0 ? "attention" : ""}`}>
            <span className={`status-dot ${failed > 0 ? "failed" : "passed"}`} />
            {status}
          </div>
          <small>
            {failed} failed · {unsupported} unsupported
          </small>
        </button>
        <button className="metric-card" onClick={() => onNavigate("verification")}>
          <span className="eyebrow">VERIFICATION</span>
          <div className="metric-value">
            {passed} <span className="metric-slash">/</span> {total}
            <span className="metric-unit">checks passed</span>
          </div>
          <ProgressBar value={(passed / total) * 100} />
        </button>
        <button className="metric-card" onClick={() => onOpenAssistant()}>
          <span className="eyebrow">REPAIR ITERATION</span>
          <div className="metric-value">
            {String(iteration).padStart(2, "0")}
            <span className="metric-unit">of {constraints.maxIterations} max</span>
          </div>
          <small>{constraints.autonomy === "auto" ? "Automatic repair" : "Approval required"}</small>
        </button>
        <button className="metric-card" onClick={() => onNavigate("constraints")}>
          <span className="eyebrow">ACTIVE PROCESS</span>
          <div className="metric-value process-value">{pdkLabel(constraints.pdk)}</div>
          <small>{constraints.domains.join(" · ")}</small>
        </button>
      </div>

      <div className="workflow-strip" aria-label="Design workflow">
        {[
          {
            label: "1 · Constraints",
            detail: `${constraints.domains.length} domains · ${constraints.requiredChecks.length} gates`,
            state: "passed",
            action: () => onNavigate("constraints"),
          },
          {
            label: "2 · Agent assembly",
            detail: `Iteration ${iteration} of ${constraints.maxIterations}`,
            state: "passed",
            action: onOpenAssistant,
          },
          {
            label: "3 · Verification",
            detail: failed > 0 ? `${failed} failed · ${unsupported} unsupported` : "All supported checks green",
            state: failed > 0 ? "failed" : "passed",
            action: () => onNavigate("verification"),
          },
          {
            label: "4 · Review & export",
            detail: "Sources, reports and evidence",
            state: "ready",
            action: () => onNavigate("export"),
          },
        ].map((step) => (
          <button className={`workflow-step ${step.state}`} key={step.label} onClick={step.action}>
            <span className="workflow-index">
              {step.state === "failed" ? <Icon name="warning" size={13} /> : <Icon name="check" size={13} />}
            </span>
            <span>
              <b>{step.label}</b>
              <small>{step.detail}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DOMAINS</span>
              <h2>Physical implementation</h2>
            </div>
            <button className="text-button" onClick={() => onNavigate("verification")}>
              All evidence
              <Icon name="chevronRight" size={12} />
            </button>
          </div>
          <div className="domain-list">
            {domainSummary.map(({ domain, scoped, scopedPassed, scopedFailed, scopedUnsupported }) => {
              const meta = domainMeta[domain];
              return (
                <div className="domain-row" key={domain}>
                  <span className={`domain-icon ${domain}`}>{meta.icon}</span>
                  <div className="domain-copy">
                    <b>{meta.label}</b>
                    <small>
                      {meta.detail} · {scopedPassed}/{scoped.length} checks pass
                      {scopedUnsupported > 0 ? ` · ${scopedUnsupported} unsupported` : ""}
                    </small>
                  </div>
                  <StatusPill status={scopedFailed ? "failed" : "passed"} />
                  <button className="text-button" onClick={() => onNavigate(meta.surface)}>
                    {meta.action}
                    <Icon name="chevronRight" size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="domain-footer">
            <span>
              <Icon name="file" size={12} />
              <button onClick={() => onOpenFile("design/digital/top.sv")}>design/digital/top.sv</button>
            </span>
            <span>
              <Icon name="file" size={12} />
              <button onClick={() => onOpenFile("design/schematic.yaml")}>design/schematic.yaml</button>
            </span>
            <span>
              <Icon name="file" size={12} />
              <button onClick={() => onOpenFile("design/photonic/mzi.py")}>design/photonic/mzi.py</button>
            </span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RECENT ACTIVITY</span>
              <h2>Agent and runner events</h2>
            </div>
            <span className="live-pill">
              <i />
              LIVE
            </span>
          </div>
          <div className="activity-feed">
            {activityFeed.map((item) => (
              <div className="feed-row" key={item.title}>
                <span className={`feed-icon ${item.status}`}>
                  {item.status === "failed" ? <Icon name="warning" size={13} /> : <Icon name="check" size={13} />}
                </span>
                <div>
                  <b>{item.title}</b>
                  <p>{item.detail}</p>
                  <small>{item.time}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="overview-grid overview-bottom">
        <section className="panel registry-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ENGINE TOOL REGISTRY</span>
              <h2>Every tool, one source of truth</h2>
            </div>
            <span className="registry-count">
              {availableTools}/{tools.length} available
            </span>
          </div>
          <div className="registry-grid">
            {tools.map((tool) => (
              <div className="registry-row" key={tool.id} title={tool.available ? tool.detail : tool.unavailableReason}>
                <span className={`registry-icon ${tool.available ? "" : "off"}`}>{tool.icon}</span>
                <span className="registry-copy">
                  <b>{tool.label}</b>
                  <small>{tool.available ? tool.detail : tool.unavailableReason}</small>
                </span>
                <span className={`registry-state ${tool.available ? "ready" : "off"}`}>
                  <span className="status-dot" />
                  {tool.available ? "READY" : "UNAVAILABLE"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel action-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">NEXT ACTIONS</span>
              <h2>What blocks signoff</h2>
            </div>
          </div>
          <div className="action-body">
            {failed > 0 ? (
              <div className="action-callout danger">
                <Icon name="warning" size={16} />
                <div>
                  <b>Static timing is failing</b>
                  <p>
                    OpenSTA reports −1.12 ns at 125 MHz. The agent has a proposed repair waiting for
                    approval.
                  </p>
                </div>
              </div>
            ) : (
              <div className="action-callout success">
                <Icon name="check" size={16} />
                <div>
                  <b>Supported checks are green</b>
                  <p>Review the unsupported checks before claiming fabrication readiness.</p>
                </div>
              </div>
            )}

            <div className="action-buttons">
              <button className="secondary-button" onClick={() => onNavigate("verification")}>
                Review timing evidence
              </button>
              <button className="primary-button" onClick={onOpenAssistant}>
                <Icon name="sparkles" size={13} />
                Ask the agent to repair
              </button>
            </div>

            {unsupported > 0 && (
              <div className="action-callout neutral">
                <Icon name="lock" size={15} />
                <div>
                  <b>{unsupported} checks are unsupported</b>
                  <p>
                    DRC/LVS and power need runner decks or reports. They are not treated as passes.
                  </p>
                </div>
              </div>
            )}

            <p className="stop-rule">
              <Icon name="clock" size={13} />
              Stop rule: at {constraints.maxIterations} repair iterations the agent halts and asks
              you what to do next.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
