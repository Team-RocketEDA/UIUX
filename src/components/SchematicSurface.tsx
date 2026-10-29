import { useState } from "react";
import { schematicSheets } from "../data";
import type { SchematicInstance, SchematicPort, SchematicSheet } from "../types";
import { Icon } from "./icons";
import { SurfaceHeader } from "./ui";

const WIDTH = 960;
const HEIGHT = 500;

function portPoint(instance: SchematicInstance, port: SchematicPort): [number, number] {
  switch (port.side) {
    case "left":
      return [instance.x, instance.y + port.offset * instance.height];
    case "right":
      return [instance.x + instance.width, instance.y + port.offset * instance.height];
    case "top":
      return [instance.x + port.offset * instance.width, instance.y];
    default:
      return [instance.x + port.offset * instance.width, instance.y + instance.height];
  }
}

function wireLabelPoint(points: [number, number][]): [number, number] {
  let best: [number, number] = points[0];
  let bestLength = -1;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    if (length > bestLength) {
      bestLength = length;
      best = [(x1 + x2) / 2, (y1 + y2) / 2];
    }
  }
  return best;
}

function InstanceShape({
  instance,
  selected,
  onSelect,
  onOpenSheet,
}: {
  instance: SchematicInstance;
  selected: boolean;
  onSelect: () => void;
  onOpenSheet: () => void;
}) {
  const centerX = instance.x + instance.width / 2;
  const centerY = instance.y + instance.height / 2;

  return (
    <g
      className={`schematic-instance ${instance.tone} ${selected ? "selected" : ""}`}
      tabIndex={0}
      role="button"
      aria-label={`${instance.id}, ${instance.label}${instance.sheet ? ", hierarchical sheet" : ""}`}
      onClick={onSelect}
      onDoubleClick={() => {
        if (instance.sheet) onOpenSheet();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
    >
      <rect
        className="instance-body"
        x={instance.x}
        y={instance.y}
        width={instance.width}
        height={instance.height}
        rx={8}
      />
      <rect
        className="instance-header"
        x={instance.x}
        y={instance.y}
        width={instance.width}
        height={32}
        rx={8}
      />
      <line
        className="instance-divider"
        x1={instance.x}
        y1={instance.y + 32}
        x2={instance.x + instance.width}
        y2={instance.y + 32}
      />
      <text className="instance-ref" x={instance.x + 11} y={instance.y + 21}>
        {instance.id}
      </text>
      <text
        className={`instance-badge ${instance.sheet ? "sheet" : ""}`}
        x={instance.x + instance.width - 11}
        y={instance.y + 21}
        textAnchor="end"
      >
        {instance.sheet ? "SHEET ↗" : instance.badge}
      </text>
      <text className="instance-name" x={centerX} y={centerY - 4} textAnchor="middle">
        {instance.label}
      </text>
      <text className="instance-block" x={centerX} y={centerY + 13} textAnchor="middle">
        {instance.block}
      </text>
      {instance.ports.map((port) => {
        const [x, y] = portPoint(instance, port);
        const labelProps =
          port.side === "left"
            ? { x: x + 8, y: y + 3, anchor: "start" as const }
            : port.side === "right"
              ? { x: x - 8, y: y + 3, anchor: "end" as const }
              : port.side === "top"
                ? { x, y: y + 13, anchor: "middle" as const }
                : { x, y: y - 7, anchor: "middle" as const };
        return (
          <g key={port.name} className="instance-port">
            <circle cx={x} cy={y} r={3.5} />
            <text x={labelProps.x} y={labelProps.y} textAnchor={labelProps.anchor}>
              {port.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function SchematicSurface({
  onOpenFile,
}: {
  onOpenFile: (path: string) => void;
}) {
  const [sheetId, setSheetId] = useState("top");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const sheet: SchematicSheet = schematicSheets[sheetId] ?? schematicSheets.top;
  const selected = sheet.instances.find((instance) => instance.id === selectedId);

  const openSheet = (id: string) => {
    setSheetId(id);
    setSelectedId(null);
    setZoom(1);
  };

  const viewWidth = WIDTH / zoom;
  const viewHeight = HEIGHT / zoom;

  return (
    <div className="fill-surface schematic-surface">
      <SurfaceHeader
        eyebrow="DESIGN / HIERARCHICAL SCHEMATIC"
        title="Schematic viewer"
        subtitle="Source-backed view of design/schematic.yaml. Double-click a sheet instance to descend the hierarchy."
        actions={
          <>
            <span className="viewer-pill">
              <Icon name="lock" size={11} />
              VIEWER
            </span>
            <button
              className="secondary-button"
              onClick={() => onOpenFile("design/schematic.yaml")}
            >
              <Icon name="code" size={13} />
              View source
            </button>
          </>
        }
      />

      <div className="panel diagram-panel">
        <div className="diagram-toolbar">
          <nav className="breadcrumb" aria-label="Schematic hierarchy">
            <button onClick={() => openSheet("top")} aria-current={sheetId === "top" ? "page" : undefined}>
              top
            </button>
            {sheetId !== "top" && (
              <>
                <Icon name="chevronRight" size={11} />
                <button onClick={() => openSheet(sheetId)} aria-current="page">
                  {sheetId}
                </button>
              </>
            )}
          </nav>
          <span className="diagram-hint">
            {sheet.instances.some((instance) => instance.sheet)
              ? "Double-click a SHEET instance to open it"
              : "Sub-sheet of top"}
          </span>
          <div className="zoom-group">
            <button
              className="icon-button"
              onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <Icon name="zoomOut" size={14} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              className="icon-button"
              onClick={() => setZoom((value) => Math.min(2.25, value + 0.25))}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <Icon name="zoomIn" size={14} />
            </button>
            <button
              className="icon-button"
              onClick={() => setZoom(1)}
              title="Fit to view"
              aria-label="Fit to view"
            >
              <Icon name="fit" size={14} />
            </button>
          </div>
        </div>

        <div className="diagram-body">
          <div className="diagram-canvas">
            <svg
              viewBox={`${(WIDTH - viewWidth) / 2} ${(HEIGHT - viewHeight) / 2} ${viewWidth} ${viewHeight}`}
              role="img"
              aria-label={`Schematic sheet ${sheet.path}`}
            >
              <defs>
                <pattern id="schematic-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="#1a2a3a" strokeWidth=".6" />
                </pattern>
              </defs>
              <rect width={WIDTH} height={HEIGHT} fill="#0b121a" />
              <rect width={WIDTH} height={HEIGHT} fill="url(#schematic-grid)" opacity=".65" />
              <text className="sheet-title" x="40" y="58">
                {sheet.name}
              </text>
              <text className="sheet-subtitle" x="40" y="75">
                {sheet.path} · sky130 · revision 8f3c1a2
              </text>

              {sheet.boundaryPorts.map((port) => (
                <g key={port.name} className="boundary-port">
                  <circle cx={port.x} cy={port.y} r={4} />
                  <text
                    x={port.side === "left" ? port.x + 12 : port.x - 12}
                    y={port.y + 3}
                    textAnchor={port.side === "left" ? "start" : "end"}
                  >
                    {port.name}
                  </text>
                </g>
              ))}

              {sheet.wires.map((wire, index) => {
                const [labelX, labelY] = wireLabelPoint(wire.points);
                return (
                  <g key={`${wire.label ?? "wire"}-${index}`} className="schematic-wire">
                    <polyline
                      points={wire.points.map((point) => point.join(",")).join(" ")}
                      className={wire.dashed ? "dashed" : ""}
                    />
                    {wire.label && (
                      <text
                        className="wire-label"
                        x={labelX}
                        y={labelY - 5}
                        textAnchor="middle"
                      >
                        {wire.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {sheet.instances.map((instance) => (
                <InstanceShape
                  key={instance.id}
                  instance={instance}
                  selected={selectedId === instance.id}
                  onSelect={() => setSelectedId(instance.id)}
                  onOpenSheet={() => instance.sheet && openSheet(instance.sheet)}
                />
              ))}
            </svg>
            <div className="diagram-overlay">
              <span className="overlay-chip">SOURCE: design/schematic.yaml</span>
              <span className="overlay-chip muted">READ-ONLY GEOMETRY</span>
            </div>
          </div>

          <aside className="inspector">
            <div className="inspector-heading">
              <span className="eyebrow">INSPECTOR</span>
              <span>{selected ? selected.id : "SHEET"}</span>
            </div>

            {selected ? (
              <>
                <div className="inspector-title-row">
                  <h3>{selected.label}</h3>
                  <span className={`tone-badge ${selected.tone}`}>{selected.badge}</span>
                </div>
                <code className="inspector-path">{selected.block}</code>
                <dl className="inspector-params">
                  {selected.params.map((param) => (
                    <div key={param.name}>
                      <dt>{param.name}</dt>
                      <dd>{param.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="inspector-section">
                  <span className="eyebrow">PORTS</span>
                  <div className="port-list">
                    {selected.ports.map((port) => (
                      <div key={port.name} className="port-row">
                        <span className="port-dot" />
                        <b>{port.name}</b>
                        <small>{port.side}</small>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="inspector-actions">
                  {selected.sheet && (
                    <button className="primary-button" onClick={() => openSheet(selected.sheet!)}>
                      Open sub-sheet
                      <Icon name="chevronRight" size={13} />
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    onClick={() => onOpenFile("design/schematic.yaml")}
                  >
                    View source
                  </button>
                </div>
                <p className="inspector-note">
                  Instances and nets come from the project source. Editable schematic operations are
                  not enabled in this build.
                </p>
              </>
            ) : (
              <>
                <div className="inspector-title-row">
                  <h3>{sheet.name}</h3>
                  <span className="tone-badge blue">SHEET</span>
                </div>
                <p className="inspector-note">{sheet.note}</p>
                <dl className="inspector-params">
                  <div>
                    <dt>Path</dt>
                    <dd>{sheet.path}</dd>
                  </div>
                  <div>
                    <dt>Instances</dt>
                    <dd>{sheet.instances.length}</dd>
                  </div>
                  <div>
                    <dt>Connections</dt>
                    <dd>{sheet.wires.length}</dd>
                  </div>
                  <div>
                    <dt>Hierarchy</dt>
                    <dd className="good">resolved</dd>
                  </div>
                </dl>
                {sheet.id === "gpio" && (
                  <div className="inline-callout warning">
                    <Icon name="warning" size={14} />
                    <span>OpenSTA flags the readback mux on this sheet: −1.12 ns setup.</span>
                  </div>
                )}
                <div className="inspector-actions">
                  <button
                    className="secondary-button"
                    onClick={() => onOpenFile("design/schematic.yaml")}
                  >
                    View schematic source
                  </button>
                </div>
                <p className="inspector-note">
                  Select an instance to inspect its block, parameters and ports.
                </p>
              </>
            )}
          </aside>
        </div>

        <div className="diagram-statusbar">
          <span>{sheet.instances.length} instances</span>
          <span>{sheet.wires.length} connectivity paths</span>
          <span>{sheet.boundaryPorts.length} boundary ports</span>
          <span className="statusbar-right">
            <span className="status-dot passed" /> Hierarchy validated
          </span>
        </div>
      </div>
    </div>
  );
}
