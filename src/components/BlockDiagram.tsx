import { useEffect, useMemo, useState } from "react";
import { moduleDiagram, topModule, type DiagramNode, type VerilogModule } from "../schematic/verilog";
import { Icon } from "./icons";

const COLUMN = 196;
const INSTANCE_W = 156;
const INSTANCE_H = 58;
const PORT_W = 96;
const PORT_H = 26;
const GAP = 16;
const MARGIN = 20;

type Placed = DiagramNode & { x: number; y: number; w: number; h: number };

function place(nodes: DiagramNode[]): { placed: Map<string, Placed>; width: number; height: number } {
  const columns = new Map<number, DiagramNode[]>();
  for (const node of nodes) columns.set(node.layer, [...(columns.get(node.layer) ?? []), node]);
  const heightOf = (node: DiagramNode) => (node.kind === "instance" ? INSTANCE_H : PORT_H);
  const columnHeight = (items: DiagramNode[]) => items.reduce((sum, node) => sum + heightOf(node) + GAP, -GAP);
  const height = Math.max(...[...columns.values()].map(columnHeight), 60) + MARGIN * 2;
  const placed = new Map<string, Placed>();
  let maxX = 0;
  for (const [layer, items] of columns) {
    let y = (height - columnHeight(items)) / 2;
    for (const node of items) {
      const w = node.kind === "instance" ? INSTANCE_W : PORT_W;
      const x = MARGIN + layer * COLUMN;
      placed.set(node.id, { ...node, x, y, w, h: heightOf(node) });
      maxX = Math.max(maxX, x + w);
      y += heightOf(node) + GAP;
    }
  }
  return { placed, width: maxX + MARGIN, height };
}

