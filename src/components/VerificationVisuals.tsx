import { formatNumber, type CheckRow, type Constraints, type Evidence, type FileEntry } from "../api";
import { gauge, moduleCoverage, splitSources, toolFor, trend, type Coverage } from "../verification";
import { useVerilogModules } from "./DiagramsView";
import { Icon, type IconName } from "./icons";

const shortName = (path: string) => path.split("/").pop() ?? path;

function FlowStep({ icon, title, lines, state }: { icon: IconName; title: string; lines: string[]; state?: "pass" | "fail" | "idle" }) {
  return (
    <div className={`verify-step ${state ?? ""}`}>
      <span className="verify-step-icon">
        <Icon name={icon} size={15} />
      </span>
      <b>{title}</b>
      {lines.slice(0, 3).map((line) => (
        <small key={line} title={line}>
          {line}
        </small>
      ))}
      {lines.length > 3 && <small>and {lines.length - 3} more</small>}
    </div>
  );
}

// How the latest verdict was reached, left to right. It's the same path every time: the agent isn't on it.
export function VerifyFlow({ constraints, latest }: { constraints: Constraints; latest?: Evidence }) {
  const sources = latest?.sources?.length ? latest.sources : (constraints.simulation?.sources ?? []);
  const { design, tests } = splitSources(sources);
  const operation = latest?.operation ?? constraints.simulation?.operation;
  const measurements = latest?.verdict.measurements ?? [];
  const status = latest?.verdict.status;
  const state = status === "PASS" ? "pass" : status === "FAIL" ? "fail" : "idle";
  const checks = constraints.checks ?? [];
  const steps = [
    { icon: "file", title: "Design", lines: design.map(shortName) },
    { icon: "code", title: "Testbench", lines: tests.length ? tests.map(shortName) : ["In the design files"] },
    { icon: "play", title: toolFor(operation), lines: [latest ? "Ran on this machine" : "Not run yet"] },
    { icon: "plot", title: "Measured", lines: measurements.length ? measurements.map((item) => `${item.name} ${formatNumber(item.value)}`) : [latest ? "Pass or fail from the bench" : "Nothing yet"] },
    { icon: "sliders", title: "Targets", lines: [`${checks.length} from constraints.yaml`, "The agent can't change them"] },
    { icon: state === "pass" ? "check" : state === "fail" ? "x" : "clock", title: status ? status.replace("_", " ") : "No verdict", lines: ["Set by the engine"], state },
  ] as const;
  return (
    <div className="panel verify-flow-panel">
      <div className="panel-heading">
        <span className="eyebrow">How this verdict was reached</span>
      </div>
      <div className="verify-flow">
        {steps.map((step, index) => (
          <div className="verify-flow-item" key={step.title}>
            {index > 0 && <Icon name="chevronRight" size={14} className="verify-arrow" />}
            <FlowStep icon={step.icon} title={step.title} lines={[...step.lines]} state={"state" in step ? step.state : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Each check as a bar: where the target is, which side passes, and where the measurement landed.
export function TargetGauges({ rows }: { rows: CheckRow[] }) {
  const measured = rows.filter((row) => typeof row.measurement?.value === "number");
  if (!measured.length) return null;
  return (
    <div className="panel">
      <div className="panel-heading">
        <span className="eyebrow">Measured against target</span>
        <small className="muted">The green side passes</small>
      </div>
      <div className="gauge-list">
        {measured.map((row) => {
          const value = row.measurement!.value as number;
          const bar = gauge(row.check, value);
          if (!bar) return null;
          const passed = row.status === "PASS";
          const unit = row.check.unit ?? "";
          return (
            <div className="gauge-row" key={row.check.id ?? row.check.metric}>
              <div className="gauge-text">
                <b>{row.check.title ?? row.check.metric}</b>
                <small className="mono">{row.check.metric}</small>
              </div>
              <div className="gauge-bar" role="img" aria-label={`${formatNumber(value)} ${unit}, target ${row.check.comparison} ${row.check.value} ${unit}`}>
                <span className={`gauge-zone ${bar.passAbove ? "above" : "below"}`} style={bar.passAbove ? { left: `${bar.targetAt}%`, right: 0 } : { left: 0, width: `${bar.targetAt}%` }} />
                <span className="gauge-target" style={{ left: `${bar.targetAt}%` }}>
                  <small>
                    {row.check.comparison} {row.check.value} {unit}
                  </small>
                </span>
                <span className={`gauge-value ${passed ? "pass" : "fail"}`} style={{ left: `${bar.valueAt}%` }}>
                  <small>
                    {formatNumber(value)} {unit}
                  </small>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sparkline({ metric, target, evidence, unit }: { metric: string; target: number; evidence: Evidence[]; unit?: string }) {
  const points = trend(metric, evidence);
  if (points.length < 2) return null;
  const [W, H, PAD] = [260, 74, 8];
  const values = [...points.map((point) => point.value), target];
  const [lo, hi] = [Math.min(...values), Math.max(...values)];
  const span = hi - lo || 1;
  const x = (index: number) => PAD + (index / (points.length - 1)) * (W - PAD * 2);
  const y = (value: number) => H - PAD - ((value - lo) / span) * (H - PAD * 2);
  const last = points[points.length - 1];
  return (
    <div className="trend-card">
      <div className="trend-head">
        <span className="mono">{metric}</span>
        <b className={last.passed ? "pass" : "fail"}>
          {formatNumber(last.value)} {unit}
        </b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric} over ${points.length} runs`}>
        <line className="trend-target" x1={PAD} x2={W - PAD} y1={y(target)} y2={y(target)} />
        <polyline className="trend-line" points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} />
        {points.map((point, index) => (
          <circle key={`${point.time}-${index}`} className={point.passed ? "pass" : "fail"} cx={x(index)} cy={y(point.value)} r={3.5}>
            <title>{`${formatNumber(point.value)} ${unit ?? ""} at ${point.revision}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// How each number moved across runs, which is how a repair shows up.
export function TrendCharts({ constraints, evidence }: { constraints: Constraints; evidence: Evidence[] }) {
  const checks = (constraints.checks ?? []).filter((check) => trend(check.metric, evidence).length > 1);
  if (!checks.length) return null;
  return (
    <div className="panel">
      <div className="panel-heading">
        <span className="eyebrow">Across runs</span>
        <small className="muted">Oldest on the left. The dashed line is the target</small>
      </div>
      <div className="trend-grid">
        {checks.map((check) => (
          <Sparkline key={check.metric} metric={check.metric} target={check.value} evidence={evidence} unit={check.unit} />
        ))}
      </div>
    </div>
  );
}

const COVERAGE_LABEL: Record<Coverage, string> = { passed: "Passed at this revision", failed: "Failed", stale: "Passed earlier, needs a rerun", testbench: "Has a testbench, not run here", none: "No test found" };

// Which blocks have actually been simulated. Click one to ask for what's missing.
export function CoverageMap({ entries, evidence, revision, onAsk }: { entries: FileEntry[]; evidence: Evidence[]; revision: string; onAsk: (text: string) => void }) {
  const modules = useVerilogModules(entries);
  if (!modules.length) return null;
  const coverage = moduleCoverage(modules, entries, evidence, revision);
  const counts = (state: Coverage) => coverage.filter((item) => item.state === state).length;
  return (
    <div className="panel">
      <div className="panel-heading">
        <span className="eyebrow">What's been tested</span>
        <small className="muted">
          {counts("passed")} of {coverage.length} blocks passed in a run at this revision
        </small>
      </div>
      <div className="coverage-legend">
        {(Object.keys(COVERAGE_LABEL) as Coverage[])
          .filter((state) => counts(state))
          .map((state) => (
            <span key={state}>
              <i className={`coverage-swatch ${state}`} />
              {COVERAGE_LABEL[state]} ({counts(state)})
            </span>
          ))}
      </div>
      <div className="coverage-grid">
        {coverage.map((item) => (
          <button
            key={`${item.file}-${item.module}`}
            className={`coverage-tile ${item.state}`}
            title={`${item.module}: ${COVERAGE_LABEL[item.state]}. Click to ask the assistant about testing it.`}
            onClick={() =>
              onAsk(
                item.testbench
                  ? `Run the testbench ${item.testbench} for ${item.module} (${item.file}) with the engine and report the verdict.`
                  : `Write a self-checking testbench for ${item.module} (${item.file}) and run it with the engine.`,
              )
            }
          >
            {item.module}
          </button>
        ))}
      </div>
    </div>
  );
}
