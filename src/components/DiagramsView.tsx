import { useEffect, useMemo, useState } from "react";
import { api, type FileEntry } from "../api";
import { parseVerilog, type VerilogModule } from "../schematic/verilog";
import { BlockDiagram } from "./BlockDiagram";
import { Icon } from "./icons";
import { SurfaceHeader } from "./ui";

const PICTURE = /\.(png|jpe?g|webp|gif|svg)$/i;
const PAGE = /\.html?$/i;
const VERILOG = /\.(v|sv)$/i;
// Very large sources would take the browser a while to read, for little more detail.
const MAX_SOURCES = 200;
const MAX_SOURCE_BYTES = 2_000_000;

export const viewUrl = (path: string) => `/api/project/view/${path.split("/").map(encodeURIComponent).join("/")}`;

export function visualFiles(entries: FileEntry[]): FileEntry[] {
  const hidden = (path: string) => path.split("/").some((part) => part.startsWith("."));
  const results = (path: string) => /^(results|exports)\//.test(path);
  const score = (path: string) => (/top|chip|arch|mapping/i.test(path) ? 0 : 1) + path.split("/").length;
  return entries
    .filter((entry) => (PICTURE.test(entry.path) || PAGE.test(entry.path)) && !hidden(entry.path) && !results(entry.path))
    .sort((a, b) => score(a.path) - score(b.path) || a.path.localeCompare(b.path));
}

const title = (path: string) =>
  (path.split("/").pop() ?? path)
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/^\d+\s+/, "");

// Everything in the project that shows the design rather than describes it: a block diagram read from its Verilog, and
// the pictures and interactive pages it holds, including any the assistant has drawn.
export function DiagramsView({ entries, onAsk }: { entries: FileEntry[]; onAsk: (text: string) => void }) {
  const visuals = useMemo(() => visualFiles(entries), [entries]);
  const [open, setOpen] = useState<string>();
  const [modules, setModules] = useState<VerilogModule[]>([]);
  const [reading, setReading] = useState(false);
  const sources = useMemo(
    () =>
      entries
        .filter((entry) => VERILOG.test(entry.path) && entry.size <= MAX_SOURCE_BYTES && !/(^|\/)(tb|tests?)(\/|_)|_tb\.|(^|\/)\./.test(entry.path))
        .slice(0, MAX_SOURCES),
    [entries.map((entry) => `${entry.path}:${entry.modified}`).join("|")],
  );

  useEffect(() => {
    let cancelled = false;
    setReading(sources.length > 0);
    void (async () => {
      const parsed: VerilogModule[] = [];
      for (const source of sources) {
        try {
          const { content } = await api.readFile(source.path);
          parsed.push(...parseVerilog(content, source.path));
        } catch {
          // A file that can't be read just isn't drawn.
        }
        if (cancelled) return;
      }
      setModules(parsed);
      setReading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sources]);

  const empty = !visuals.length && !sources.length;
  return (
    <div className="page-surface">
      <SurfaceHeader
        eyebrow="Design"
        title="Diagrams"
        subtitle="The block diagram is read from this project's Verilog. The pictures and pages below come from its files."
        actions={
          <button className="secondary-button" onClick={() => onAsk("Draw a block diagram of this design as an SVG in docs/diagrams/, based on its source files.")}>
            <Icon name="sparkles" size={13} />
            Ask for a diagram
          </button>
        }
      />
      {empty && (
        <div className="empty-state">
          <Icon name="diagram" size={24} />
          <b>No diagrams yet</b>
          <span>A block diagram appears once the project has Verilog. Pictures and HTML pages in the project show up here too, including any the assistant draws in docs/diagrams/.</span>
        </div>
      )}
      {reading && <p className="muted">Reading the Verilog…</p>}
      {modules.length > 0 && <BlockDiagram modules={modules} />}
      {visuals.length > 0 && (
        <section className="diagram-gallery" aria-label="Pictures and pages in this project">
          {visuals.map((file) => (
            <button key={file.path} className="diagram-card" onClick={() => setOpen(file.path)}>
              {PAGE.test(file.path) ? (
                <span className="diagram-thumb page">
                  <iframe src={viewUrl(file.path)} title={file.path} sandbox="allow-scripts" tabIndex={-1} loading="lazy" />
                </span>
              ) : (
                <span className="diagram-thumb">
                  <img src={viewUrl(file.path)} alt="" loading="lazy" />
                </span>
              )}
              <b>{title(file.path)}</b>
              <small>{file.path}</small>
            </button>
          ))}
        </section>
      )}
      {open && (
        <div className="diagram-viewer" role="dialog" aria-modal="true" aria-label={title(open)}>
          <header>
            <b>{title(open)}</b>
            <small>{open}</small>
            <button className="ghost-icon" onClick={() => setOpen(undefined)} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </header>
          {PAGE.test(open) ? <iframe src={viewUrl(open)} title={open} sandbox="allow-scripts" /> : <img src={viewUrl(open)} alt={title(open)} />}
        </div>
      )}
    </div>
  );
}
