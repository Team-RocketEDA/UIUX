import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { formatNumber, timeAgo, type Constraints, type Evidence } from "../api";
import { bode, nearest, parseRawfile, unityGain, type BodePoint, type RawPlot } from "../plots/rawfile";
import { formatEng } from "../schematic/netlist";
import { Icon } from "./icons";
import { StatusPill, SurfaceHeader } from "./ui";

// Frequency response from the engine's own AC sweep (results/engine-runs/<run_id>-ac.raw). The engine
// keeps the data; this page only draws it. Gain and phase are two charts on one frequency axis.

const W = 860;
const PAD = { left: 56, right: 132, top: 14, bottom: 26 };
const MAG_H = 230;
const PHASE_H = 190;
const SERIES = ["#3987e5", "#d95926"]; // validated categorical slots 1-2, dark mode
const HZ: Record<string, number> = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };

type Series = { key: string; label: string; color: string; points: BodePoint[] };

// Axis range widened to whole steps, with a tick on every step; `steps` overrides the 1-2-5 choice (45° for phase).
function niceTicks(min: number, max: number, count: number, steps?: number[]) {
  const span = max - min || 1;
  const magnitude = 10 ** Math.floor(Math.log10(span / count));
  const choices = steps ?? [1, 2, 5, 10].map((m) => m * magnitude);
  const step = choices.find((s) => span / s <= count) ?? choices[choices.length - 1];
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + 1e-9; value += step) ticks.push(Number(value.toFixed(10)));
  return { ticks, lo, hi };
}

const cmp = (comparison: string) => ({ ">=": "≥", "<=": "≤" })[comparison] ?? comparison;

const runLabel = (run: Evidence) => `${new Date(run.finished_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${run.verdict.status}`;

