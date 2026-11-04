import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from "react";
import type { Proposal } from "../schematic/changes";
import { layoutCircuit, type Placed, type RailSymbol } from "../schematic/layout";
import { evaluate, formatEng, parseNetlist, showValue, spiceNumber, type Circuit, type Device, type Netlist } from "../schematic/netlist";
import { Icon } from "./icons";
import { SurfaceHeader } from "./ui";

// The schematic is drawn from the project's own netlists (what the engine simulates), laid out
// automatically. It is a view: edits happen in the netlist, by hand or by the assistant.

const NETLIST = /\.(cir|sp|spice|net|ckt)$/i;
type ViewBox = [number, number, number, number];

const UNITS: Partial<Record<Device["kind"], string>> = { cap: "F", res: "Ω", ind: "H" };

function sizeText(device: Device, params: Netlist["params"]) {
  if (device.kind === "nmos" || device.kind === "pmos") {
    const w = device.params.w;
    const l = device.params.l;
    return w && l ? `${showValue(w, params)} / ${showValue(l, params)}` : "";
  }
  if (device.value && UNITS[device.kind]) return showValue(device.value.split(/\s+/)[0], params, UNITS[device.kind]);
  if (device.value) return device.value;
  return device.model ?? "";
}

function Symbol({ placed }: { placed: Placed }) {
  const { device } = placed;
  const bulk = placed.pins.find((pin) => pin.name === "b");
  switch (device.kind) {
    case "nmos":
    case "pmos": {
      const p = device.kind === "pmos";
      return (
        <>
          <line x1={-28} y1={0} x2={p ? -12 : -6} y2={0} />
          {p && <circle cx={-9} cy={0} r={3} className="sym-bubble" />}
          <line x1={-6} y1={-14} x2={-6} y2={14} />
          <line x1={-1} y1={-17} x2={-1} y2={17} className="sym-bold" />
          <polyline points="-1,-11 12,-11 12,-30" />
          <polyline points="-1,11 12,11 12,30" />
          {p ? <polygon points="0,-11 7,-14.5 7,-7.5" className="sym-fill" /> : <polygon points="11,11 4,7.5 4,14.5" className="sym-fill" />}
          {bulk && !bulk.hidden && <line x1={-1} y1={0} x2={28} y2={0} />}
        </>
      );
    }
    case "cap":
      return (
        <>
          <line x1={0} y1={-30} x2={0} y2={-5} />
          <line x1={-13} y1={-5} x2={13} y2={-5} className="sym-bold" />
          <line x1={-13} y1={5} x2={13} y2={5} className="sym-bold" />
          <line x1={0} y1={5} x2={0} y2={30} />
        </>
      );
    case "res":
      return <polyline points="0,-30 0,-17 7,-13 -7,-6.5 7,0 -7,6.5 7,13 0,17 0,30" />;
    case "ind":
      return <path d="M0,-30 L0,-16 a4,4 0 0 1 0,8 a4,4 0 0 1 0,8 a4,4 0 0 1 0,8 a4,4 0 0 1 0,8 L0,30" />;
    case "vsrc":
    case "isrc":
      return (
        <>
          <line x1={0} y1={-30} x2={0} y2={-14} />
          <circle cx={0} cy={0} r={14} />
          <line x1={0} y1={14} x2={0} y2={30} />
          {device.kind === "vsrc" ? (
            <>
              <text x={0} y={-3} className="sym-sign">+</text>
              <text x={0} y={10} className="sym-sign">−</text>
            </>
          ) : (
            <>
              <line x1={0} y1={-8} x2={0} y2={6} />
              <polygon points="0,9 -4,3 4,3" className="sym-fill" />
            </>
          )}
        </>
      );
    case "diode":
      return (
        <>
          <line x1={0} y1={-30} x2={0} y2={-7} />
          <polygon points="-10,-7 10,-7 0,7" />
          <line x1={-10} y1={7} x2={10} y2={7} className="sym-bold" />
          <line x1={0} y1={7} x2={0} y2={30} />
        </>
      );
    default:
      return (
        <>
          <rect x={-placed.width / 2} y={-placed.height / 2} width={placed.width} height={placed.height} rx={6} className="sym-box" />
          <text x={0} y={4} className="sym-box-title">{device.model ?? device.name}</text>
          {placed.pins.map((pin) => {
            const dx = pin.x - placed.x;
            const dy = pin.y - placed.y;
            const inside = pin.side === "left" ? [dx + 6, dy + 3] : pin.side === "right" ? [dx - 6, dy + 3] : pin.side === "top" ? [dx, dy + 12] : [dx, dy - 6];
            const anchor = pin.side === "left" ? "start" : pin.side === "right" ? "end" : "middle";
            return (
              <text key={pin.name + pin.side} x={inside[0]} y={inside[1]} textAnchor={anchor} className="sym-pin-name">
                {pin.name}
              </text>
            );
          })}
        </>
      );
  }
}