// Drawn from the project's Verilog as it is now: modules, ports and the nets joining them. Click blocks to point the
// assistant at them, and double-click one to go inside.
export function BlockDiagram({
  modules,
  startModule,
  changedFiles,
  isNew,
  onAsk,
  bare,
}: {
  modules: VerilogModule[];
  startModule?: string;
  changedFiles?: Set<string>;
  isNew?: (module: string, instance: string) => boolean;
  onAsk?: (text: string) => void;
  // Just the drawing, for the Live build page.
  bare?: boolean;
}) {
  const top = useMemo(() => topModule(modules), [modules]);
  const [path, setPath] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string>();
  const [showClocks, setShowClocks] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // Live: go to the module the assistant just wrote.
  useEffect(() => {
    if (startModule) setPath(startModule === top?.name ? [] : [startModule]);
  }, [startModule]);
  useEffect(() => setSelected([]), [path.join("/")]);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const currentName = path[path.length - 1] ?? top?.name;
  const current = modules.find((module) => module.name === currentName) ?? top;
  const diagram = useMemo(() => (current ? moduleDiagram(current, modules, { showClocks }) : undefined), [current, modules, showClocks]);
  const layout = useMemo(() => (diagram ? place(diagram.nodes) : undefined), [diagram]);
  if (!current || !diagram || !layout) return null;

  const instanceCount = current.instances.length;
  // Each wire gets its own spot along a block's edge, in the order that crosses the fewest others.
  const spread = (ids: string[], y: (id: string) => number, box: Placed) => {
    const sorted = [...ids].sort((a, b) => y(a) - y(b));
    return (id: string) => box.y + (box.h * (sorted.indexOf(id) + 1)) / (sorted.length + 1);
  };
  const centre = (id: string) => {
    const node = layout.placed.get(id);
    return node ? node.y + node.h / 2 : 0;
  };
  const outOf = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const edge of diagram.edges) {
    outOf.set(edge.from, [...(outOf.get(edge.from) ?? []), edge.to]);
    into.set(edge.to, [...(into.get(edge.to) ?? []), edge.from]);
  }
  return (
    <section className="block-diagram" aria-label={`Block diagram of ${current.name}`}>
      <div className="block-diagram-head" hidden={bare}>
        <div className="block-diagram-crumbs">
          <button onClick={() => setPath([])} disabled={!path.length}>
            {top?.name}
          </button>
          {path.map((name, index) => (
            <span key={`${name}-${index}`}>
              <Icon name="chevronRight" size={11} />
              <button onClick={() => setPath(path.slice(0, index + 1))} disabled={index === path.length - 1}>
                {name}
              </button>
            </span>
          ))}
        </div>
        <span className="muted">
          {instanceCount} block{instanceCount === 1 ? "" : "s"} · {current.ports.length} ports · {current.file}
        </span>
        <label className="block-diagram-toggle">
          <input type="checkbox" checked={showClocks} onChange={(event) => setShowClocks(event.target.checked)} />
          Clock and reset
        </label>
        <select
          value={current.name}
          onChange={(event) => setPath(event.target.value === top?.name ? [] : [event.target.value])}
          aria-label="Choose a module"
        >
          {[...modules]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((module) => (
              <option key={`${module.file}-${module.name}`} value={module.name}>
                {module.name}
              </option>
            ))}
        </select>
      </div>
      <div className="block-diagram-canvas">
        <svg style={{ minWidth: Math.round(layout.width * 0.6) }} width="100%" height={bare ? "100%" : Math.max(Math.round(layout.height * 1.15), 260)} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Blocks and wiring inside ${current.name}`}>
          <g fill="none">
            {diagram.edges.map((edge) => {
              const from = layout.placed.get(edge.from);
              const to = layout.placed.get(edge.to);
              if (!from || !to) return null;
              const [x1, y1, x2, y2] = [from.x + from.w, spread(outOf.get(edge.from)!, centre, from)(edge.to), to.x, spread(into.get(edge.to)!, centre, to)(edge.from)];
              const bend = Math.max(36, Math.abs(x2 - x1) / 2);
              const lit = hovered === edge.from || hovered === edge.to;
              return (
                <path
                  key={`${edge.from}>${edge.to}`}
                  className={`block-wire ${lit ? "lit" : ""} ${hovered && !lit ? "dim" : ""}`}
                  d={`M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`}
                >
                  <title>{edge.nets.join(", ")}</title>
                </path>
              );
            })}
          </g>
          {[...layout.placed.values()].map((node) => {
            const definition = modules.find((module) => module.name === node.module);
            const fresh = node.kind === "instance" && Boolean(isNew?.(current.name, node.label));
            const changed = Boolean(definition && changedFiles?.has(definition.file));
            return node.kind === "instance" ? (
              <g
                key={node.id}
                className={`block-node ${node.known ? "known" : ""} ${hovered === node.id ? "lit" : ""} ${selected.includes(node.id) ? "selected" : ""} ${fresh ? "new" : changed ? "changed" : ""}`}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(undefined)}
                onClick={() => (onAsk ? toggle(node.id) : node.known && node.module && setPath([...path, node.module]))}
                onDoubleClick={() => node.known && node.module && setPath([...path, node.module])}
                role="button"
              >
                <title>{`${node.module}. ${onAsk ? "Click to select. " : ""}${node.known ? "Double-click to go inside." : "Its source isn't in this project."}`}</title>
                <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={7} />
                <text x={node.x + 12} y={node.y + 24} className="block-module">
                  {(node.module ?? "").slice(0, 18)}
                </text>
                <text x={node.x + 12} y={node.y + 42} className="block-name">
                  {node.label.slice(0, 16)}
                </text>
                {fresh && (
                  <text x={node.x + node.w - 10} y={node.y + 42} textAnchor="end" className="block-tag">
                    NEW
                  </text>
                )}
              </g>
            ) : (
              <g key={node.id} className={`block-port ${node.kind} ${hovered === node.id ? "lit" : ""}`} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(undefined)}>
                <title>{`${node.kind} ${node.width ?? ""} ${node.label}`}</title>
                <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={13} />
                <text x={node.x + node.w / 2} y={node.y + 17} textAnchor="middle">
                  {node.label.slice(0, 16)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {selected.length > 0 && onAsk && (
        <div className="block-diagram-ask">
          <span>
            {selected.length} selected:{" "}
            <b>
              {selected
                .map((id) => layout.placed.get(id)?.label)
                .filter(Boolean)
                .join(", ")}
            </b>
          </span>
          <button
            className="primary-button"
            onClick={() => {
              const named = selected.map((id) => {
                const node = layout.placed.get(id);
                return `${node?.label} (${node?.module})`;
              });
              onAsk(`In ${current.name}, about ${named.join(" and ")}: `);
            }}
          >
            <Icon name="sparkles" size={13} />
            Ask about {selected.length === 1 ? "this" : "these"}
          </button>
          <button className="secondary-button" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}
    </section>
  );
}
