import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionView, ToolStep } from "../agent/fuel";
import { changedFiles, liveFocus, stepFile, stepKind, type LiveFocus } from "../agent/liveFocus";
import { api, type FileEntry, type Evidence, type ProjectSummary } from "../api";
import { BlockDiagram } from "./BlockDiagram";
import { useVerilogModules, viewUrl } from "./DiagramsView";
import { Icon, type IconName } from "./icons";
import { SchematicView } from "./SchematicView";
import { StatusPill, SurfaceHeader } from "./ui";

const VERILOG = /\.(v|sv)$/i;
const NETLIST = /\.(cir|sp|spice|net|ckt)$/i;
const PICTURE = /\.(png|jpe?g|webp|gif|svg)$/i;
const PAGE = /\.html?$/i;

const STEP_ICON: Record<string, IconName> = { edit: "code", run: "play", read: "file", other: "sparkles" };

function FilePreview({ path, modified }: { path: string; modified?: number }) {
  const [text, setText] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    api.readFile(path).then((file) => !cancelled && setText(file.content)).catch(() => !cancelled && setText(undefined));
    return () => {
      cancelled = true;
    };
  }, [path, modified]);
  if (text === undefined) return <p className="muted live-empty">Waiting for {path}…</p>;
  return <pre className="live-code">{text.length > 60000 ? `${text.slice(0, 60000)}\n…` : text}</pre>;
}

