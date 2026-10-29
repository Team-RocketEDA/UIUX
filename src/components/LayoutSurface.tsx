import { useState } from "react";
import { Icon } from "./icons";
import { SurfaceHeader } from "./ui";

const WIDTH = 900;
const HEIGHT = 520;

type LayerId = "cells" | "met1" | "met2" | "pads";

const layerDefinitions: { id: LayerId; label: string; color: string; detail: string }[] = [
  { id: "cells", label: "Standard cells", color: "#6aa7e8", detail: "sky130_fd_sc_hd" },
  { id: "met1", label: "Metal 1", color: "#55c7d9", detail: "li1 / met1" },
  { id: "met2", label: "Metal 2", color: "#c19bff", detail: "met2 / met3" },
  { id: "pads", label: "IO ring", color: "#e0ad5f", detail: "48 pads" },
];

function buildCellRects() {
  const rects: { x: number; y: number; width: number }[] = [];
  for (let row = 0; row < 8; row += 1) {
    let x = 132;
    const y = 130 + row * 33;
    for (let column = 0; column < 24; column += 1) {
      const width = 11 + ((row * 13 + column * 7) % 14);
      if (x + width > 522) break;
      rects.push({ x, y, width });
      x += width + 3;
    }
  }
  return rects;
}

const cellRects = buildCellRects();

