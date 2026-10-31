import { useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { initialSymbolLibrary, schematicSheets } from "../data";
import { getSky130SymFixtures, parseSymAsset, type SymRenderModel } from "../sym";
import type {
  CircuitSymbolDef,
  Domain,
  SchematicInstance,
  SchematicPort,
  SchematicSheet,
  SchematicSymbolKind,
  SymbolPin,
} from "../types";
import { Icon } from "./icons";
import { DomainTag, SurfaceHeader } from "./ui";

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

function SymbolArtwork({
  kind,
  cx,
  cy,
  scale = 1,
}: {
  kind: SchematicSymbolKind;
  cx: number;
  cy: number;
  scale?: number;
}) {
  if (kind === "block") return null;
  return (
    <g
      className="symbol-artwork"
      transform={`translate(${cx}, ${cy}) scale(${scale})`}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {(kind === "nmos" || kind === "pmos") && (
        <>
          <line x1={-16} y1={0} x2={-7} y2={0} className="sym-stroke" />
          <line x1={-7} y1={-11} x2={-7} y2={11} className="sym-stroke" />
          <line x1={-3} y1={-13} x2={-3} y2={13} className="sym-stroke-bold" />
          <line x1={-3} y1={-9} x2={9} y2={-9} className="sym-stroke" />
          <line x1={9} y1={-9} x2={9} y2={-18} className="sym-stroke" />
          <line x1={-3} y1={9} x2={9} y2={9} className="sym-stroke" />
          <line x1={9} y1={9} x2={9} y2={18} className="sym-stroke" />
          {kind === "pmos" ? (
            <>
              <circle cx={-9.5} cy={0} r={2.2} className="sym-bubble" />
              <polygon points="-2,-9 4,-12 4,-6" className="sym-arrow" />
            </>
          ) : (
            <polygon points="8,9 2,6 2,12" className="sym-arrow" />
          )}
        </>
      )}
      {kind === "capacitor" && (
        <>
          <line x1={-20} y1={0} x2={-4} y2={0} className="sym-stroke" />
          <line x1={-4} y1={-12} x2={-4} y2={12} className="sym-stroke-bold" />
          <line x1={4} y1={-12} x2={4} y2={12} className="sym-stroke-bold" />
          <line x1={4} y1={0} x2={20} y2={0} className="sym-stroke" />
        </>
      )}
      {kind === "resistor" && (
        <polyline
          points="-22,0 -14,0 -11,-7 -6,7 0,-7 6,7 11,-7 14,0 22,0"
          className="sym-stroke"
          fill="none"
        />
      )}
      {kind === "isource" && (
        <>
          <circle cx={0} cy={0} r={13} className="sym-body" />
          <line x1={0} y1={-19} x2={0} y2={-13} className="sym-stroke" />
          <line x1={0} y1={13} x2={0} y2={19} className="sym-stroke" />
          <line x1={0} y1={-7} x2={0} y2={6} className="sym-stroke" />
          <polygon points="0,9 -4,3 4,3" className="sym-arrow" />
        </>
      )}
      {kind === "opamp" && (
        <>
          <polygon points="-16,-14 -16,14 16,0" className="sym-body" />
          <line x1={-12} y1={-6} x2={-7} y2={-6} className="sym-stroke" />
          <line x1={-12} y1={6} x2={-7} y2={6} className="sym-stroke" />
          <line x1={-9.5} y1={3.5} x2={-9.5} y2={8.5} className="sym-stroke" />
        </>
      )}
      {kind === "dff" && (
        <>
          <rect x={-15} y={-14} width={30} height={28} rx={2} className="sym-body" />
          <polyline points="-15,4 -9,8 -15,12" className="sym-stroke" fill="none" />
          <text x={-10} y={-4} className="sym-mini-text">
            D
          </text>
          <text x={6} y={-4} className="sym-mini-text">
            Q
          </text>
        </>
      )}
      {kind === "mzi" && (
        <>
          <path
            d="M-20,0 L-12,0 C-8,0 -7,-9 -2,-9 L4,-9 C9,-9 10,0 14,0 L20,0"
            className="sym-stroke"
            fill="none"
          />
          <path
            d="M-12,0 C-8,0 -7,9 -2,9 L4,9 C9,9 10,0 14,0"
            className="sym-stroke"
            fill="none"
          />
          <rect x={-4} y={-12} width={10} height={4} rx={1} className="sym-arrow" />
        </>
      )}
    </g>
  );
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
  const hasSymbol = instance.symbol && instance.symbol !== "block";

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
        height={28}
        rx={8}
      />
      <line
        className="instance-divider"
        x1={instance.x}
        y1={instance.y + 28}
        x2={instance.x + instance.width}
        y2={instance.y + 28}
      />
      <text className="instance-ref" x={instance.x + 10} y={instance.y + 18}>
        {instance.id}
      </text>
      <text
        className={`instance-badge ${instance.sheet ? "sheet" : ""}`}
        x={instance.x + instance.width - 10}
        y={instance.y + 18}
        textAnchor="end"
      >
        {instance.sheet ? "SHEET ↗" : instance.badge}
      </text>

      {hasSymbol ? (
        <>
          <SymbolArtwork
            kind={instance.symbol!}
            cx={centerX}
            cy={instance.y + 28 + (instance.height - 28) * 0.43}
            scale={0.88}
          />
          <text
            className="instance-name"
            x={centerX}
            y={instance.y + instance.height - 18}
            textAnchor="middle"
          >
            {instance.label}
          </text>
          <text
            className="instance-block"
            x={centerX}
            y={instance.y + instance.height - 7}
            textAnchor="middle"
          >
            {instance.params[1]?.value ?? instance.block}
          </text>
        </>
      ) : (
        <>
          <text className="instance-name" x={centerX} y={centerY - 2} textAnchor="middle">
            {instance.label}
          </text>
          <text className="instance-block" x={centerX} y={centerY + 14} textAnchor="middle">
            {instance.block}
          </text>
        </>
      )}

      {instance.ports.map((port) => {
        const [x, y] = portPoint(instance, port);
        const labelProps =
          port.side === "left"
            ? { x: x + 8, y: y + 3, anchor: "start" as const }
            : port.side === "right"
              ? { x: x - 8, y: y + 3, anchor: "end" as const }
              : port.side === "top"
                ? { x: x + 7, y: y - 6, anchor: "start" as const }
                : { x: x + 7, y: y + 11, anchor: "start" as const };
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

function SymbolEditorCanvas({ symbol }: { symbol: CircuitSymbolDef }) {
  const boxX = 330;
  const boxY = 135;
  const boxW = 300;
  const boxH = 220;
  const centerX = boxX + boxW / 2;
  const centerY = boxY + boxH / 2;

  const pinCoords = (pin: SymbolPin): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lx: number;
    ly: number;
    nx: number;
    ny: number;
    anchor: "start" | "end" | "middle";
    numAnchor: "start" | "end" | "middle";
  } => {
    const stem = 38;
    if (pin.side === "left") {
      const y = boxY + pin.offset * boxH;
      return {
        x1: boxX - stem,
        y1: y,
        x2: boxX,
        y2: y,
        lx: boxX + 12,
        ly: y + 4,
        nx: boxX - stem / 2,
        ny: y - 6,
        anchor: "start",
        numAnchor: "middle",
      };
    }
    if (pin.side === "right") {
      const y = boxY + pin.offset * boxH;
      return {
        x1: boxX + boxW,
        y1: y,
        x2: boxX + boxW + stem,
        y2: y,
        lx: boxX + boxW - 12,
        ly: y + 4,
        nx: boxX + boxW + stem / 2,
        ny: y - 6,
        anchor: "end",
        numAnchor: "middle",
      };
    }
    if (pin.side === "top") {
      const x = boxX + pin.offset * boxW;
      return {
        x1: x,
        y1: boxY - stem,
        x2: x,
        y2: boxY,
        lx: x,
        ly: boxY + 18,
        nx: x + 8,
        ny: boxY - stem / 2 + 3,
        anchor: "middle",
        numAnchor: "start",
      };
    }
    const x = boxX + pin.offset * boxW;
    return {
      x1: x,
      y1: boxY + boxH,
      x2: x,
      y2: boxY + boxH + stem,
      lx: x,
      ly: boxY + boxH - 10,
      nx: x + 8,
      ny: boxY + boxH + stem / 2 + 3,
      anchor: "middle",
      numAnchor: "start",
    };
  };

  return (
    <svg viewBox="220 45 520 410" role="img" aria-label={`KiCad symbol editor for ${symbol.name}`}>
      <defs>
        <pattern id="symbol-grid-minor" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#152331" strokeWidth=".5" />
        </pattern>
        <pattern id="symbol-grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="url(#symbol-grid-minor)" />
          <path d="M100 0H0V100" fill="none" stroke="#1f3347" strokeWidth=".9" />
        </pattern>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill="#091018" />
      <rect width={WIDTH} height={HEIGHT} fill="url(#symbol-grid-major)" />

      {/* Origin crosshair */}
      <line x1={centerX} y1={0} x2={centerX} y2={HEIGHT} stroke="#1f3850" strokeDasharray="4 4" />
      <line x1={0} y1={centerY} x2={WIDTH} y2={centerY} stroke="#1f3850" strokeDasharray="4 4" />
      <circle cx={centerX} cy={centerY} r={5} fill="none" stroke="#55c7d9" strokeWidth="1" />

      <text className="sheet-title" x="242" y="74">
        {symbol.name}
      </text>
      <text className="sheet-subtitle" x="242" y="91">
        Ref: {symbol.referencePrefix}? · Cell: {symbol.pdkCell} · {symbol.defaultParams.map((p) => `${p.name}=${p.value}`).join(" · ")}
      </text>

      {/* Symbol body */}
      <rect
        x={boxX}
        y={boxY}
        width={boxW}
        height={boxH}
        rx={10}
        fill="rgba(17, 35, 52, 0.78)"
        stroke="#4b89c8"
        strokeWidth="1.6"
      />
      <text x={boxX + 12} y={boxY - 10} className="instance-ref">
        {symbol.referencePrefix}?
      </text>
      <text x={boxX + boxW - 12} y={boxY - 10} textAnchor="end" className="instance-badge">
        {symbol.domain.toUpperCase()}
      </text>

      <SymbolArtwork kind={symbol.shape} cx={centerX} cy={centerY - 6} scale={2.45} />

      {/* Pins */}
      {symbol.pins.map((pin) => {
        const coords = pinCoords(pin);
        const outerX = pin.side === "left" ? coords.x1 : pin.side === "right" ? coords.x2 : coords.x1;
        const outerY = pin.side === "top" ? coords.y1 : pin.side === "bottom" ? coords.y2 : coords.y1;
        return (
          <g key={`${pin.number}-${pin.name}`} className="symbol-pin-group">
            <line
              x1={coords.x1}
              y1={coords.y1}
              x2={coords.x2}
              y2={coords.y2}
              stroke="#79b8ff"
              strokeWidth="1.8"
            />
            <circle cx={outerX} cy={outerY} r={4.2} fill="#091018" stroke="#57d29a" strokeWidth="1.6" />
            <text x={coords.lx} y={coords.ly} textAnchor={coords.anchor} className="symbol-pin-name">
              {pin.name}
            </text>
            <text x={coords.nx} y={coords.ny} textAnchor={coords.numAnchor} className="symbol-pin-num">
              #{pin.number} ({pin.electricalType.slice(0, 3).toUpperCase()})
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function XschemSymCanvas({ model }: { model: SymRenderModel }) {
  const { bbox, lines, rects, arcs, polygons, pins, texts } = model;
  const padX = Math.max(78, Math.round(bbox.width * 0.45));
  const padY = Math.max(48, Math.round(bbox.height * 0.32));
  const vx = (bbox.width > 0 ? bbox.x1 : -100) - padX;
  const vy = (bbox.height > 0 ? bbox.y1 : -100) - padY;
  const vw = Math.max(220, bbox.width + padX * 2);
  const vh = Math.max(180, bbox.height + padY * 2);

  return (
    <svg
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      className="schematic-svg symbol-editor-svg"
      role="img"
      aria-label={`xschem symbol ${model.provenance.assetPath}`}
    >
      <defs>
        <pattern id="xschem-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#18181f" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect x={vx} y={vy} width={vw} height={vh} fill="#08080b" />
      <rect x={vx} y={vy} width={vw} height={vh} fill="url(#xschem-grid)" />
      <line x1={vx} y1={0} x2={vx + vw} y2={0} className="symbol-origin-axis" strokeWidth="0.8" />
      <line x1={0} y1={vy} x2={0} y2={vy + vh} className="symbol-origin-axis" strokeWidth="0.8" />
      <rect
        x={bbox.x1}
        y={bbox.y1}
        width={bbox.width}
        height={bbox.height}
        fill="none"
        stroke="#272732"
        strokeWidth="0.9"
        strokeDasharray="3 3"
      />
      {rects.map((r, idx) => (
        <rect
          key={`rect-${idx}`}
          x={Math.min(r.x1, r.x2)}
          y={Math.min(r.y1, r.y2)}
          width={Math.abs(r.x2 - r.x1)}
          height={Math.abs(r.y2 - r.y1)}
          fill="rgba(59, 130, 246, 0.06)"
          stroke="#60a5fa"
          strokeWidth="1.8"
        />
      ))}
      {polygons.map((poly, idx) => (
        <polyline
          key={`poly-${idx}`}
          points={poly.points.map((pt) => `${pt.x},${pt.y}`).join(" ")}
          fill="none"
          stroke="#34d399"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      ))}
      {lines.map((l, idx) => (
        <line
          key={`line-${idx}`}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={l.layer === 4 ? "#38bdf8" : "#a1a1aa"}
          strokeWidth={l.layer === 4 ? "2.1" : "1.6"}
          strokeLinecap="round"
        />
      ))}
      {arcs.map((a, idx) => (
        <circle
          key={`arc-${idx}`}
          cx={a.x}
          cy={a.y}
          r={a.r}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.8"
        />
      ))}
      {pins.map((pin) => {
        const [x1, y1, x2, y2] = pin.box;
        const labelOffset = pin.side === "left" ? -8 : pin.side === "right" ? 8 : 0;
        const labelYOffset = pin.side === "top" ? -8 : pin.side === "bottom" ? 12 : 3;
        const anchor =
          pin.side === "left" ? "end" : pin.side === "right" ? "start" : "middle";
        return (
          <g key={pin.name}>
            <rect
              x={Math.min(x1, x2)}
              y={Math.min(y1, y2)}
              width={Math.max(4, Math.abs(x2 - x1))}
              height={Math.max(4, Math.abs(y2 - y1))}
              fill="#ef4444"
              stroke="#fca5a5"
              strokeWidth="1"
            />
            <text
              x={pin.x + labelOffset}
              y={pin.y + labelYOffset}
              textAnchor={anchor}
              fill="#f4f4f5"
              fontSize="9"
              fontFamily="var(--mono)"
              fontWeight="600"
            >
              {pin.name} ({pin.dir})
            </text>
          </g>
        );
      })}
      {texts.map((t, idx) => (
        <text
          key={`txt-${idx}`}
          x={t.x}
          y={t.y}
          fill="#a1a1aa"
          fontSize="8.5"
          fontFamily="var(--mono)"
        >
          {t.text}
        </text>
      ))}
    </svg>
  );
}

export function SchematicSurface({
  onOpenFile,
  notify,
}: {
  onOpenFile: (path: string) => void;
  notify?: (message: string) => void;
}) {
  const [mode, setMode] = useState<"viewer" | "symbols" | "pdk_sym">("viewer");
  const [sheets, setSheets] = useState<Record<string, SchematicSheet>>(() => schematicSheets);
  const [sheetId, setSheetId] = useState("top");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNet, setSelectedNet] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(
    null,
  );
  const [cursor, setCursor] = useState({ x: 480, y: 250 });

  // Symbol library & editor state
  const [symbols, setSymbols] = useState<CircuitSymbolDef[]>(() => initialSymbolLibrary);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>(initialSymbolLibrary[0].id);
  const [newPinName, setNewPinName] = useState("");
  const [newPinSide, setNewPinSide] = useState<SymbolPin["side"]>("left");
  const [newPinType, setNewPinType] = useState<SymbolPin["electricalType"]>("passive");

  // v0.2 Handover §10.2: Verbatim sky130A .sym fixtures & SHA-256 integrity state
  const symFixtures = getSky130SymFixtures();
  const [selectedSymPath, setSelectedSymPath] = useState<string>(symFixtures[0].assetPath);
  const [corruptHashMode, setCorruptHashMode] = useState(false);
  const activeSymFixture =
    symFixtures.find((item) => item.assetPath === selectedSymPath) ?? symFixtures[0];
  const parsedSymResult = parseSymAsset({
    pdkId: activeSymFixture.pdkId,
    pdkRevision: activeSymFixture.pdkRevision,
    assetPath: activeSymFixture.assetPath,
    expectedSha256: corruptHashMode ? "0".repeat(64) : activeSymFixture.expectedSha256,
    content: activeSymFixture.content,
  });

  const sheet: SchematicSheet = sheets[sheetId] ?? sheets.top;
  const selected = sheet.instances.find((instance) => instance.id === selectedId);
  const activeSymbol = symbols.find((item) => item.id === selectedSymbolId) ?? symbols[0];

  const openSheet = (id: string) => {
    setSheetId(id);
    setSelectedId(null);
    setSelectedNet(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.15 : -0.15;
    setZoom((current) => Math.min(2.5, Math.max(0.6, Number((current + delta).toFixed(2)))));
  };

  const handleMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest(".schematic-instance, .schematic-wire")) return;
    setDragStart({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
  };

  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const relX = (event.clientX - rect.left) / rect.width;
      const relY = (event.clientY - rect.top) / rect.height;
      const gridX = Math.round(((relX * WIDTH) / zoom + pan.x) / 5) * 5;
      const gridY = Math.round(((relY * HEIGHT) / zoom + pan.y) / 5) * 5;
      setCursor({ x: gridX, y: gridY });
    }
    if (!dragStart) return;
    const dx = (event.clientX - dragStart.x) / zoom;
    const dy = (event.clientY - dragStart.y) / zoom;
    setPan({
      x: Math.max(-320, Math.min(320, Math.round(dragStart.panX - dx))),
      y: Math.max(-220, Math.min(220, Math.round(dragStart.panY - dy))),
    });
  };

  const handleMouseUp = () => setDragStart(null);

  const updateSymbol = (updater: (current: CircuitSymbolDef) => CircuitSymbolDef) => {
    setSymbols((previous) =>
      previous.map((item) => (item.id === activeSymbol.id ? updater(item) : item)),
    );
  };

  const addPinToSymbol = () => {
    const trimmed = newPinName.trim().toUpperCase();
    if (!trimmed) return;
    updateSymbol((current) => {
      const sameSideCount = current.pins.filter((p) => p.side === newPinSide).length;
      const offset = Math.min(0.85, Math.max(0.2, (sameSideCount + 1) / (sameSideCount + 2)));
      const nextPin: SymbolPin = {
        number: String(current.pins.length + 1),
        name: trimmed,
        side: newPinSide,
        electricalType: newPinType,
        offset,
      };
      return { ...current, pins: [...current.pins, nextPin] };
    });
    setNewPinName("");
    notify?.(`Added pin ${trimmed} to ${activeSymbol.name}.`);
  };

  const removePinFromSymbol = (pinNumber: string) => {
    updateSymbol((current) => ({
      ...current,
      pins: current.pins
        .filter((pin) => pin.number !== pinNumber)
        .map((pin, index) => ({ ...pin, number: String(index + 1) })),
    }));
  };

  const createCustomSymbol = () => {
    const index = symbols.length + 1;
    const id = `custom_sym_${index}`;
    const created: CircuitSymbolDef = {
      id,
      name: `CUSTOM_BLOCK_${index}`,
      referencePrefix: "U",
      domain: "analog",
      shape: "opamp",
      pdkCell: "project://custom_block",
      description: "User-defined schematic symbol created in the RocketEDA Symbol Editor.",
      defaultParams: [
        { name: "PDK", value: "sky130" },
        { name: "Mode", value: "custom" },
      ],
      pins: [
        { number: "1", name: "IN", side: "left", electricalType: "input", offset: 0.4 },
        { number: "2", name: "BIAS", side: "left", electricalType: "input", offset: 0.7 },
        { number: "3", name: "OUT", side: "right", electricalType: "output", offset: 0.5 },
      ],
    };
    setSymbols((previous) => [...previous, created]);
    setSelectedSymbolId(id);
    notify?.(`Created ${created.name} in project symbol library.`);
  };

  const placeSymbolOnSheet = () => {
    const currentSheet = sheets[sheetId] ?? sheets.top;
    const count = currentSheet.instances.length + 1;
    const newId = `${activeSymbol.referencePrefix}${count}`;
    const toneMap: Record<Domain, SchematicInstance["tone"]> = {
      digital: "blue",
      analog: "amber",
      photonic: "green",
    };
    const newInstance: SchematicInstance = {
      id: newId,
      label: activeSymbol.name,
      block: activeSymbol.pdkCell,
      x: 80 + ((count * 75) % 580),
      y: 85 + ((count * 55) % 260),
      width: 150,
      height: 102,
      tone: toneMap[activeSymbol.domain],
      badge: "IP",
      symbol: activeSymbol.shape,
      sourceFile:
        sheetId === "opamp"
          ? "design/analog/opamp.spice"
          : sheetId === "gpio"
            ? "design/digital/gpio.sv"
            : "design/schematic.yaml",
      params: activeSymbol.defaultParams,
      ports: activeSymbol.pins.map((pin) => ({
        name: pin.name,
        side: pin.side,
        offset: pin.offset,
      })),
    };

    setSheets((previous) => ({
      ...previous,
      [sheetId]: {
        ...currentSheet,
        instances: [...currentSheet.instances, newInstance],
      },
    }));
    setMode("viewer");
    setSelectedId(newId);
    notify?.(`Instantiated ${newId} (${activeSymbol.name}) onto sheet ${currentSheet.path}.`);
  };

  const viewWidth = WIDTH / zoom;
  const viewHeight = HEIGHT / zoom;
  const viewBoxX = (WIDTH - viewWidth) / 2 + pan.x;
  const viewBoxY = (HEIGHT - viewHeight) / 2 + pan.y;

  const sourcePathForSheet =
    sheetId === "opamp"
      ? "design/analog/opamp.spice"
      : sheetId === "gpio"
        ? "design/digital/gpio.sv"
        : "design/schematic.yaml";

  return (
    <div className="fill-surface schematic-surface">
      {mode === "viewer" ? (
        <div className="panel diagram-panel">
          <div className="diagram-toolbar">
            <div className="sheet-pills" role="group" aria-label="Quick sheet switch">
              {[
                { id: "top", label: "top" },
                { id: "gpio", label: "gpio" },
                { id: "opamp", label: "opamp" },
              ].map((item) => (
                <button
                  key={item.id}
                  className={`sheet-pill-btn ${sheetId === item.id ? "active" : ""}`}
                  onClick={() => openSheet(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <div className="mode-toggle-group" role="tablist" aria-label="Schematic workbench mode">
                <button role="tab" aria-selected={true} className="mode-toggle-btn active" onClick={() => setMode("viewer")}>Schematic</button>
                <button role="tab" aria-selected={false} className="mode-toggle-btn" onClick={() => setMode("symbols")}>Symbols</button>
                <button role="tab" aria-selected={false} className="mode-toggle-btn" onClick={() => setMode("pdk_sym")}>.sym</button>
              </div>
              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)" }}>{Math.round(zoom * 100)}%</span>
              <button className="icon-button" onClick={resetView} title="Fit to view" aria-label="Fit to view">
                <Icon name="fit" size={13} />
              </button>
            </div>
          </div>

          <div className="diagram-body">
            <div className={`diagram-canvas ${dragStart ? "panning" : ""}`}>
              <svg
                viewBox={`${viewBoxX} ${viewBoxY} ${viewWidth} ${viewHeight}`}
                role="img"
                aria-label={`Schematic sheet ${sheet.path}`}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    setSelectedId(null);
                    setSelectedNet(null);
                  }
                }}
              >
                <defs>
                  <pattern id="schematic-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M20 0H0V20" fill="none" stroke="#16161c" strokeWidth=".6" />
                  </pattern>
                </defs>
                <rect x="-2000" y="-2000" width="6000" height="6000" fill="#09090b" />
                <rect x="-2000" y="-2000" width="6000" height="6000" fill="url(#schematic-grid)" opacity=".75" />

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
                  const isHighlighted = selectedNet !== null && wire.label === selectedNet;
                  return (
                    <g
                      key={`${wire.label ?? "wire"}-${index}`}
                      className={`schematic-wire ${isHighlighted ? "highlighted" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (wire.label) {
                          setSelectedNet((current) => (current === wire.label ? null : wire.label!));
                        }
                      }}
                    >
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
            </div>

            {selected && (
              <aside className="inspector">
                <div className="inspector-heading">
                  <span className="eyebrow">PROPERTIES</span>
                  <button
                    className="pin-remove-btn"
                    onClick={() => setSelectedId(null)}
                    title="Close properties"
                  >
                    ×
                  </button>
                </div>
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
                  <span className="eyebrow">PORTS ({selected.ports.length})</span>
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
                      Open {selected.sheet}
                      <Icon name="chevronRight" size={12} />
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    onClick={() => onOpenFile(selected.sourceFile ?? sourcePathForSheet)}
                  >
                    <Icon name="code" size={12} />
                    Source
                  </button>
                </div>
              </aside>
            )}
          </div>

          <div className="diagram-statusbar">
            <span>
              X: {cursor.x} · Y: {cursor.y} mil
            </span>
            <span>Grid: 20 mil</span>
            <span>{sheet.instances.length} instances</span>
            <span>{sheet.wires.length} nets</span>
            <span className="statusbar-right">
              <span className="status-dot passed" /> ERC / Hierarchy synced
            </span>
          </div>
        </div>
      ) : mode === "symbols" ? (
        <div className="panel diagram-panel symbol-editor-panel">
          <div className="diagram-toolbar">
            <div className="mode-toggle-group" role="tablist" aria-label="Schematic workbench mode">
              <button role="tab" aria-selected={false} className="mode-toggle-btn" onClick={() => setMode("viewer")}>Schematic</button>
              <button role="tab" aria-selected={true} className="mode-toggle-btn active" onClick={() => setMode("symbols")}>Symbols</button>
              <button role="tab" aria-selected={false} className="mode-toggle-btn" onClick={() => setMode("pdk_sym")}>.sym</button>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <button className="secondary-button compact-btn" onClick={createCustomSymbol}>
                <Icon name="plus" size={12} />
                New symbol
              </button>
              <button className="primary-button compact-btn" onClick={placeSymbolOnSheet}>
                <Icon name="check" size={12} />
                Place on {sheet.id} sheet
              </button>
            </div>
          </div>

          <div className="diagram-body symbol-editor-body">
            <aside className="symbol-catalog">
              <div className="inspector-heading">
                <span className="eyebrow">SYMBOLS</span>
                <span>{symbols.length} parts</span>
              </div>
              <div className="symbol-list" role="listbox" aria-label="Component symbol library">
                {symbols.map((item) => (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={item.id === activeSymbol.id}
                    className={`symbol-row ${item.id === activeSymbol.id ? "active" : ""}`}
                    onClick={() => setSelectedSymbolId(item.id)}
                  >
                    <div className="symbol-row-top">
                      <b>{item.name}</b>
                      <DomainTag domain={item.domain} />
                    </div>
                    <small>
                      {item.referencePrefix}? · {item.pdkCell} · {item.pins.length} pins
                    </small>
                  </button>
                ))}
              </div>
            </aside>

            <div className="diagram-canvas">
              <SymbolEditorCanvas symbol={activeSymbol} />
              <div className="diagram-overlay">
                <span className="overlay-chip">ORIGIN (0, 0) CENTERED</span>
                <span className="overlay-chip muted">IEEE / KICAD VECTOR SYMBOL</span>
              </div>
            </div>

            <aside className="inspector symbol-inspector">
              <div className="inspector-heading">
                <span className="eyebrow">SYMBOL PROPERTIES</span>
                <span>{activeSymbol.referencePrefix}?</span>
              </div>

              <label className="field compact-field">
                <span>Symbol name</span>
                <input
                  value={activeSymbol.name}
                  onChange={(event) =>
                    updateSymbol((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>

              <div className="symbol-field-row">
                <label className="field compact-field">
                  <span>Ref prefix</span>
                  <input
                    value={activeSymbol.referencePrefix}
                    maxLength={3}
                    onChange={(event) =>
                      updateSymbol((current) => ({
                        ...current,
                        referencePrefix: event.target.value.toUpperCase() || "U",
                      }))
                    }
                  />
                </label>
                <label className="field compact-field">
                  <span>Graphic</span>
                  <select
                    value={activeSymbol.shape}
                    onChange={(event) =>
                      updateSymbol((current) => ({
                        ...current,
                        shape: event.target.value as CircuitSymbolDef["shape"],
                      }))
                    }
                  >
                    <option value="nmos">NMOS (4T)</option>
                    <option value="pmos">PMOS (4T)</option>
                    <option value="capacitor">Capacitor</option>
                    <option value="resistor">Resistor</option>
                    <option value="isource">Current source</option>
                    <option value="opamp">Op-Amp triangle</option>
                    <option value="dff">Digital DFF</option>
                    <option value="mzi">Photonic MZI</option>
                  </select>
                </label>
              </div>

              <label className="field compact-field">
                <span>PDK / IP cell binding</span>
                <input
                  value={activeSymbol.pdkCell}
                  onChange={(event) =>
                    updateSymbol((current) => ({ ...current, pdkCell: event.target.value }))
                  }
                />
              </label>

              <div className="inspector-section">
                <span className="eyebrow">PINS ({activeSymbol.pins.length})</span>
                <div className="port-list">
                  {activeSymbol.pins.map((pin) => (
                    <div key={pin.number} className="port-row symbol-pin-row">
                      <span className="port-dot" />
                      <b>
                        #{pin.number} {pin.name}
                      </b>
                      <small>
                        {pin.side} · {pin.electricalType.slice(0, 3)}
                      </small>
                      {activeSymbol.pins.length > 1 && (
                        <button
                          className="pin-remove-btn"
                          onClick={() => removePinFromSymbol(pin.number)}
                          title={`Remove pin ${pin.name}`}
                          aria-label={`Remove pin ${pin.name}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pin-add-box">
                  <input
                    placeholder="Pin name (e.g. VBULK)"
                    value={newPinName}
                    onChange={(event) => setNewPinName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addPinToSymbol();
                      }
                    }}
                  />
                  <div className="pin-add-controls">
                    <select
                      value={newPinSide}
                      onChange={(event) => setNewPinSide(event.target.value as SymbolPin["side"])}
                      aria-label="Pin side"
                    >
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                    </select>
                    <select
                      value={newPinType}
                      onChange={(event) =>
                        setNewPinType(event.target.value as SymbolPin["electricalType"])
                      }
                      aria-label="Pin electrical type"
                    >
                      <option value="input">Input</option>
                      <option value="output">Output</option>
                      <option value="passive">Passive</option>
                      <option value="power">Power</option>
                    </select>
                    <button className="secondary-button compact-btn" onClick={addPinToSymbol}>
                      Add pin
                    </button>
                  </div>
                </div>
              </div>

              <div className="inspector-actions">
                <button className="primary-button" onClick={placeSymbolOnSheet}>
                  <Icon name="plus" size={13} />
                  Instantiate on {sheet.id}
                </button>
              </div>
            </aside>
          </div>

          <div className="diagram-statusbar">
            <span>Symbol: {activeSymbol.name}</span>
            <span>Cell: {activeSymbol.pdkCell}</span>
            <span>{activeSymbol.pins.length} pins configured</span>
            <span className="statusbar-right">
              <span className="status-dot passed" /> Symbol library ready
            </span>
          </div>
        </div>
      ) : (
        <div className="panel diagram-panel symbol-editor-panel">
          <div className="diagram-toolbar">
            <div className="mode-toggle-group" role="tablist" aria-label="Schematic workbench mode">
              <button role="tab" aria-selected={false} className="mode-toggle-btn" onClick={() => setMode("viewer")}>Schematic</button>
              <button role="tab" aria-selected={false} className="mode-toggle-btn" onClick={() => setMode("symbols")}>Symbols</button>
              <button role="tab" aria-selected={true} className="mode-toggle-btn active" onClick={() => setMode("pdk_sym")}>.sym</button>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <button
                className={`secondary-button compact-btn ${corruptHashMode ? "danger" : ""}`}
                onClick={() => setCorruptHashMode((prev) => !prev)}
              >
                <Icon name="warning" size={12} />
                {corruptHashMode ? "Restore valid SHA-256" : "Simulate SHA-256 mismatch"}
              </button>
              {parsedSymResult.ok && (
                <button
                  className="primary-button compact-btn"
                  onClick={() => {
                    const symModel = parsedSymResult.symbol;
                    const currentSheet = sheets[sheetId] ?? sheets.top;
                    const count = currentSheet.instances.length + 1;
                    const cellShort =
                      activeSymFixture.assetPath.split("/").pop()?.replace(".sym", "") ?? "sym";
                    const newId = `X${count}`;
                    const newInstance: SchematicInstance = {
                      id: newId,
                      label: cellShort.toUpperCase(),
                      block: `${activeSymFixture.pdkId}://${activeSymFixture.assetPath}`,
                      x: 90 + ((count * 70) % 540),
                      y: 90 + ((count * 50) % 240),
                      width: 152,
                      height: 104,
                      tone: "amber",
                      badge: "IP",
                      symbol: cellShort.includes("pfet")
                        ? "pmos"
                        : cellShort.includes("nfet")
                          ? "nmos"
                          : cellShort.includes("res")
                            ? "resistor"
                            : cellShort.includes("cap")
                              ? "capacitor"
                              : "opamp",
                      sourceFile: activeSymFixture.assetPath,
                      params: [
                        { name: "PDK", value: activeSymFixture.pdkId },
                        { name: "SHA256", value: activeSymFixture.expectedSha256.slice(0, 12) },
                      ],
                      ports: symModel.pins.map((p, idx) => ({
                        name: p.name,
                        side: p.side,
                        offset: Math.min(0.85, Math.max(0.18, (idx + 1) / (symModel.pins.length + 1))),
                      })),
                    };
                    setSheets((prev) => ({
                      ...prev,
                      [sheetId]: {
                        ...currentSheet,
                        instances: [...currentSheet.instances, newInstance],
                      },
                    }));
                    setMode("viewer");
                    setSelectedId(newId);
                    notify?.(`Instantiated verified PDK symbol ${activeSymFixture.assetPath} as ${newId}.`);
                  }}
                >
                  <Icon name="plus" size={12} />
                  Instantiate .sym on {sheet.id}
                </button>
              )}
            </div>
          </div>

          <div className="diagram-body symbol-editor-body">
            <aside className="symbol-catalog">
              <div className="inspector-heading">
                <span className="eyebrow">SKY130A .SYM ASSETS</span>
                <span>{symFixtures.length} files</span>
              </div>
              <div className="symbol-list" role="listbox" aria-label="Sky130A xschem symbol assets">
                {symFixtures.map((fixture) => (
                  <button
                    key={fixture.assetPath}
                    role="option"
                    aria-selected={fixture.assetPath === activeSymFixture.assetPath}
                    className={`symbol-row ${fixture.assetPath === activeSymFixture.assetPath ? "active" : ""}`}
                    onClick={() => {
                      setSelectedSymPath(fixture.assetPath);
                      setCorruptHashMode(false);
                    }}
                  >
                    <div className="symbol-row-top">
                      <b>{fixture.assetPath.split("/").pop()}</b>
                      <DomainTag domain="analog" />
                    </div>
                    <small>
                      {fixture.assetPath} · sha256:{fixture.expectedSha256.slice(0, 8)}…
                    </small>
                  </button>
                ))}
              </div>
            </aside>

            <div className="diagram-canvas">
              {parsedSymResult.ok ? (
                <>
                  <XschemSymCanvas model={parsedSymResult.symbol} />
                  <div className="diagram-overlay">
                    <span className="overlay-chip">
                      SHA-256 VERIFIED · {parsedSymResult.provenance.sha256.slice(0, 12)}…
                    </span>
                    <span className="overlay-chip muted">
                      BBOX: {parsedSymResult.symbol.bbox.width} × {parsedSymResult.symbol.bbox.height} ·{" "}
                      {parsedSymResult.symbol.pins.length} B-5 PINS
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Icon name="warning" size={24} />
                  <b>Integrity Verification Refused ({parsedSymResult.error.code})</b>
                  <span>{parsedSymResult.error.message}</span>
                  <code>expected: {parsedSymResult.error.expectedSha256.slice(0, 24)}…</code>
                  <code>actual:   {parsedSymResult.error.actualSha256.slice(0, 24)}…</code>
                </div>
              )}
            </div>

            <aside className="inspector symbol-inspector">
              <div className="inspector-heading">
                <span className="eyebrow">.SYM PROVENANCE &amp; PINS</span>
                <span>{parsedSymResult.ok ? "VERIFIED" : "REFUSED"}</span>
              </div>
              <dl className="inspector-params">
                <div>
                  <dt>PDK</dt>
                  <dd>{activeSymFixture.pdkId}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{activeSymFixture.pdkRevision.slice(0, 12)}…</dd>
                </div>
                <div>
                  <dt>Asset path</dt>
                  <dd>{activeSymFixture.assetPath}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>{activeSymFixture.expectedSha256.slice(0, 16)}…</dd>
                </div>
              </dl>
              {parsedSymResult.ok && (
                <div className="inspector-section">
                  <span className="eyebrow">
                    EXPLICIT LAYER-5 PINS ({parsedSymResult.symbol.pins.length})
                  </span>
                  <div className="port-list">
                    {parsedSymResult.symbol.pins.map((pin) => (
                      <div key={pin.name} className="port-row">
                        <span className="port-dot" />
                        <b>{pin.name}</b>
                        <small>
                          {pin.dir} · ({pin.x}, {pin.y}) · {pin.side}
                        </small>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>

          <div className="diagram-statusbar">
            <span>Asset: {activeSymFixture.assetPath}</span>
            <span>PDK: {activeSymFixture.pdkId}</span>
            <span>
              {parsedSymResult.ok
                ? `${parsedSymResult.symbol.pins.length} explicit pins · ${parsedSymResult.symbol.lines.length} lines`
                : "Refused on SHA-256 mismatch"}
            </span>
            <span className="statusbar-right">
              <span className={`status-dot ${parsedSymResult.ok ? "passed" : "failed"}`} />{" "}
              {parsedSymResult.ok ? "I29 Verbatim .sym verified" : "Integrity check failed"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
