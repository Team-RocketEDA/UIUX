import { useMemo, useState } from "react";
import { moduleDiagram, topModule, type DiagramNode, type VerilogModule } from "../schematic/verilog";
import { Icon } from "./icons";

const COLUMN = 250;
const INSTANCE_W = 178;
const INSTANCE_H = 58;
const PORT_W = 120;
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

// Drawn from the project's Verilog as it is now: modules, ports and the nets joining them. Click a block to go inside.
export function BlockDiagram({ modules }: { modules: VerilogModule[] }) {
  const top = useMemo(() => topModule(modules), [modules]);
  const [path, setPath] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string>();
  const currentName = path[path.length - 1] ?? top?.name;
  const current = modules.find((module) => module.name === currentName) ?? top;
  const diagram = useMemo(() => (current ? moduleDiagram(current, modules) : undefined), [current, modules]);
  const layout = useMemo(() => (diagram ? place(diagram.nodes) : undefined), [diagram]);
  if (!current || !diagram || !layout) return null;

  const instanceCount = current.instances.length;
  return (
    <section className="block-diagram" aria-label={`Block diagram of ${current.name}`}>
      <div className="block-diagram-head">
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
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={`Blocks and wiring inside ${current.name}`}>
          <g fill="none">
            {diagram.edges.map((edge) => {
              const from = layout.placed.get(edge.from);
              const to = layout.placed.get(edge.to);
              if (!from || !to) return null;
              const [x1, y1, x2, y2] = [from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2];
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
          {[...layout.placed.values()].map((node) =>
            node.kind === "instance" ? (
              <g
                key={node.id}
                className={`block-node ${node.known ? "known" : ""} ${hovered === node.id ? "lit" : ""}`}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(undefined)}
                onClick={() => node.known && node.module && setPath([...path, node.module])}
                role={node.known ? "button" : undefined}
              >
                <title>{node.known ? `${node.module}: open it` : `${node.module}: its source isn't in this project`}</title>
                <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={7} />
                <text x={node.x + 12} y={node.y + 24} className="block-module">
                  {(node.module ?? "").slice(0, 21)}
                </text>
                <text x={node.x + 12} y={node.y + 42} className="block-name">
                  {node.label.slice(0, 24)}
                </text>
              </g>
            ) : (
              <g key={node.id} className={`block-port ${node.kind} ${hovered === node.id ? "lit" : ""}`} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(undefined)}>
                <title>{`${node.kind} ${node.width ?? ""} ${node.label}`}</title>
                <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={13} />
                <text x={node.x + node.w / 2} y={node.y + 17} textAnchor="middle">
                  {node.label.slice(0, 16)}
                </text>
              </g>
            ),
          )}
        </svg>
      </div>
      {!instanceCount && <p className="muted block-diagram-leaf">This module has no blocks inside: it's built from logic directly.</p>}
    </section>
  );
}