function RunResult({ run, onPlots }: { run?: Evidence; onPlots: () => void }) {
  if (!run) return <p className="muted live-empty">The engine is running a check…</p>;
  const verdict = run.verdict;
  return (
    <div className="live-run">
      <div className="live-run-head">
        <b>Engine verdict</b>
        <StatusPill status={verdict.status === "PASS" ? "passed" : verdict.status === "FAIL" ? "failed" : "skipped"} label={verdict.status} />
        <button className="btn" onClick={onPlots}>
          <Icon name="plot" size={13} />
          Plots
        </button>
      </div>
      {verdict.reason && <p className="muted">{verdict.reason}</p>}
      <table>
        <tbody>
          {(verdict.measurements ?? []).map((measurement) => (
            <tr key={measurement.name}>
              <td className="mono">{measurement.name}</td>
              <td className="mono">
                {measurement.value ?? "-"} {measurement.unit}
              </td>
              <td>
                <StatusPill status={measurement.status === "pass" ? "passed" : "failed"} label={measurement.status.toUpperCase()} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Watch the design take shape: whichever file the assistant just wrote, drawn as what it is rather than as text, next to
// a timeline of what it did. Click parts of a drawing to point the assistant at them.
export function LiveView({
  project,
  entries,
  evidence,
  activity,
  onAsk,
  onOpenFile,
  onNavigate,
}: {
  project: ProjectSummary;
  entries: FileEntry[];
  evidence: Evidence[];
  activity?: SessionView;
  onAsk: (text: string) => void;
  onOpenFile: (path: string) => void;
  onNavigate: (surface: "plots" | "diagrams") => void;
}) {
  const steps = activity?.steps ?? [];
  const busy = activity?.status === "busy";
  const [follow, setFollow] = useState(true);
  const [pinned, setPinned] = useState<LiveFocus>({ kind: "none" });
  const latest = useMemo(() => liveFocus(steps, project.dir), [steps, project.dir]);
  const changed = useMemo(() => changedFiles(steps, project.dir), [steps, project.dir]);
  const modules = useVerilogModules(entries);
  const focus = follow ? latest : pinned;
  const focusPath = focus.kind === "file" ? focus.path : undefined;
  const modified = entries.find((entry) => entry.path === focusPath)?.modified;

  // Blocks that weren't there when this page opened are new, and marked as such.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!known.current && (modules.length || !entries.some((entry) => VERILOG.test(entry.path)))) {
      known.current = new Set(modules.flatMap((module) => module.instances.map((instance) => `${module.name}/${instance.name}`)));
    }
  }, [modules, entries]);
  const isNew = (module: string, instance: string) => Boolean(known.current) && !known.current!.has(`${module}/${instance}`);

  const pick = (step: ToolStep) => {
    const kind = stepKind(step);
    const path = stepFile(step, project.dir);
    setFollow(false);
    if (kind === "run") setPinned({ kind: "run", stepId: step.id });
    else if (path) setPinned({ kind: "file", path });
  };

  const timeline = [...steps].sort((a, b) => b.time - a.time).filter((step) => stepKind(step) !== "read");
  const running = timeline.find((step) => step.status === "running" || step.status === "pending");
  const fallbackNetlist = entries.find((entry) => NETLIST.test(entry.path) && entry.path.startsWith("design/"));
  const moduleInFile = focusPath ? modules.find((module) => module.file === focusPath)?.name : undefined;

  let stage;
  if (focus.kind === "run") {
    stage = <RunResult run={evidence[0]} onPlots={() => onNavigate("plots")} />;
  } else if (focusPath && VERILOG.test(focusPath) && modules.length) {
    stage = <BlockDiagram modules={modules} startModule={moduleInFile} changedFiles={changed} isNew={isNew} onAsk={onAsk} />;
  } else if (focusPath && NETLIST.test(focusPath)) {
    stage = (
      <div className="live-schematic">
        <SchematicView
          paths={[focusPath]}
          revision={String(modified ?? "")}
          readFile={async (path) => (await api.readFile(path)).content}
          onOpenFile={onOpenFile}
          onAsk={() => onAsk("")}
          onAskAbout={onAsk}
        />
      </div>
    );
  } else if (focusPath && PICTURE.test(focusPath)) {
    stage = <img className="live-picture" src={`${viewUrl(focusPath)}?v=${modified ?? 0}`} alt={focusPath} />;
  } else if (focusPath && PAGE.test(focusPath)) {
    stage = <iframe className="live-page" key={`${focusPath}-${modified}`} src={viewUrl(focusPath)} title={focusPath} sandbox="allow-scripts" />;
  } else if (focusPath) {
    stage = <FilePreview path={focusPath} modified={modified} />;
  } else if (modules.length) {
    stage = <BlockDiagram modules={modules} changedFiles={changed} isNew={isNew} onAsk={onAsk} />;
  } else if (fallbackNetlist) {
    stage = (
      <div className="live-schematic">
        <SchematicView
          paths={[fallbackNetlist.path]}
          revision={String(fallbackNetlist.modified)}
          readFile={async (path) => (await api.readFile(path)).content}
          onOpenFile={onOpenFile}
          onAsk={() => onAsk("")}
          onAskAbout={onAsk}
        />
      </div>
    );
  } else {
    stage = (
      <div className="empty-state">
        <Icon name="pulse" size={24} />
        <b>Nothing built yet</b>
        <span>Ask the assistant to build something. Each file it writes appears here, drawn as a diagram, schematic or picture.</span>
      </div>
    );
  }

  return (
    <div className="page-surface live">
      <SurfaceHeader
        eyebrow={busy ? "The assistant is working" : "Project"}
        title="Live build"
        subtitle={running ? running.label : busy ? "Thinking about the next step…" : steps.length ? "Finished. Click any step to look at it again." : "What the assistant builds shows up here as it happens."}
        actions={
          <label className={`live-follow ${follow ? "on" : ""}`}>
            <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
            Follow the assistant
          </label>
        }
      />
      <div className="live-grid">
        <section className="live-stage" aria-label="What's being built">
          {focusPath && (
            <div className="live-stage-head">
              {busy && <span className="live-dot" />}
              <button onClick={() => onOpenFile(focusPath)} title="Open this file">
                {focusPath}
              </button>
            </div>
          )}
          {stage}
        </section>
        <aside className="live-timeline" aria-label="What the assistant did">
          <span className="eyebrow">
            {changed.size} file{changed.size === 1 ? "" : "s"} changed · {timeline.filter((step) => stepKind(step) === "run").length} run{timeline.filter((step) => stepKind(step) === "run").length === 1 ? "" : "s"}
          </span>
          {timeline.length === 0 && <p className="muted">No steps yet.</p>}
          {timeline.map((step) => {
            const path = stepFile(step, project.dir);
            const active = (focus.kind === "run" && focus.stepId === step.id) || (focus.kind === "file" && path === focus.path);
            return (
              <button key={step.id} className={`live-step ${step.status} ${active ? "active" : ""}`} onClick={() => pick(step)}>
                <Icon name={step.status === "error" ? "warning" : STEP_ICON[stepKind(step)]} size={13} />
                <span>
                  <b>{step.label}</b>
                  {path && <small>{path}</small>}
                  {step.error && <small className="live-step-error">{step.error.split("\n")[0].slice(0, 110)}</small>}
                </span>
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