function Rail({ rail }: { rail: RailSymbol }) {
  // Upward for pins on top or at the side; downward below a part.
  const down = rail.side === "bottom";
  const dir = down ? 1 : -1;
  const { x, y } = rail;
  if (rail.kind === "ground") {
    const base = y + dir * 10;
    return (
      <g className="rail">
        <line x1={x} y1={y} x2={x} y2={base} />
        <line x1={x - 9} y1={base} x2={x + 9} y2={base} />
        <line x1={x - 5.5} y1={base + dir * 4} x2={x + 5.5} y2={base + dir * 4} />
        <line x1={x - 2} y1={base + dir * 8} x2={x + 2} y2={base + dir * 8} />
      </g>
    );
  }
  const bar = y + dir * 10;
  return (
    <g className="rail">
      <line x1={x} y1={y} x2={x} y2={bar} />
      <line x1={x - 9} y1={bar} x2={x + 9} y2={bar} />
      <text x={x} y={bar + (down ? 11 : -4)} className="rail-label">{rail.net}</text>
    </g>
  );
}

export function SchematicView({
  paths,
  revision,
  readFile,
  onOpenFile,
  onAsk,
  proposal,
}: {
  paths: string[];
  revision: string; // changes whenever a project file does, so edits redraw the schematic
  readFile: (path: string) => Promise<string>;
  onOpenFile: (path: string) => void;
  onAsk: () => void;
  proposal?: Proposal;
}) {
  const netlists = useMemo(
    () => paths.filter((path) => NETLIST.test(path) && /^(design|tests|ip)\//.test(path)).sort((a, b) => Number(b.startsWith("design/")) - Number(a.startsWith("design/")) || a.localeCompare(b)),
    [paths],
  );
  // ?netlist=tests/tb.cir links straight to one file's schematic.
  const [path, setPath] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get("netlist") ?? undefined);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [circuitName, setCircuitName] = useState<string>();
  const [mode, setMode] = useState<"hierarchy" | "symbols">("hierarchy");
  // The sheets above the one shown, from the root down: double-clicking a block pushes, the breadcrumb pops.
  const [stack, setStack] = useState<{ file: string; circuit: string; via: string }[]>([]);
  const [selected, setSelected] = useState<string>();
  const [hot, setHot] = useState<string>();
  const [box, setBox] = useState<ViewBox>();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; box: ViewBox } | null>(null);

  const active = path && netlists.includes(path) ? path : netlists[0];

  // Every netlist, re-read on each revision: subckts in one file name the pins of instances in another.
  useEffect(() => {
    let cancelled = false;
    Promise.all(netlists.map(async (file) => [file, await readFile(file)] as const))
      .then((entries) => !cancelled && (setTexts(Object.fromEntries(entries)), setError(undefined)))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [netlists.join("|"), revision]);

  const netlist = useMemo(() => {
    if (!active || texts[active] === undefined) return undefined;
    const library = Object.entries(texts).filter(([file]) => file !== active).flatMap(([, text]) => parseNetlist(text).subckts);
    return parseNetlist(texts[active], library);
  }, [active, texts]);

  // Every subcircuit the project's netlists define, and the file that defines it.
  const definitions = useMemo(() => {
    const out = new Map<string, { circuit: Circuit; file: string }>();
    for (const [file, text] of Object.entries(texts)) {
      for (const c of parseNetlist(text).subckts) if (!out.has(c.name.toLowerCase())) out.set(c.name.toLowerCase(), { circuit: c, file });
    }
    return out;
  }, [texts]);

  const circuits: Circuit[] = netlist ? [...netlist.subckts, ...(netlist.top.devices.length ? [netlist.top] : [])].filter((c) => c.devices.length) : [];
  // Roots: the top level, and subcircuits nothing in this file instantiates.
  const instantiated = new Set(circuits.flatMap((c) => c.devices.filter((d) => d.kind === "subckt" && d.model).map((d) => d.model!.toLowerCase())));
  const roots = circuits.filter((c) => c === netlist?.top || !instantiated.has(c.name.toLowerCase()));
  const circuit = circuits.find((c) => c.name === circuitName) ?? roots[0] ?? circuits[0];
  const sheetOf = (device: Device) => (device.kind === "subckt" && device.model ? definitions.get(device.model.toLowerCase()) : undefined);

  const openSheet = (device: Device) => {
    const sheet = sheetOf(device);
    if (!sheet || !active || !circuit) return;
    setStack((previous) => [...previous, { file: active, circuit: circuit.name, via: device.name }]);
    setPath(sheet.file);
    setCircuitName(sheet.circuit.name);
  };
  const goUp = (index: number) => {
    const target = stack[index];
    setStack((previous) => previous.slice(0, index));
    setPath(target.file);
    setCircuitName(target.circuit);
  };
  const showFile = (file: string) => {
    setStack([]);
    setCircuitName(undefined);
    setPath(file);
  };
  const layout = useMemo(() => (circuit ? layoutCircuit(circuit) : undefined), [circuit]);
  const fit: ViewBox | undefined = layout && [0, 0, layout.width, layout.height];

  // A new circuit or file starts fitted and unselected.
  useEffect(() => {
    setBox(undefined);
    setSelected(undefined);
  }, [active, circuit?.name]);

  const view = box ?? fit;
  const device = layout?.devices.find((placed) => placed.device.name === selected);
  const selectedNets = new Set(device?.pins.filter((pin) => !pin.hidden).map((pin) => pin.net));
  const isHot = (net: string) => net === hot || selectedNets.has(net);
  // Parts the assistant's pending change would touch, with their sizes after it.
  const pending = proposal && proposal.file === active ? proposal.changes : [];
  const proposed = new Map(
    pending.flatMap((change) => (change.kind === "device" && change.circuit === circuit?.name ? [[change.device, change.fields] as const] : [])),
  );
  const proposedText = (name: string) => {
    const fields = proposed.get(name);
    const w = fields?.find((f) => f.name === "W")?.after;
    const l = fields?.find((f) => f.name === "L")?.after;
    const value = fields?.find((f) => f.name === "value")?.after;
    return w || l ? `→ ${(w ?? "").replace(/m$/, "") || "·"} / ${(l ?? "").replace(/m$/, "") || "·"}` : value ? `→ ${value}` : fields ? "→ changed" : "";
  };

  const zoom = (factor: number, cx?: number, cy?: number) => {
    if (!view) return;
    const [x, y, w, h] = view;
    const px = cx ?? x + w / 2;
    const py = cy ?? y + h / 2;
    const nw = Math.min(Math.max(w * factor, 80), (fit?.[2] ?? w) * 4);
    const scale = nw / w;
    setBox([px - (px - x) * scale, py - (py - y) * scale, nw, h * scale]);
  };

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    if (!view || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.max(view[2] / rect.width, view[3] / rect.height);
    const cx = view[0] + (event.clientX - rect.left - (rect.width - view[2] / scale) / 2) * scale;
    const cy = view[1] + (event.clientY - rect.top - (rect.height - view[3] / scale) / 2) * scale;
    zoom(event.deltaY > 0 ? 1.12 : 1 / 1.12, cx, cy);
  };
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!view || (event.target as Element).closest(".device")) return;
    drag.current = { x: event.clientX, y: event.clientY, box: view };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const [x, y, w, h] = drag.current.box;
    const scale = Math.max(w / rect.width, h / rect.height);
    setBox([x - (event.clientX - drag.current.x) * scale, y - (event.clientY - drag.current.y) * scale, w, h]);
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current && Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y) < 3) setSelected(undefined);
    drag.current = null;
  };

  const symbolCount = useMemo(() => collectSymbols(texts, definitions).length, [texts, definitions]);

  const header = (
    <SurfaceHeader
      eyebrow={active ? `Schematic · ${active}` : "Schematic"}
      title={mode === "symbols" ? "Symbols" : circuit ? circuit.name : "Schematic"}
      subtitle="Drawn from the project's netlists at this revision: double-click a SHEET block to descend into it. Edit the netlist (or ask the assistant) to change it."
      actions={
        active && (
          <>
            <div className="segmented" role="tablist" aria-label="Schematic view">
              <button className={mode === "hierarchy" ? "active" : ""} onClick={() => setMode("hierarchy")}>
                <Icon name="schematic" size={13} />
                Hierarchy
              </button>
              <button className={mode === "symbols" ? "active" : ""} onClick={() => setMode("symbols")}>
                <Icon name="layers" size={13} />
                Symbols ({symbolCount})
              </button>
            </div>
            <button className="btn" onClick={() => onOpenFile(active)}>
              <Icon name="code" size={13} />
              Open netlist
            </button>
          </>
        )
      }
    />
  );

  if (!netlists.length) {
    return (
      <div className="page-surface">
        {header}
        <div className="empty-state">
          <Icon name="schematic" size={24} />
          <b>No netlist yet</b>
          <span>A schematic appears here once design/ has a SPICE netlist (.cir, .sp or .spice). For Verilog, see the block diagram under Diagrams.</span>
          <button className="btn primary" onClick={onAsk}>
            <Icon name="sparkles" size={13} />
            Ask the assistant to design one
          </button>
        </div>
      </div>
    );
  }

  let body: ReactNode;
  if (error) body = <div className="notice error">Could not read the netlist: {error}</div>;
  else if (!netlist) body = <div className="schematic-loading">Reading {active}…</div>;
  else if (!circuit || !layout || !view) body = <div className="notice warn">{active} has no devices to draw.</div>;
  else {
    body = (
      <div className="schematic-body">
        <div className="schematic-canvas">
          {proposed.size > 0 && (
            <div className="schematic-proposal">
              <Icon name="warning" size={13} />
              Pending change from the assistant:{" "}
              {pending.filter((c) => c.kind === "param").map((c) => c.kind === "param" && `${c.name} ${c.before} → ${c.after}`).join(", ") ||
                `${proposed.size} part${proposed.size > 1 ? "s" : ""}`}
              . Approve or reject it in the assistant panel.
            </div>
          )}
          <div className="schematic-tools">
            <button className="ghost-icon" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in"><Icon name="zoomIn" size={15} /></button>
            <button className="ghost-icon" onClick={() => zoom(1.25)} aria-label="Zoom out"><Icon name="zoomOut" size={15} /></button>
            <button className="ghost-icon" onClick={() => setBox(undefined)} aria-label="Fit"><Icon name="fit" size={15} /></button>
          </div>
          <svg
            ref={svgRef}
            viewBox={view.join(" ")}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            role="img"
            aria-label={`Schematic of ${circuit.name}`}
          >
            <g className="wires">
              {layout.segments.map((s, i) => (
                <g key={i} className={`wire ${isHot(s.net) ? "hot" : ""}`} onPointerEnter={() => setHot(s.net)} onPointerLeave={() => setHot(undefined)}>
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="wire-hit" />
                  <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                </g>
              ))}
              {layout.junctions.map((j, i) => (
                <circle key={i} cx={j.x} cy={j.y} r={3} className={`junction ${isHot(j.net) ? "hot" : ""}`} />
              ))}
            </g>
            {layout.rails.map((rail, i) => <Rail key={i} rail={rail} />)}
            {layout.labels.map((label, i) => (
              <text key={i} x={label.x} y={label.y} textAnchor={label.anchor} className={`net-label ${label.port ? "port" : ""} ${isHot(label.net) ? "hot" : ""}`}
                onPointerEnter={() => setHot(label.net)} onPointerLeave={() => setHot(undefined)}>
                {label.net}
              </text>
            ))}
            {layout.devices.map((placed) => (
              <g
                key={placed.device.name}
                className={`device ${placed.device.name === selected ? "selected" : ""} ${proposed.has(placed.device.name) ? "proposed" : ""}`}
                transform={`translate(${placed.x} ${placed.y})`}
                onClick={() => setSelected(placed.device.name)}
                onDoubleClick={() => openSheet(placed.device)}
              >
                <rect x={-placed.width / 2 - 6} y={-placed.height / 2} width={placed.width + 12} height={placed.height} className="device-hit" />
                <g className="sym"><Symbol placed={placed} /></g>
                <text x={sheetOf(placed.device) ? -placed.width / 2 : placed.device.kind === "subckt" || placed.device.kind === "other" ? 0 : 20}
                  y={placed.device.kind === "subckt" || placed.device.kind === "other" ? -placed.height / 2 - 8 : -6}
                  textAnchor={sheetOf(placed.device) ? "start" : placed.device.kind === "subckt" || placed.device.kind === "other" ? "middle" : "start"} className="device-name">
                  {placed.device.name}
                </text>
                {placed.device.kind !== "subckt" && placed.device.kind !== "other" && (
                  <text x={20} y={8} className="device-size">{sizeText(placed.device, netlist.params)}</text>
                )}
                {sheetOf(placed.device) && (
                  <text x={placed.width / 2} y={-placed.height / 2 - 8} textAnchor="end" className="sheet-tag">SHEET ↘</text>
                )}
                {proposed.has(placed.device.name) && (
                  <text x={20} y={21} className="device-proposed">{proposedText(placed.device.name)}</text>
                )}
              </g>
            ))}
          </svg>
          <div className="schematic-hint">
            {hot ? `Net ${hot}` : `Scroll to zoom · drag to pan · hover a wire to trace its net · click a part${layout.devices.some((d) => sheetOf(d.device)) ? " · double-click a SHEET to open it" : ""}`}
          </div>
        </div>
        <Inspector netlist={netlist} circuit={circuit} placed={device} path={active!} onOpenFile={onOpenFile} onHot={setHot}
          onOpenSheet={device && sheetOf(device.device) ? () => openSheet(device.device) : undefined} />
      </div>
    );
  }

  return (
    <div className="fill-surface schematic-page">
      {header}
      <div className="schematic-pickers">
        {mode === "hierarchy" && (
          <nav className="breadcrumb" aria-label="Hierarchy">
            {stack.map((item, index) => (
              <span key={index}>
                <button onClick={() => goUp(index)}>{index === 0 ? item.circuit === "(top level)" ? item.file.split("/").pop() : item.circuit : item.circuit}</button>
                <Icon name="chevronRight" size={12} />
                <span className="crumb-via mono">{item.via}</span>
              </span>
            ))}
            <b>{circuit ? (circuit.name === "(top level)" ? active?.split("/").pop() : circuit.name) : ""}</b>
            {stack.length > 0 && <span className="muted">{active}</span>}
          </nav>
        )}
        <div className="head-spacer" />
        {mode === "hierarchy" && roots.length > 1 && stack.length === 0 && (
          <div className="segmented" role="tablist" aria-label="Circuit">
            {roots.map((c) => (
              <button key={c.name} className={c.name === circuit?.name ? "active" : ""} onClick={() => setCircuitName(c.name)}>{c.name}</button>
            ))}
          </div>
        )}
        {netlists.length > 1 && (
          <div className="segmented" role="tablist" aria-label="Netlist">
            {netlists.map((file) => (
              <button key={file} className={file === active ? "active" : ""} onClick={() => showFile(file)}>{file}</button>
            ))}
          </div>
        )}
      </div>
      {mode === "symbols" ? (
        <SymbolsView
          texts={texts}
          definitions={definitions}
          onShow={(file, circuitName, deviceName) => {
            setMode("hierarchy");
            setStack([]);
            setPath(file);
            setCircuitName(circuitName);
            window.setTimeout(() => setSelected(deviceName), 0);
          }}
        />
      ) : (
        body
      )}
    </div>
  );
}

