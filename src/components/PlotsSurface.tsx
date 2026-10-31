import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import { MagnifyingGlassPlus, Hand, Selection, Crosshair, ArrowsOut, DownloadSimple, ImageSquare } from "@phosphor-icons/react";
import { downloadText } from "../utils";
import type { Check } from "../types";
import { spectrum, waveformSignals } from "../data";
import { Icon } from "./icons";
import { DomainTag, StatusPill, SurfaceHeader } from "./ui";

type PlotTab = "timing" | "spectrum" | "metrics";

const signalColors = ["#6fb2ff", "#10b981", "#e0ad5f", "#c8a2ff"];

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

type PlotMode = "zoom" | "pan" | "box" | "cursor";

function InteractivePlot({ kind, children }: { kind: "timing" | "spectrum"; children: ReactNode }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<PlotMode>("cursor");
  const [range, setRange] = useState({ x: 0, width: 860 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ clientX: number; x: number; origin: number } | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [exportStatus, setExportStatus] = useState("");
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: range.x + (event.clientX - rect.left) / rect.width * range.width, y: (event.clientY - rect.top) / rect.height * 360 };
  };
  const setWindow = (x: number, width: number) => {
    const nextWidth = Math.max(43, Math.min(860, width));
    setRange({ x: Math.max(0, Math.min(860 - nextWidth, x)), width: nextWidth });
  };
  const exportCsv = () => downloadText(`${kind}-preview.csv`, kind === "spectrum"
    ? "wavelength_nm,transmission,transmission_db\n" + spectrum.map((sample) => `${sample.wavelength},${sample.transmission},${10 * Math.log10(Math.max(sample.transmission, .0001))}`).join("\n")
    : "time_ns," + waveformSignals.map((signal) => signal.name).join(",") + "\n" + Array.from({ length: 32 }, (_, index) => `${index / 4},${waveformSignals.map((signal) => signal.bits[index] ?? "").join(",")}`).join("\n"));
  const exportPng = async () => {
    const source = svgRef.current;
    if (!source) return;
    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "1720"); clone.setAttribute("height", "720");
    clone.querySelectorAll("text").forEach((text) => { text.setAttribute("fill", "#b4b4be"); text.setAttribute("font-family", "monospace"); text.setAttribute("font-size", "10"); });
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    try {
      const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement("canvas"); canvas.width = 1720; canvas.height = 720;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
      context.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
      const png = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = png; link.download = `${kind}-preview.png`; link.click(); setTimeout(() => URL.revokeObjectURL(png), 1000);
      setExportStatus("PNG exported");
    } catch { setExportStatus("PNG export failed; try CSV"); }
    finally { URL.revokeObjectURL(url); }
  };
  const plotLeft = kind === "timing" ? 100 : 64;
  const plotWidth = kind === "timing" ? 710 : 740;
  const position = cursor ? Math.max(0, Math.min(1, (cursor.x - plotLeft) / plotWidth)) : 0;
  const sample = spectrum.reduce((best, item) => Math.abs(item.wavelength - (1540 + position * 20)) < Math.abs(best.wavelength - (1540 + position * 20)) ? item : best, spectrum[0]);
  const readout = !cursor ? "Hover to inspect · bundled preview" : kind === "timing"
    ? `t=${(position * 8).toFixed(3)} ns  ` + waveformSignals.map((signal) => `${signal.name}=${signal.bits[Math.min(31, Math.floor(position * 32))] ?? "—"}`).join("  ")
    : `λ=${sample.wavelength.toFixed(2)} nm  T=${sample.transmission.toFixed(4)}  ${(10 * Math.log10(Math.max(sample.transmission, .0001))).toFixed(2)} dB`;
  return <div className="interactive-plot">
    <div className="plot-modebar" role="toolbar" aria-label="Plot interactions">
      {([{ id: "zoom", label: "Zoom", glyph: MagnifyingGlassPlus }, { id: "pan", label: "Pan", glyph: Hand }, { id: "box", label: "Box Select", glyph: Selection }, { id: "cursor", label: "Crosshair Cursor", glyph: Crosshair }] as const).map(({ id, label, glyph: Glyph }) => <button key={id} className={mode === id ? "active" : ""} aria-pressed={mode === id} onClick={() => { setMode(id); setSelection(null); }} title={label}><Glyph size={14} />{label}</button>)}
      <button onClick={() => { setRange({ x: 0, width: 860 }); setSelection(null); }}><ArrowsOut size={14} />Autoscale</button>
      <button onClick={exportCsv}><DownloadSimple size={14} />CSV</button><button onClick={exportPng}><ImageSquare size={14} />PNG</button>
      <span className="plot-export-status" role="status">{exportStatus}</span>
    </div>
    <div className={`chart-frame plot-mode-${mode}`}>
      <svg ref={svgRef} viewBox={`${range.x} 0 ${range.width} 360`} preserveAspectRatio="none" role="img" aria-label={kind === "timing" ? "Interactive RTL preview waveforms" : "Interactive optical preview spectrum"}
        onWheel={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const ratio = (event.clientX - rect.left) / rect.width; const width = Math.max(43, Math.min(860, range.width * (event.deltaY > 0 ? 1.2 : .8))); setWindow(range.x + ratio * (range.width - width), width); }}
        onPointerDown={(event) => { if (event.button !== 0) return; const p = point(event); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ clientX: event.clientX, x: p.x, origin: range.x }); if (mode === "box") setSelection({ start: p.x, end: p.x }); if (mode === "zoom") setWindow(p.x - range.width / 4, range.width / 2); }}
        onPointerMove={(event) => { const p = point(event); setCursor(p); if (drag && mode === "pan") setWindow(drag.origin - (event.clientX - drag.clientX) / event.currentTarget.getBoundingClientRect().width * range.width, range.width); if (drag && mode === "box") setSelection({ start: drag.x, end: p.x }); }}
        onPointerUp={(event) => { if (mode === "box" && selection && Math.abs(selection.end - selection.start) > 5) setWindow(Math.min(selection.start, selection.end), Math.abs(selection.end - selection.start)); setDrag(null); setSelection(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { setDrag(null); setSelection(null); }} onPointerLeave={() => { if (!drag) setCursor(null); }}>
        {children}
        {cursor && <g className="plot-crosshair" pointerEvents="none"><line x1={cursor.x} x2={cursor.x} y1="0" y2="360" stroke="#7d7d8a" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /><line x1="0" x2="860" y1={cursor.y} y2={cursor.y} stroke="#52525d" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /></g>}
        {selection && <rect x={Math.min(selection.start, selection.end)} y="0" width={Math.abs(selection.end - selection.start)} height="360" fill="#3b82f6" fillOpacity=".12" stroke="#3b82f6" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
    <div className="plot-cursor-readout" aria-live="off">{readout}</div>
  </div>;
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

      <InteractivePlot kind="timing">
          <rect width="860" height="360" fill="#09090b" />
          {Array.from({ length: 9 }, (_, index) => {
            const x = left + index * 4 * step;
            return (
              <g key={index}>
                <line x1={x} y1={28} x2={x} y2={320} stroke="#232329" strokeWidth=".7" />
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
                  stroke="#232329"
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

          <line x1={left} y1={318} x2={left + width} y2={318} stroke="#32323b" />
          <text className="chart-caption" x={left} y={22}>
            tb_top · 0–8 ns simulation window · 125 MHz clock target
          </text>
      </InteractivePlot>
      <p className="plot-footnote">
        Bundled RTL preview traces · 0–8 ns. Check execution evidence in the verification workspace.
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

      <InteractivePlot kind="spectrum">
          <rect width="860" height="360" fill="#09090b" />

          <rect
            x={x(1549)}
            y={top}
            width={x(1551) - x(1549)}
            height={height}
            fill="#10b981"
            opacity=".06"
          />

          {Array.from({ length: 11 }, (_, index) => {
            const wavelength = minWavelength + index * 2;
            return (
              <g key={wavelength}>
                <line x1={x(wavelength)} y1={top} x2={x(wavelength)} y2={top + height} stroke="#232329" strokeWidth=".6" />
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
                <line x1={left} y1={yPos} x2={left + width} y2={yPos} stroke="#232329" strokeWidth=".6" />
                <text className="chart-axis" x={left - 10} y={yPos + 3} textAnchor="end">
                  {db} dB
                </text>
              </g>
            );
          })}

          <polyline points={points} fill="none" stroke="#10b981" strokeWidth="2" />

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

          <circle cx={x(1550)} cy={y(0.0138)} r="4" fill="#10b981" stroke="#09090b" strokeWidth="2" />
          <text className="chart-caption" x={x(1550) + 10} y={y(0.0138) - 8}>
            notch · 18.6 dB extinction
          </text>
          <text className="chart-caption" x={left} y={22}>
            MZI transmission · 1540–1560 nm
          </text>
          <text className="chart-axis" x={left + width / 2} y={top + height + 42} textAnchor="middle">
            wavelength (nm)
          </text>
      </InteractivePlot>
      <p className="plot-footnote">
        Bundled optical preview samples · 1540–1560 nm. Exported plots and CSV retain these preview values.
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
      <p className="plot-footnote">Metrics reflect supplied checks and declared models. Inspect each artifact for run conditions.</p>
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