export function LayoutSurface({
  onOpenFile,
  onRunTool,
}: {
  onOpenFile: (path: string) => void;
  onRunTool: (toolId: string) => void;
}) {
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({
    cells: true,
    met1: true,
    met2: true,
    pads: true,
  });
  const [zoom, setZoom] = useState(1);

  const toggleLayer = (id: LayerId) =>
    setLayers((previous) => ({ ...previous, [id]: !previous[id] }));

  const viewWidth = WIDTH / zoom;
  const viewHeight = HEIGHT / zoom;

  return (
    <div className="fill-surface layout-surface">
      <SurfaceHeader
        eyebrow="PHYSICAL DESIGN / KLAYOUT TARGET"
        title="Layout viewer"
        subtitle="Preview of the completed LibreLane GDS. Geometry is source-backed; painting edits are outside this build."
        actions={
          <>
            <span className="viewer-pill">
              <Icon name="lock" size={11} />
              VIEWER
            </span>
            <button
              className="secondary-button"
              onClick={() => onOpenFile("design/layout.yaml")}
            >
              <Icon name="code" size={13} />
              View source
            </button>
            <button className="secondary-button" onClick={() => onRunTool("klayout")}>
              <Icon name="layers" size={13} />
              Open in KLayout
            </button>
          </>
        }
      />

      <div className="panel diagram-panel">
        <div className="diagram-toolbar">
          <span className="layout-title">
            rocket_top <small>top cell</small>
          </span>
          <span className="diagram-hint">GDS viewer · 1,284 cells · 2.1 MB</span>
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

        <div className="layout-body">
          <div className="diagram-canvas layout-canvas">
            <svg
              viewBox={`${(WIDTH - viewWidth) / 2} ${(HEIGHT - viewHeight) / 2} ${viewWidth} ${viewHeight}`}
              role="img"
              aria-label="Routed die layout for rocket_top"
            >
              <defs>
                <pattern id="layout-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="#1b2b3a" strokeWidth=".5" />
                </pattern>
                <pattern id="cell-fill" width="4" height="4" patternUnits="userSpaceOnUse">
                  <rect width="4" height="4" fill="#17324c" />
                  <rect width="2" height="4" fill="#1d3d5c" />
                </pattern>
              </defs>
              <rect width={WIDTH} height={HEIGHT} fill="#0a1017" />
              <rect width={WIDTH} height={HEIGHT} fill="url(#layout-grid)" opacity=".7" />

              <rect x="36" y="30" width="828" height="458" rx="5" className="die-outline" />
              <text className="layout-die-label" x="48" y="24">
                rocket_top · SKY130 · 1640 × 880 µm
              </text>
              <text className="layout-die-label right" x="852" y="24" textAnchor="end">
                rev 8f3c1a2
              </text>

              <rect x="112" y="104" width="668" height="324" rx="3" className="layout-core" />
              <text className="layout-core-label" x="124" y="98">
                CORE · 0.184 mm² · 62% utilization
              </text>

              {layers.cells && (
                <g className="layer-cells">
                  {cellRects.map((rect, index) => (
                    <rect
                      key={index}
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={24}
                      rx="1"
                      fill="url(#cell-fill)"
                      stroke="#528ec7"
                      strokeWidth=".4"
                    />
                  ))}
                </g>
              )}

              {layers.met1 && (
                <g className="layer-met1">
                  {Array.from({ length: 23 }, (_, index) => (
                    <line
                      key={index}
                      x1={124 + index * 18}
                      y1={112}
                      x2={124 + index * 18}
                      y2={412}
                      stroke="#55c7d9"
                      strokeWidth=".8"
                      opacity=".28"
                    />
                  ))}
                  {Array.from({ length: 9 }, (_, index) => (
                    <line
                      key={`h-${index}`}
                      x1={124}
                      y1={126 + index * 32}
                      x2={770}
                      y2={126 + index * 32}
                      stroke="#55c7d9"
                      strokeWidth=".7"
                      opacity=".16"
                    />
                  ))}
                </g>
              )}

              {layers.met2 && (
                <g className="layer-met2">
                  {Array.from({ length: 5 }, (_, index) => (
                    <line
                      key={index}
                      x1={118}
                      y1={150 + index * 58}
                      x2={772}
                      y2={150 + index * 58}
                      stroke="#c19bff"
                      strokeWidth="4"
                      strokeLinecap="round"
                      opacity=".38"
                    />
                  ))}
                  <line x1="124" y1="118" x2="124" y2="414" stroke="#c19bff" strokeWidth="5" opacity=".4" />
                  <line x1="768" y1="118" x2="768" y2="414" stroke="#c19bff" strokeWidth="5" opacity=".4" />
                </g>
              )}

              <g className="layout-macros">
                <rect x="548" y="132" width="168" height="88" rx="3" className="macro sram" />
                <text x="632" y="171" textAnchor="middle" className="macro-label">
                  SRAM 2 KB
                </text>
                <text x="632" y="187" textAnchor="middle" className="macro-sub">
                  hard macro · sky130
                </text>

                <rect x="548" y="238" width="168" height="72" rx="3" className="macro analog" />
                <text x="632" y="270" textAnchor="middle" className="macro-label">
                  SKY130 OP-AMP
                </text>
                <text x="632" y="286" textAnchor="middle" className="macro-sub">
                  analog macro · 61.4 dB
                </text>

                <rect x="548" y="328" width="168" height="72" rx="3" className="macro photonic" />
                <text x="632" y="360" textAnchor="middle" className="macro-label">
                  CSPDK MZI
                </text>
                <text x="632" y="376" textAnchor="middle" className="macro-sub">
                  photonic macro · 1550 nm
                </text>
              </g>

              {layers.pads && (
                <g className="layer-pads">
                  {Array.from({ length: 8 }, (_, index) => (
                    <g key={`side-${index}`}>
                      <rect x="50" y={72 + index * 46} width="16" height="26" rx="2" />
                      <rect x="834" y={72 + index * 46} width="16" height="26" rx="2" />
                    </g>
                  ))}
                  {Array.from({ length: 12 }, (_, index) => (
                    <g key={`edge-${index}`}>
                      <rect x={86 + index * 63} y="42" width="28" height="15" rx="2" />
                      <rect x={86 + index * 63} y="461" width="28" height="15" rx="2" />
                    </g>
                  ))}
                </g>
              )}

              <line x1="700" y1="500" x2="750" y2="500" stroke="#8fa4b9" strokeWidth="1.5" />
              <line x1="700" y1="497" x2="700" y2="503" stroke="#8fa4b9" />
              <line x1="750" y1="497" x2="750" y2="503" stroke="#8fa4b9" />
              <text x="725" y="495" textAnchor="middle" className="scale-label">
                100 µm
              </text>
            </svg>
            <div className="diagram-overlay">
              <span className="overlay-chip">SOURCE: exports/riscv_top.gds</span>
              <span className="overlay-chip muted">FINAL ROUTED LAYOUT</span>
            </div>
          </div>

          <aside className="layout-side">
            <div className="inspector-heading">
              <span className="eyebrow">LAYERS</span>
              <span>{Object.values(layers).filter(Boolean).length}/{layerDefinitions.length}</span>
            </div>
            <div className="layer-list">
              {layerDefinitions.map((layer) => (
                <button
                  key={layer.id}
                  className={`layer-row ${layers[layer.id] ? "on" : ""}`}
                  onClick={() => toggleLayer(layer.id)}
                  aria-pressed={layers[layer.id]}
                >
                  <span className="layer-swatch" style={{ background: layer.color }} />
                  <span>
                    <b>{layer.label}</b>
                    <small>{layer.detail}</small>
                  </span>
                  <span className={`layer-check ${layers[layer.id] ? "on" : ""}`}>
                    {layers[layer.id] ? "ON" : "OFF"}
                  </span>
                </button>
              ))}
            </div>

            <div className="inspector-section">
              <span className="eyebrow">ARTIFACT</span>
              <dl className="inspector-params">
                <div>
                  <dt>Flow</dt>
                  <dd>LibreLane 2.4</dd>
                </div>
                <div>
                  <dt>Top cell</dt>
                  <dd>rocket_top</dd>
                </div>
                <div>
                  <dt>Area</dt>
                  <dd>0.184 mm²</dd>
                </div>
                <div>
                  <dt>Units</dt>
                  <dd>µm · GDSII</dd>
                </div>
              </dl>
            </div>

            <div className="inline-callout warning">
              <Icon name="warning" size={14} />
              <span>DRC / LVS is unsupported: no PDK deck is registered. Geometry is not signoff.</span>
            </div>
          </aside>
        </div>

        <div className="diagram-statusbar">
          <span>GDSII · 1,284 cells</span>
          <span>SkyWater SKY130</span>
          <span>Revision 8f3c1a2</span>
          <span className="statusbar-right">
            <span className="status-dot unsupported" /> DRC deck missing
          </span>
        </div>
      </div>
    </div>
  );
}