function Inspector({
  netlist,
  circuit,
  placed,
  path,
  onOpenFile,
  onHot,
  onOpenSheet,
}: {
  netlist: Netlist;
  circuit: Circuit;
  placed?: Placed;
  path: string;
  onOpenFile: (path: string) => void;
  onHot: (net?: string) => void;
  onOpenSheet?: () => void;
}) {
  if (placed) {
    const { device } = placed;
    const kind = { nmos: "NMOS transistor", pmos: "PMOS transistor", cap: "Capacitor", res: "Resistor", ind: "Inductor", vsrc: "Voltage source", isrc: "Current source", diode: "Diode", subckt: "Subcircuit instance", other: "Device" }[device.kind];
    return (
      <aside className="schematic-inspector">
        <span className="eyebrow">{kind}</span>
        <h3>{device.name}</h3>
        <dl className="kv">
          {device.model && (
            <div className="kv-row">
              <dt>{device.kind === "subckt" ? "Subcircuit" : "Model"}</dt>
              <dd className="mono">{device.model}</dd>
            </div>
          )}
          {device.value && (
            <div className="kv-row">
              <dt>Value</dt>
              <dd>{UNITS[device.kind] ? showValue(device.value.split(/\s+/)[0], netlist.params, UNITS[device.kind]) : device.value}</dd>
            </div>
          )}
          {Object.entries(device.params).map(([key, raw]) => (
            <ParamRow key={key} name={key.toUpperCase()} raw={raw} netlist={netlist} unit={key === "w" || key === "l" ? "m" : ""} />
          ))}
        </dl>
        <span className="eyebrow">Connections</span>
        <dl className="kv">
          {device.pins.map((pin) => (
            <div key={pin.name} className="kv-row" onPointerEnter={() => onHot(pin.net)} onPointerLeave={() => onHot(undefined)}>
              <dt>{pin.name}</dt>
              <dd className="mono">{pin.net}</dd>
            </div>
          ))}
        </dl>
        <code className="netlist-line">{device.line}: {device.text}</code>
        {onOpenSheet && (
          <button className="btn primary" onClick={onOpenSheet}>
            <Icon name="schematic" size={13} />
            Open sheet {device.model}
          </button>
        )}
        <button className="btn" onClick={() => onOpenFile(path)}>
          <Icon name="code" size={13} />
          Open {path}
        </button>
      </aside>
    );
  }
  const params = Object.entries(netlist.params);
  const nets = [...new Set(circuit.devices.flatMap((device) => device.pins.map((pin) => pin.net)))].sort();
  return (
    <aside className="schematic-inspector">
      <span className="eyebrow">Circuit</span>
      <h3>{circuit.name}</h3>
      <p className="muted">
        {circuit.devices.length} parts · {nets.length} nets{circuit.ports.length ? ` · ports ${circuit.ports.join(", ")}` : ""}
      </p>
      {params.length > 0 && (
        <>
          <span className="eyebrow">Parameters</span>
          <dl className="kv">
            {params.map(([name, param]) => (
              <ParamRow key={name} name={name.toUpperCase()} raw={param.value} netlist={netlist} />
            ))}
          </dl>
        </>
      )}
      <span className="eyebrow">Nets</span>
      <div className="net-chips">
        {nets.map((net) => (
          <span key={net} className="net-chip" onPointerEnter={() => onHot(net)} onPointerLeave={() => onHot(undefined)}>{net}</span>
        ))}
      </div>
    </aside>
  );
}