export function PlotsView({
  evidence,
  constraints,
  running,
  readFile,
  onRunChecks,
}: {
  evidence: Evidence[];
  constraints: Constraints;
  running: boolean;
  readFile: (path: string) => Promise<string>;
  onRunChecks: () => void;
}) {
  const runs = useMemo(
    () => evidence.filter((run) => run.datasets?.some((d) => d.analysis === "ac")).sort((a, b) => b.finished_at.localeCompare(a.finished_at)),
    [evidence],
  );
  const [plots, setPlots] = useState<Record<string, RawPlot | string>>({});
  const [vector, setVector] = useState<string>();
  const [compareId, setCompareId] = useState<string>();
  const [hoverF, setHoverF] = useState<number>();

  const latest = runs[0];
  const compare = runs.find((run) => run.run_id === compareId && run !== latest);
  const pathOf = (run: Evidence) => run.datasets!.find((d) => d.analysis === "ac")!.path;

  useEffect(() => {
    for (const run of [latest, compare]) {
      if (!run || plots[run.run_id] !== undefined) continue;
      readFile(pathOf(run))
        .then((text) => setPlots((prev) => ({ ...prev, [run.run_id]: parseRawfile(text) })))
        .catch((err) => setPlots((prev) => ({ ...prev, [run.run_id]: err instanceof Error ? err.message : String(err) })));
    }
  }, [latest?.run_id, compare?.run_id]);

  const header = (
    <SurfaceHeader
      eyebrow={latest ? `Plots · AC sweep from the run ${timeAgo(latest.finished_at)}` : "Plots"}
      title="Frequency response"
      subtitle="Drawn from the engine's own ngspice sweep. Targets come from constraints.yaml; the verdict stays the engine's."
      actions={
        <button className="btn primary" onClick={onRunChecks} disabled={running}>
          <Icon name="play" size={13} />
          {running ? "Running…" : "Run checks"}
        </button>
      }
    />
  );

  if (!latest) {
    return (
      <div className="page-surface">
        {header}
        <div className="empty-state">
          <Icon name="plot" size={24} />
          <b>No sweep yet</b>
          <span>Run the checks (or let the assistant run them). The AC sweep behind the verdict appears here.</span>
        </div>
      </div>
    );
  }

  const plot = plots[latest.run_id];
  if (typeof plot === "string") return <div className="page-surface">{header}<div className="notice error">Could not read the sweep: {plot}</div></div>;
  if (!plot) return <div className="page-surface">{header}<div className="schematic-loading">Reading the sweep…</div></div>;

  // Nodes with an AC signal; supplies and bias lines are flat zero and have no Bode plot.
  const voltages = plot.variables
    .map((v, i) => ({ v, i }))
    .filter(({ v, i }) => v.type === "voltage" && plot.values[i].some(([re, im]) => Math.hypot(re, im) > 1e-12))
    .map(({ v }) => v.name);
  const active = vector && voltages.includes(vector) ? vector : voltages.includes("v(out)") ? "v(out)" : voltages[0];
  const comparePlot = compare ? plots[compare.run_id] : undefined;
  const series: Series[] = [
    { key: latest.run_id, label: `Latest (${runLabel(latest)})`, color: SERIES[0], points: bode(plot, active) },
    ...(compare && comparePlot && typeof comparePlot !== "string"
      ? [{ key: compare.run_id, label: `Earlier (${runLabel(compare)})`, color: SERIES[1], points: bode(comparePlot, active) }]
      : []),
  ];
  const main = series[0].points;
  if (!main.length) return <div className="page-surface">{header}<div className="notice warn">This sweep has no {active}.</div></div>;

  // Targets this chart can show: dB on the gain chart, frequencies on both, phase margin on the phase chart.
  const checks = constraints.checks ?? [];
  const gainTargets = checks.filter((c) => c.unit?.toLowerCase() === "db");
  const freqTargets = checks.filter((c) => HZ[c.unit?.toLowerCase() ?? ""] !== undefined);
  const pmTargets = checks.filter((c) => /phase_?margin|^pm$/i.test(c.metric) && /deg|°/i.test(c.unit ?? ""));

  const all = series.flatMap((s) => s.points);
  const fMin = Math.min(...all.map((p) => p.f));
  const fMax = Math.max(...all.map((p) => p.f));
  const lx = (f: number) => PAD.left + ((Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) * (W - PAD.left - PAD.right);
  const fAt = (x: number) => 10 ** (Math.log10(fMin) + ((x - PAD.left) / (W - PAD.left - PAD.right)) * (Math.log10(fMax) - Math.log10(fMin)));
  const decades: number[] = [];
  for (let d = Math.ceil(Math.log10(fMin)); d <= Math.floor(Math.log10(fMax)); d += 1) decades.push(10 ** d);

  const mag = niceTicks(Math.min(...all.map((p) => p.db), ...gainTargets.map((c) => c.value), 0), Math.max(...all.map((p) => p.db), ...gainTargets.map((c) => c.value)), 6);
  const ph = niceTicks(Math.min(...all.map((p) => p.phase), -180, ...pmTargets.map((c) => c.value - 180)), Math.max(...all.map((p) => p.phase)), 5, [45, 90, 180]);
  const y = (value: number, scale: { lo: number; hi: number }, height: number) =>
    PAD.top + (1 - (value - scale.lo) / (scale.hi - scale.lo)) * (height - PAD.top - PAD.bottom);
  const path = (points: BodePoint[], pick: (p: BodePoint) => number, scale: { lo: number; hi: number }, height: number) =>
    points.map((p, i) => `${i ? "L" : "M"}${lx(p.f).toFixed(1)},${y(pick(p), scale, height).toFixed(1)}`).join("");

  const ugbw = unityGain(main);
  const hover = hoverF === undefined ? undefined : series.map((s) => ({ s, p: nearest(s.points, hoverF)! }));

  const onMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    setHoverF(x < PAD.left || x > W - PAD.right ? undefined : fAt(x));
  };

  const chart = (kind: "gain" | "phase") => {
    const height = kind === "gain" ? MAG_H : PHASE_H;
    const scale = kind === "gain" ? mag : ph;
    const pick = kind === "gain" ? (p: BodePoint) => p.db : (p: BodePoint) => p.phase;
    const unit = kind === "gain" ? "dB" : "°";
    const right = W - PAD.right;
    return (
      <svg viewBox={`0 0 ${W} ${height}`} className="plot" role="img" aria-label={`${kind === "gain" ? "Gain" : "Phase"} of ${active} against frequency`}>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={right} y1={y(t, scale, height)} y2={y(t, scale, height)} className="grid" />
            <text x={PAD.left - 8} y={y(t, scale, height) + 3.5} className="axis-label" textAnchor="end">{t}{unit}</text>
          </g>
        ))}
        {decades.map((f) => (
          <g key={f}>
            <line x1={lx(f)} x2={lx(f)} y1={PAD.top} y2={height - PAD.bottom} className="grid" />
            {kind === "phase" && <text x={lx(f)} y={height - 8} className="axis-label" textAnchor="middle">{formatEng(f, "Hz")}</text>}
          </g>
        ))}
        {kind === "gain" && <line x1={PAD.left} x2={right} y1={y(0, scale, height)} y2={y(0, scale, height)} className="zero" />}
        {kind === "phase" && <line x1={PAD.left} x2={right} y1={y(-180, scale, height)} y2={y(-180, scale, height)} className="zero" />}

        {/* targets */}
        {kind === "gain" && gainTargets.map((c) => (
          <g key={c.metric} className="target">
            <line x1={PAD.left} x2={right} y1={y(c.value, scale, height)} y2={y(c.value, scale, height)} />
            <text x={right + 6} y={y(c.value, scale, height) + 3.5}>{cmp(c.comparison)} {c.value} dB</text>
            <text x={right + 6} y={y(c.value, scale, height) + 16} className="target-name">{c.metric}</text>
          </g>
        ))}
        {kind === "phase" && pmTargets.map((c) => (
          <g key={c.metric} className="target">
            <line x1={PAD.left} x2={right} y1={y(c.value - 180, scale, height)} y2={y(c.value - 180, scale, height)} />
            <text x={right + 6} y={y(c.value - 180, scale, height) + 3.5}>PM {cmp(c.comparison)} {c.value}°</text>
            <text x={right + 6} y={y(c.value - 180, scale, height) + 16} className="target-name">{c.metric}</text>
          </g>
        ))}
        {freqTargets.map((c) => {
          const f = c.value * HZ[c.unit!.toLowerCase()];
          if (f < fMin || f > fMax) return null;
          return (
            <g key={c.metric} className="target">
              <line x1={lx(f)} x2={lx(f)} y1={PAD.top} y2={height - PAD.bottom} />
              {kind === "gain" && <text x={lx(f) - 4} y={height - PAD.bottom - 6} textAnchor="end">{c.metric} {cmp(c.comparison)} {c.value} {c.unit}</text>}
            </g>
          );
        })}

        {/* the latest run is drawn last, on top */}
        {[...series].reverse().map((s) => (
          <path key={s.key} d={path(s.points, pick, scale, height)} className="trace" style={{ stroke: s.color }} />
        ))}

        {/* readings from the latest sweep */}
        {kind === "gain" && (
          <g className="reading">
            <circle cx={lx(main[0].f)} cy={y(main[0].db, scale, height)} r={4} style={{ fill: SERIES[0] }} />
            <text x={lx(main[0].f) + 8} y={y(main[0].db, scale, height) - 8}>{formatNumber(main[0].db)} dB</text>
            {ugbw && (
              <>
                <circle cx={lx(ugbw.f)} cy={y(0, scale, height)} r={4} style={{ fill: SERIES[0] }} />
                <text x={lx(ugbw.f) + 8} y={y(0, scale, height) - 8}>0 dB at {formatEng(ugbw.f, "Hz")}</text>
              </>
            )}
          </g>
        )}
        {kind === "phase" && ugbw && (
          <g className="reading">
            <line x1={lx(ugbw.f)} x2={lx(ugbw.f)} y1={y(ugbw.phase, scale, height)} y2={y(-180, scale, height)} className="pm-span" />
            <circle cx={lx(ugbw.f)} cy={y(ugbw.phase, scale, height)} r={4} style={{ fill: SERIES[0] }} />
            <text x={lx(ugbw.f) - 8} y={(y(ugbw.phase, scale, height) + y(-180, scale, height)) / 2 + 4} textAnchor="end">PM {formatNumber(180 + ugbw.phase)}°</text>
          </g>
        )}

        {hover && (
          <g className="crosshair">
            <line x1={lx(hover[0].p.f)} x2={lx(hover[0].p.f)} y1={PAD.top} y2={height - PAD.bottom} />
            {hover.map(({ s, p }) => (
              <circle key={s.key} cx={lx(p.f)} cy={y(pick(p), scale, height)} r={4} style={{ fill: s.color }} />
            ))}
          </g>
        )}
        <rect x={PAD.left} y={0} width={W - PAD.left - PAD.right} height={height} className="hit" onPointerMove={onMove} onPointerLeave={() => setHoverF(undefined)} />
      </svg>
    );
  };

  const measured = latest.verdict.measurements ?? [];
  return (
    <div className="page-surface plots-page">
      {header}
      <div className="schematic-pickers">
        {voltages.length > 1 && (
          <div className="segmented" aria-label="Signal">
            {voltages.map((name) => (
              <button key={name} className={name === active ? "active" : ""} onClick={() => setVector(name)}>{name}</button>
            ))}
          </div>
        )}
        {runs.length > 1 && (
          <div className="segmented" aria-label="Compare with an earlier run">
            <button className={!compare ? "active" : ""} onClick={() => setCompareId(undefined)}>Latest only</button>
            {runs.slice(1, 5).map((run) => (
              <button key={run.run_id} className={run.run_id === compare?.run_id ? "active" : ""} onClick={() => setCompareId(run.run_id)}>
                vs {runLabel(run)}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="panel plot-panel">
        <div className="plot-legend">
          {series.length > 1 ? (
            series.map((s) => (
              <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
            ))
          ) : (
            <span className="muted">{active} · run {latest.run_id.slice(0, 8)} · revision {latest.source_commit ?? "—"}{latest.source_dirty ? " (uncommitted changes)" : ""}</span>
          )}
          {hover && (
            <span className="plot-readout">
              {formatEng(hover[0].p.f, "Hz")}
              {hover.map(({ s, p }) => (
                <b key={s.key} style={{ borderColor: s.color }}>{formatNumber(p.db)} dB · {formatNumber(p.phase)}°</b>
              ))}
            </span>
          )}
        </div>
        <h4 className="plot-title">Gain</h4>
        {chart("gain")}
        <h4 className="plot-title">Phase</h4>
        {chart("phase")}
      </section>

      {measured.length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <span className="eyebrow">Engine verdict for this run</span>
            <StatusPill status={latest.verdict.status === "PASS" ? "passed" : latest.verdict.status === "FAIL" ? "failed" : "skipped"} label={latest.verdict.status} />
          </div>
          <div className="verdict-chips">
            {measured.map((m) => (
              <span key={m.name} className="verdict-chip">
                <span className="mono">{m.name}</span>
                <b>{formatNumber(m.value)} {m.unit}</b>
                <StatusPill status={m.status === "pass" ? "passed" : "failed"} label={m.status.toUpperCase()} />
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
