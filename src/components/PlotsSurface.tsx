import { useState } from "react";
import type { Check } from "../types";
import { spectrum, waveformSignals } from "../data";
import { Icon } from "./icons";
import { DomainTag, StatusPill, SurfaceHeader } from "./ui";

type PlotTab = "timing" | "spectrum" | "metrics";

const signalColors = ["#6fb2ff", "#58d39a", "#e0ad5f", "#c8a2ff"];

function squarePath(bits: number[], x0: number, step: number, high: number, low: number) {
  const level = (bit: number) => (bit ? high : low);
  let path = `M ${x0} ${level(bits[0])}`;
  bits.forEach((bit, index) => {
    const nextX = x0 + (index + 1) * step;
    path += ` L ${nextX} ${level(bit)}`;
    const next = bits[index + 1];
    if (next !== undefined) path += ` L ${nextX} ${level(next)}`;
  });
  return path;
}

function TimingPlot({ timing }: { timing?: Check }) {
  const left = 100;
  const top = 56;
  const width = 710;
  const step = width / 32;

  return (
    <div className="plot-stack">
      <div className="plot-stats">
        <div className="plot-stat">
          <span className="eyebrow">STATUS</span>
          <StatusPill status={timing?.status ?? "unsupported"} />
        </div>
        <div className="plot-stat">
          <span className="eyebrow">MEASURED</span>
          <b className={timing?.status}>{timing?.measured ?? "No run"}</b>
        </div>
        <div className="plot-stat">
          <span className="eyebrow">TARGET</span>
          <b>{timing?.target ?? "—"}</b>
        </div>
        <div className="plot-stat">
          <span className="eyebrow">EVIDENCE</span>
          <b>{timing?.artifact ?? "—"}</b>
        </div>
      </div>

      <div className="chart-frame">
        <svg viewBox="0 0 860 360" role="img" aria-label="RTL simulation waveforms">
          <rect width="860" height="360" fill="#0b121a" />
          {Array.from({ length: 9 }, (_, index) => {
            const x = left + index * 4 * step;
            return (
              <g key={index}>
                <line x1={x} y1={28} x2={x} y2={320} stroke="#1c2b3a" strokeWidth=".7" />
                <text className="chart-axis" x={x} y={340} textAnchor="middle">
                  {index} ns
                </text>
              </g>
            );
          })}

          {waveformSignals.map((signal, index) => {
            const rowTop = top + index * 66;
            return (
              <g key={signal.name}>
                <text className="chart-signal" x={left - 14} y={rowTop + 18} textAnchor="end">
                  {signal.name}
                </text>
                <line
                  x1={left}
                  y1={rowTop + 30}
                  x2={left + width}
                  y2={rowTop + 30}
                  stroke="#172533"
                  strokeWidth=".8"
                />
                <path
                  d={squarePath(signal.bits, left, step, rowTop + 2, rowTop + 28)}
                  fill="none"
                  stroke={signalColors[index]}
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          <line x1={left} y1={318} x2={left + width} y2={318} stroke="#33465a" />
          <text className="chart-caption" x={left} y={22}>
            tb_top · 0–8 ns simulation window · 125 MHz clock target
          </text>
        </svg>
      </div>
      <p className="plot-footnote">
        Source: results/verilator.log · Verilator 5.028 · 128/128 tests. Waveforms are stored evidence,
        not a live simulation stream.
      </p>
    </div>
  );
}

function SpectrumPlot({ checks }: { checks: Check[] }) {
  const left = 64;
  const top = 28;
  const width = 740;
  const height = 270;
  const minWavelength = 1540;
  const maxWavelength = 1560;
  const minDb = -22;

  const x = (wavelength: number) =>
    left + ((wavelength - minWavelength) / (maxWavelength - minWavelength)) * width;
  const y = (transmission: number) => {
    const db = 10 * Math.log10(Math.max(transmission, 0.0001));
    return top + ((0 - db) / (0 - minDb)) * height;
  };

  const points = spectrum
    .map((sample) => `${x(sample.wavelength)},${y(sample.transmission)}`)
    .join(" ");
  const insertion = checks.find((check) => check.id === "mzi-insertion-loss");
  const extinction = checks.find((check) => check.id === "mzi-extinction");

  return (
    <div className="plot-stack">
      <div className="plot-stats">
        <div className="plot-stat">
          <span className="eyebrow">INSERTION LOSS</span>
          <b className={insertion?.status}>{insertion?.measured}</b>
          <small>target {insertion?.target.replace("Insertion loss ", "")}</small>
        </div>
        <div className="plot-stat">
          <span className="eyebrow">EXTINCTION RATIO</span>
          <b className={extinction?.status}>{extinction?.measured}</b>
          <small>target {extinction?.target.replace("Extinction ratio ", "")}</small>
        </div>
        <div className="plot-stat">
          <span className="eyebrow">OPERATING POINT</span>
          <b>1550.0 nm</b>
          <small>C-band target window</small>
        </div>
        <div className="plot-stat">
          <span className="eyebrow">SIMULATOR</span>
          <b>SAX · cspdk</b>
          <small>compact models</small>
        </div>
      </div>

      <div className="chart-frame">
        <svg viewBox="0 0 860 360" role="img" aria-label="MZI optical transmission spectrum">
          <defs>
            <linearGradient id="spectrum-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#58d39a" stopOpacity=".22" />
              <stop offset="100%" stopColor="#58d39a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width="860" height="360" fill="#0b121a" />

          <rect
            x={x(1549)}
            y={top}
            width={x(1551) - x(1549)}
            height={height}
            fill="#58d39a"
            opacity=".06"
          />

          {Array.from({ length: 11 }, (_, index) => {
            const wavelength = minWavelength + index * 2;
            return (
              <g key={wavelength}>
                <line x1={x(wavelength)} y1={top} x2={x(wavelength)} y2={top + height} stroke="#1c2b3a" strokeWidth=".6" />
                <text className="chart-axis" x={x(wavelength)} y={top + height + 22} textAnchor="middle">
                  {wavelength}
                </text>
              </g>
            );
          })}

          {Array.from({ length: 5 }, (_, index) => {
            const db = -index * 5;
            const yPos = y(Math.pow(10, db / 10));
            return (
              <g key={db}>
                <line x1={left} y1={yPos} x2={left + width} y2={yPos} stroke="#1c2b3a" strokeWidth=".6" />
                <text className="chart-axis" x={left - 10} y={yPos + 3} textAnchor="end">
                  {db} dB
                </text>
              </g>
            );
          })}

          <polygon
            points={`${x(1540)},${top + height} ${points} ${x(1560)},${top + height}`}
            fill="url(#spectrum-fill)"
          />
          <polyline points={points} fill="none" stroke="#58d39a" strokeWidth="2" />

          <line
            x1={left}
            y1={y(0.631)}
            x2={left + width}
            y2={y(0.631)}
            stroke="#e0ad5f"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <text className="chart-caption" x={left + width - 4} y={y(0.631) - 6} textAnchor="end">
            IL target −2 dB
          </text>

          <circle cx={x(1550)} cy={y(0.0138)} r="4" fill="#58d39a" stroke="#0b121a" strokeWidth="2" />
          <text className="chart-caption" x={x(1550) + 10} y={y(0.0138) - 8}>
            notch · 18.6 dB extinction
          </text>
          <text className="chart-caption" x={left} y={22}>
            MZI transmission · 1540–1560 nm
          </text>
          <text className="chart-axis" x={left + width / 2} y={top + height + 42} textAnchor="middle">
            wavelength (nm)
          </text>
        </svg>
      </div>
      <p className="plot-footnote">
        Source: results/mzi_spectrum.csv · SAX with CORNERSTONE cspdk compact models · revision 8f3c1a2.
      </p>
    </div>
  );
}

function MetricsTable({ checks }: { checks: Check[] }) {
  const metrics = checks.filter(
    (check) => check.domain === "analog" || check.domain === "photonic",
  );

  return (
    <div className="plot-stack">
      <div className="metrics-table">
        <div className="metrics-table-head">
          <span>Metric</span>
          <span>Domain</span>
          <span>Target</span>
          <span>Measured</span>
          <span>Status</span>
        </div>
        {metrics.map((check) => (
          <div className="metrics-table-row" key={check.id}>
            <span>
              <b>{check.name}</b>
              <small>{check.tool}</small>
            </span>
            <span>
              <DomainTag domain={check.domain} />
            </span>
            <span>{check.target}</span>
            <span className={check.status}>{check.measured}</span>
            <span>
              <StatusPill status={check.status} />
            </span>
          </div>
        ))}
      </div>
      <div className="plot-note-grid">
        <div className="action-callout success">
          <Icon name="check" size={15} />
          <div>
            <b>Analog and photonic targets pass</b>
            <p>
              Measured values come from ngspice AC analysis and SAX spectrum simulation. They are
              specific to the declared PDK, models and conditions.
            </p>
          </div>
        </div>
        <div className="action-callout neutral">
          <Icon name="lock" size={15} />
          <div>
            <b>Not tapeout signoff</b>
            <p>
              These metrics are partial demonstrations. Optical DRC, thermal analysis and corner
              sweeps are outside the current flow.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PlotsSurface({
  checks,
  onOpenFile,
}: {
  checks: Check[];
  onOpenFile: (path: string) => void;
}) {
  const [tab, setTab] = useState<PlotTab>("timing");
  const timing = checks.find((check) => check.id === "static-timing");
  const evidence =
    tab === "spectrum" ? "results/mzi_spectrum.csv" : "results/timing.rpt";

  return (
    <div className="page-surface plots-surface">
      <SurfaceHeader
        eyebrow="EVIDENCE / WAVEFORMS & SPECTRA"
        title="Plots"
        subtitle="Simulation results shown against their pass/fail targets. Charts are rendered from stored evidence."
        actions={
          <button className="secondary-button" onClick={() => onOpenFile(evidence)}>
            <Icon name="file" size={13} />
            Open evidence
          </button>
        }
      />

      <div className="plot-tabs" role="tablist" aria-label="Plot views">
        {(
          [
            ["timing", "Digital timing & waveforms"],
            ["spectrum", "Optical spectrum"],
            ["metrics", "Analog & photonic metrics"],
          ] as [PlotTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`plot-tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="panel plot-panel">
        {tab === "timing" && <TimingPlot timing={timing} />}
        {tab === "spectrum" && <SpectrumPlot checks={checks} />}
        {tab === "metrics" && <MetricsTable checks={checks} />}
      </section>
    </div>
  );
}