function ParamRow({ name, raw, netlist, unit = "" }: { name: string; raw: string; netlist: Netlist; unit?: string }) {
  const value = evaluate(raw, netlist.params);
  const shown = value === undefined ? raw : formatEng(value, unit);
  return (
    <div className="kv-row">
      <dt>{name}</dt>
      <dd>
        <b>{shown}</b>
        {spiceNumber(raw) === undefined && shown !== raw && <span className="mono muted"> {raw}</span>}
      </dd>
    </div>
  );
}

const KIND_TITLE: Record<Device["kind"], string> = {
  nmos: "NMOS transistor", pmos: "PMOS transistor", cap: "Capacitor", res: "Resistor", ind: "Inductor",
  vsrc: "Voltage source", isrc: "Current source", diode: "Diode", subckt: "Subcircuit", other: "Device",
};

type SymbolEntry = {
  key: string;
  title: string;
  sample: Device;
  uses: { file: string; circuit: string; device: string }[];
  models: string[];
  defined?: { file: string; line: number; ports: string[] };
};

// One symbol per device kind, and one per subcircuit (its pins are the .subckt ports), with every use.
function collectSymbols(texts: Record<string, string>, definitions: Map<string, { circuit: Circuit; file: string }>): SymbolEntry[] {
  const entries = new Map<string, SymbolEntry>();
  for (const [file, text] of Object.entries(texts)) {
    const library = Object.entries(texts).filter(([other]) => other !== file).flatMap(([, t]) => parseNetlist(t).subckts);
    const netlist = parseNetlist(text, library);
    for (const circuit of [...netlist.subckts, netlist.top]) {
      for (const device of circuit.devices) {
        const key = device.kind === "subckt" ? `subckt:${(device.model ?? "?").toLowerCase()}` : device.kind;
        let entry = entries.get(key);
        if (!entry) {
          const definition = device.kind === "subckt" && device.model ? definitions.get(device.model.toLowerCase()) : undefined;
          entry = {
            key,
            title: device.kind === "subckt" ? device.model ?? "Subcircuit" : KIND_TITLE[device.kind],
            sample: device,
            uses: [],
            models: [],
            defined: definition && { file: definition.file, line: definition.circuit.line, ports: definition.circuit.ports },
          };
          entries.set(key, entry);
        }
        entry.uses.push({ file, circuit: circuit.name, device: device.name });
        if (device.model && device.kind !== "subckt" && !entry.models.includes(device.model)) entry.models.push(device.model);
      }
    }
  }
  const order = Object.keys(KIND_TITLE);
  return [...entries.values()].sort((a, b) => order.indexOf(a.sample.kind) - order.indexOf(b.sample.kind) || a.title.localeCompare(b.title));
}

