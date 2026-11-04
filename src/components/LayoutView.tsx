import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { canvasPicture, segmentView } from "../agent/attachments";
import { api } from "../api";
import { flatten, parseGds, type Flat, type Library } from "../layout/gds";
import { Icon } from "./icons";
import { SurfaceHeader } from "./ui";

// Layout viewer for the project's own GDS files: read in the browser, flattened from a top cell,
// drawn per layer. Nothing is drawn unless the project has a layout.

const LAYOUT = /\.(gds|gds2|gdsii)$/i;
const OTHER_LAYOUT = /\.(oas|oasis)$/i;
const COLORS = ["#3987e5", "#d95926", "#4fb37a", "#c9a227", "#a66ad6", "#3fb5c4", "#e0607e", "#8f9b3a", "#6f7fe8", "#d98b3a", "#5aa894", "#b8678f"];

type View = { cx: number; cy: number; scale: number }; // centre in dbu, dbu per CSS pixel

export function LayoutView({
  paths,
  revision,
  klayout,
  onAsk,
  onOpenFile,
}: {
  paths: string[];
  revision: string;
  klayout: boolean;
  onAsk: () => void;
  onOpenFile: (path: string) => void;
}) {
  const layouts = useMemo(() => paths.filter((path) => LAYOUT.test(path)), [paths]);
  const others = useMemo(() => paths.filter((path) => OTHER_LAYOUT.test(path)), [paths]);
  const [path, setPath] = useState<string>();
  const active = path && layouts.includes(path) ? path : layouts[0];
  const [library, setLibrary] = useState<Library>();
  const [error, setError] = useState<string>();
  const [cell, setCell] = useState<string>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>();
  const [pointer, setPointer] = useState<[number, number]>();
  const [notice, setNotice] = useState<string>();
  const [findText, setFindText] = useState("");
  const [finding, setFinding] = useState(false);
  const [findStatus, setFindStatus] = useState<string>();
  const [found, setFound] = useState<{ boxes: { x1: number; y1: number; x2: number; y2: number }[] }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError(undefined);
    api
      .rawFile(active)
      .then((buffer) => {
        if (cancelled) return;
        const lib = parseGds(buffer);
        if (!lib.cells.size) throw new Error("No cells found; is this a GDSII file?");
        setLibrary(lib);
        setCell((current) => (current && lib.cells.has(current) ? current : lib.tops[0] ?? [...lib.cells.keys()][0]));
      })
      .catch((err) => !cancelled && (setLibrary(undefined), setError(err instanceof Error ? err.message : String(err))));
    return () => {
      cancelled = true;
    };
  }, [active, revision]);

  const flat: Flat | undefined = useMemo(() => (library && cell ? flatten(library, cell) : undefined), [library, cell]);
  const colors = useMemo(() => new Map(flat?.layers.map((layer, i) => [layer.id, COLORS[i % COLORS.length]])), [flat]);
  const um = (dbu: number) => (library ? dbu * library.dbuInMeters * 1e6 : dbu);

  // SAM 3.1 looks at the view as drawn. Its boxes come back in the picture's pixels; they're kept in layout
  // coordinates, so they stay on the shapes when the view moves.
  async function find() {
    const canvas = canvasRef.current;
    const prompt = findText.trim();
    if (!canvas || !view || !prompt || finding) return;
    setFinding(true);
    setFindStatus(undefined);
    setFound(undefined);
    try {
      const { boxes } = await segmentView(canvasPicture(canvas), prompt);
      const toX = (px: number, w: number) => ((px / w) * size[0] - size[0] / 2) * view.scale + view.cx;
      const toY = (py: number, h: number) => view.cy - ((py / h) * size[1] - size[1] / 2) * view.scale;
      setFound({ boxes: boxes.map((b) => ({ x1: toX(b.x1, b.w), y1: toY(b.y1, b.h), x2: toX(b.x2, b.w), y2: toY(b.y2, b.h) })) });
      setFindStatus(boxes.length ? `${boxes.length} found by SAM 3.1` : "SAM 3.1 found none here");
    } catch (err) {
      setFindStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setFinding(false);
    }
  }

  // Track the canvas size.
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize([entry.contentRect.width, entry.contentRect.height]));
    observer.observe(element);
    return () => observer.disconnect();
  }, [flat !== undefined]);

  const fit = (): View | undefined => {
    if (!flat || !size[0]) return undefined;
    const [x0, y0, x1, y1] = flat.bounds;
    const scale = Math.max((x1 - x0) / (size[0] - 48), (y1 - y0) / (size[1] - 48), 1e-9);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale };
  };
  useEffect(() => setView(fit()), [flat, size[0] > 0]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !flat || !view || !size[0]) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size[0] * ratio);
    canvas.height = Math.round(size[1] * ratio);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size[0], size[1]);
    const sx = (x: number) => (x - view.cx) / view.scale + size[0] / 2;
    const sy = (y: number) => size[1] / 2 - (y - view.cy) / view.scale;
    for (const layer of flat.layers) {
      if (hidden.has(layer.id)) continue;
      const color = colors.get(layer.id)!;
      ctx.fillStyle = color + "55";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (const shape of flat.shapes) {
        if (shape.layer !== layer.id) continue;
        ctx.beginPath();
        shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        if (shape.width !== undefined) {
          ctx.save();
          ctx.lineWidth = Math.max(1, shape.width / view.scale);
          ctx.strokeStyle = color + "aa";
          ctx.lineCap = "square";
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    // What SAM 3.1 found, in layout coordinates so it stays put when panning and zooming.
    if (found) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffd3c6";
      ctx.fillStyle = "rgba(238, 106, 76, 0.28)";
      for (const box of found.boxes) {
        const [x, y] = [sx(box.x1), sy(box.y1)];
        ctx.fillRect(x, y, sx(box.x2) - x, sy(box.y2) - y);
        ctx.strokeRect(x, y, sx(box.x2) - x, sy(box.y2) - y);
      }
    }
    // Labels once there is room to read them.
    if (flat.labels.length < 400) {
      ctx.font = "11px JetBrains Mono, ui-monospace, monospace";
      ctx.fillStyle = "#ecebe8";
      for (const label of flat.labels) {
        if (hidden.has(label.layer)) continue;
        ctx.fillText(label.text, sx(label.at[0]) + 3, sy(label.at[1]) - 3);
      }
    }
  }, [flat, view, size, hidden, colors, found]);

  const toWorld = (clientX: number, clientY: number): [number, number] | undefined => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !view) return undefined;
    return [view.cx + (clientX - rect.left - size[0] / 2) * view.scale, view.cy - (clientY - rect.top - size[1] / 2) * view.scale];
  };
  const zoom = (factor: number, around?: [number, number]) => {
    if (!view) return;
    const [px, py] = around ?? [view.cx, view.cy];
    setView({ cx: px + (view.cx - px) * factor, cy: py + (view.cy - py) * factor, scale: view.scale * factor });
  };
  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, toWorld(event.clientX, event.clientY));
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    drag.current = { x: event.clientX, y: event.clientY, view };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    setPointer(toWorld(event.clientX, event.clientY));
    if (!drag.current) return;
    const { x, y, view: start } = drag.current;
    setView({ ...start, cx: start.cx - (event.clientX - x) * start.scale, cy: start.cy + (event.clientY - y) * start.scale });
  };

  const openInKlayout = async () => {
    if (!active) return;
    try {
      await api.openInKlayout(active);
      setNotice(`Opened ${active} in KLayout.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const header = (
    <SurfaceHeader
      eyebrow={active ? `Physical design · ${active}` : "Physical design"}
      title="Layout viewer"
      subtitle="The project's GDS, read and drawn here. Drag to pan, scroll to zoom, toggle layers on the right."
      actions={
        <>
          {active && (
            <button className="btn" onClick={() => onOpenFile(active)} title="The file in the explorer">
              <Icon name="file" size={13} />
              File
            </button>
          )}
          <button
            className="btn"
            onClick={() => void openInKlayout()}
            disabled={!active || !klayout}
            title={klayout ? "Open this file in KLayout on this machine" : "KLayout is not installed on this machine"}
          >
            <Icon name="external" size={13} />
            Open in KLayout
          </button>
        </>
      }
    />
  );

  if (!layouts.length) {
    return (
      <div className="page-surface">
        {header}
        <div className="empty-state">
          <Icon name="layout" size={24} />
          <b>No layout in this project yet</b>
          <span>
            A layout appears here once the project has a GDS file{others.length ? ` (found ${others.join(", ")}: OASIS opens in KLayout only)` : ""}. Layout flows (GDSFactory,
            LibreLane, Magic) write one; Rocket Engine then runs DRC, extraction and LVS on it.
            {!klayout && " KLayout is not installed on this machine."}
          </span>
          <button className="btn primary" onClick={onAsk}>
            <Icon name="sparkles" size={13} />
            Ask the assistant about a layout
          </button>
        </div>
      </div>
    );
  }

  const [x0, y0, x1, y1] = flat?.bounds ?? [0, 0, 0, 0];
  return (
    <div className="fill-surface layout-page">
      {header}
      {notice && <div className="notice warn">{notice}</div>}
      <div className="schematic-pickers">
        {library && library.cells.size > 1 && (
          <label className="cell-select">
            <span className="eyebrow">Cell</span>
            <select value={cell} onChange={(event) => setCell(event.target.value)}>
              {[...library.tops, ...[...library.cells.keys()].filter((name) => !library.tops.includes(name)).sort()].map((name) => (
                <option key={name} value={name}>
                  {name}
                  {library.tops.includes(name) ? " (top)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="head-spacer" />
        {layouts.length > 1 && (
          <div className="segmented" role="tablist" aria-label="Layout file">
            {layouts.map((file) => (
              <button key={file} className={file === active ? "active" : ""} onClick={() => setPath(file)}>{file}</button>
            ))}
          </div>
        )}
      </div>
      {error ? (
        <div className="notice error">Could not read {active}: {error}</div>
      ) : !flat ? (
        <div className="schematic-loading">Reading {active}…</div>
      ) : (
        <div className="schematic-body">
          <div className="schematic-canvas layout-canvas" ref={wrapRef}>
            <div className="schematic-tools">
              <button className="ghost-icon" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in"><Icon name="zoomIn" size={15} /></button>
              <button className="ghost-icon" onClick={() => zoom(1.25)} aria-label="Zoom out"><Icon name="zoomOut" size={15} /></button>
              <button className="ghost-icon" onClick={() => setView(fit())} aria-label="Fit"><Icon name="fit" size={15} /></button>
            </div>
            <canvas
              ref={canvasRef}
              style={{ width: size[0], height: size[1] }}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerLeave={() => setPointer(undefined)}
              aria-label={`Layout of ${cell}`}
              role="img"
            />
            <form
              className="layout-find"
              onSubmit={(event) => {
                event.preventDefault();
                void find();
              }}
            >
              <Icon name="search" size={13} />
              <input
                value={findText}
                onChange={(event) => setFindText(event.target.value)}
                placeholder="Find in layout: power rails…"
                aria-label="Find in layout with SAM 3.1"
                title="SAM 3.1 looks at this view and marks what you name"
              />
              {finding ? (
                <span className="layout-find-status">Looking…</span>
              ) : findStatus ? (
                <>
                  <span className="layout-find-status">{findStatus}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setFound(undefined);
                      setFindStatus(undefined);
                    }}
                  >
                    Clear
                  </button>
                </>
              ) : null}
            </form>
            <div className="schematic-hint">
              {pointer ? `x ${um(pointer[0]).toFixed(3)} µm · y ${um(pointer[1]).toFixed(3)} µm` : "Scroll to zoom · drag to pan"}
            </div>
          </div>
          <aside className="schematic-inspector">
            <span className="eyebrow">Layers</span>
            <div className="layer-list">
              {flat.layers.map((layer) => (
                <label key={layer.id} className={`layer-row ${hidden.has(layer.id) ? "off" : ""}`}>
                  <input
                    type="checkbox"
                    checked={!hidden.has(layer.id)}
                    onChange={() =>
                      setHidden((previous) => {
                        const next = new Set(previous);
                        if (next.has(layer.id)) next.delete(layer.id);
                        else next.add(layer.id);
                        return next;
                      })
                    }
                  />
                  <span className="layer-swatch" style={{ background: colors.get(layer.id) }} />
                  <span className="mono">{layer.id}</span>
                  <span className="muted">{layer.count}</span>
                </label>
              ))}
            </div>
            <span className="eyebrow">Artifact</span>
            <dl className="kv">
              <div className="kv-row"><dt>Library</dt><dd className="mono">{library?.name}</dd></div>
              <div className="kv-row"><dt>Cell</dt><dd className="mono">{cell}</dd></div>
              <div className="kv-row"><dt>Size</dt><dd>{um(x1 - x0).toFixed(2)} × {um(y1 - y0).toFixed(2)} µm</dd></div>
              <div className="kv-row"><dt>Shapes</dt><dd>{flat.shapes.length.toLocaleString()}{flat.truncated ? " (first ones only)" : ""}</dd></div>
              <div className="kv-row"><dt>Instances</dt><dd>{flat.instances.toLocaleString()}</dd></div>
              <div className="kv-row"><dt>Cells</dt><dd>{library?.cells.size}</dd></div>
              <div className="kv-row"><dt>Units</dt><dd>{library ? `${(library.dbuInMeters * 1e9).toPrecision(3)} nm / dbu` : ""}</dd></div>
            </dl>
            <p className="muted layout-note">A drawing of the file, not signoff: DRC and LVS come from the engine's run_drc and run_lvs.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