function SymbolPreview({ device }: { device: Device }) {
  const placed = useMemo(() => layoutCircuit({ name: "symbol", ports: [], devices: [device], line: 0 }).devices[0], [device]);
  if (!placed) return null;
  const pad = 34;
  const box = [placed.x - placed.width / 2 - pad, placed.y - placed.height / 2 - pad, placed.width + pad * 2, placed.height + pad * 2];
  const box_ = device.kind === "subckt" || device.kind === "other";
  return (
    <svg viewBox={box.join(" ")} className="symbol-preview" aria-hidden="true">
      <g className="sym" transform={`translate(${placed.x} ${placed.y})`}><Symbol placed={placed} /></g>
      {placed.pins.filter((pin) => !pin.hidden).map((pin) => {
        const [dx, dy, anchor]: [number, number, "start" | "end"] = pin.side === "left" ? [-5, -4, "end"] : pin.side === "right" ? [5, -4, "start"] : pin.side === "top" ? [5, -2, "start"] : [5, 10, "start"];
        return (
          <g key={pin.name + pin.side} className="symbol-pin">
            <circle cx={pin.x} cy={pin.y} r={2.5} />
            {!box_ && <text x={pin.x + dx} y={pin.y + dy} textAnchor={anchor}>{pin.name}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function SymbolsView({
  texts,
  definitions,
  onShow,
}: {
  texts: Record<string, string>;
  definitions: Map<string, { circuit: Circuit; file: string }>;
  onShow: (file: string, circuit: string, device: string) => void;
}) {
  const symbols = useMemo(() => collectSymbols(texts, definitions), [texts, definitions]);
  return (
    <div className="symbol-grid">
      {symbols.map((symbol) => (
        <article key={symbol.key} className="panel symbol-card">
          <SymbolPreview device={symbol.sample} />
          <div className="symbol-info">
            <span className="eyebrow">{symbol.sample.kind === "subckt" ? "Subcircuit" : "Primitive"}</span>
            <h3>{symbol.title}</h3>
            <dl className="kv">
              <div className="kv-row">
                <dt>Pins</dt>
                <dd className="mono">{(symbol.defined?.ports ?? symbol.sample.pins.map((pin) => pin.name)).join(" ")}</dd>
              </div>
              {symbol.models.length > 0 && (
                <div className="kv-row">
                  <dt>Models</dt>
                  <dd className="mono">{symbol.models.join(", ")}</dd>
                </div>
              )}
              {symbol.defined && (
                <div className="kv-row">
                  <dt>Defined</dt>
                  <dd className="mono">{symbol.defined.file}:{symbol.defined.line}</dd>
                </div>
              )}
              <div className="kv-row">
                <dt>Used</dt>
                <dd>{symbol.uses.length}×</dd>
              </div>
            </dl>
            <div className="symbol-uses">
              {symbol.uses.slice(0, 12).map((use) => (
                <button key={use.file + use.circuit + use.device} className="net-chip" onClick={() => onShow(use.file, use.circuit, use.device)}
                  title={`Show ${use.device} in ${use.circuit} (${use.file})`}>
                  {use.device}
                </button>
              ))}
              {symbol.uses.length > 12 && <span className="muted">+{symbol.uses.length - 12}</span>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
