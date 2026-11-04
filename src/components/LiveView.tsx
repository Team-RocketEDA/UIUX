import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionView, ToolStep } from "../agent/fuel";
import { highlight, lineDelay, scenesFromSteps, type DiffLine, type Scene } from "../agent/liveScenes";
import { api, formatNumber, type ConstraintCheck, type Evidence, type FileEntry, type ProjectSummary } from "../api";
import { parseVerilog } from "../schematic/verilog";
import { gauge } from "../verification";
import { BlockDiagram } from "./BlockDiagram";
import { useVerilogModules, viewUrl } from "./DiagramsView";
import { drawIn, safeSvg } from "./drawIn";
import { Icon, type IconName } from "./icons";
import { SchematicView } from "./SchematicView";

const HOLD_MS = 900;
const reduced = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function CodeLine({ line, language }: { line: DiffLine; language: Scene["language"] }) {
  return (
    <div className={`code-line ${line.kind}`}>
      <span className="code-number">{line.kind === "remove" ? line.oldNumber : line.newNumber}</span>
      <span className="code-mark">{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}</span>
      <code>
        {highlight(line.text, language ?? "plain").map((token, index) => (
          <span key={index} className={`tok-${token.kind}`}>
            {token.text}
          </span>
        ))}
      </code>
    </div>
  );
}

// Lines arrive one by one, and the counters climb with them.
function CodeScene({ scene, waiting, onDone }: { scene: Scene; waiting: number; onDone: () => void }) {
  const lines = scene.lines ?? [];
  const [shown, setShown] = useState(() => (reduced() ? lines.length : 0));
  const box = useRef<HTMLDivElement>(null);
  const delay = lineDelay(lines.length, waiting);
  useEffect(() => {
    if (shown >= lines.length) {
      const timer = window.setTimeout(onDone, waiting ? HOLD_MS / 2 : HOLD_MS);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setShown((count) => count + 1), delay);
    return () => window.clearTimeout(timer);
  }, [shown, lines.length, delay]);
  useLayoutEffect(() => {
    const element = box.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [shown]);
  const visible = lines.slice(0, shown);
  return (
    <div className="code-scene">
      <header>
        <span className="mono">{scene.file}</span>
        <b className="count-add">+{visible.filter((line) => line.kind === "add").length}</b>
        <b className="count-remove">−{visible.filter((line) => line.kind === "remove").length}</b>
      </header>
      <div className="code-body" ref={box}>
        {visible.map((line, index) => (
          <CodeLine key={index} line={line} language={scene.language} />
        ))}
      </div>
    </div>
  );
}

// Waits for the drawing to be in the page, however it gets there, then draws it.
function useDrawing(box: React.RefObject<HTMLElement | null>, key: string, onDone: () => void, shapesFirst = false) {
  useEffect(() => {
    let timer: number | undefined;
    let started = false;
    const start = () => {
      // The drawing, not an icon: icons are small.
      const usable = [...(box.current?.querySelectorAll<SVGSVGElement>("svg") ?? [])].find((item) => item.getBoundingClientRect().width > 120 && item.querySelector("path, line, rect"));
      if (started || !usable) return;
      started = true;
      observer.disconnect();
      const took = drawIn(usable, { shapesFirst });
      timer = window.setTimeout(onDone, took + HOLD_MS);
    };
    const observer = new MutationObserver(start);
    if (box.current) observer.observe(box.current, { childList: true, subtree: true });
    start();
    // Nothing to draw after a while: move on, rather than hold up the rest.
    const giveUp = window.setTimeout(() => {
      if (!started) onDone();
    }, 6000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(giveUp);
    };
  }, [key]);
}

function SvgDrawing({ scene, onDone }: { scene: Scene; onDone: () => void }) {
  const paper = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const svg = scene.source ? safeSvg(scene.source) : undefined;
    if (!svg) {
      setFailed(true);
      return;
    }
    paper.current?.replaceChildren(svg);
  }, [scene.source]);
  useDrawing(paper, scene.id, onDone);
  if (failed) return <img className="live-paper-image" src={viewUrl(scene.file!)} alt="" onLoad={() => window.setTimeout(onDone, 1500)} onError={onDone} />;
  return <div className="live-paper" ref={paper} />;
}

function BlockScene({ scene, entries, onAsk, onDone }: { scene: Scene; entries: FileEntry[]; onAsk: (text: string) => void; onDone: () => void }) {
  const loaded = useVerilogModules(entries);
  // What was just written may not have reached the file list yet, so it's read from the step itself.
  const modules = useMemo(() => {
    const fresh = scene.source && scene.file ? parseVerilog(scene.source, scene.file) : [];
    const names = new Set(fresh.map((module) => module.name));
    return [...fresh, ...loaded.filter((module) => !names.has(module.name))];
  }, [scene.source, scene.file, loaded]);
  const start = scene.source && scene.file ? parseVerilog(scene.source, scene.file)[0]?.name : undefined;
  const box = useRef<HTMLDivElement>(null);
  useDrawing(box, scene.id, onDone, true);
  return (
    <div className="live-blocks" ref={box}>
      <BlockDiagram bare modules={modules} startModule={start} onAsk={onAsk} />
    </div>
  );
}

function SchematicScene({ scene, onAsk, onOpenFile, onDone }: { scene: Scene; onAsk: (text: string) => void; onOpenFile: (path: string) => void; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDrawing(box, scene.id, onDone);
  return (
    <div className="live-schematic" ref={box}>
      <SchematicView
        paths={[scene.file!]}
        revision={scene.id}
        // From the step itself where it can be: the file may be newer, or in a replay not in this project at all.
        readFile={async (path) => (path === scene.file && scene.source !== undefined ? scene.source : (await api.readFile(path)).content)}
        onOpenFile={onOpenFile}
        onAsk={() => onAsk("")}
        onAskAbout={onAsk}
      />
    </div>
  );
}

function verdictOf(step?: ToolStep) {
  if (!step?.output) return undefined;
  try {
    const result = JSON.parse(step.output);
    return (result.verdict ?? result) as { status?: string; reason?: string; measurements?: { name: string; value: number | null; unit?: string; status: string }[] };
  } catch {
    return undefined;
  }
}

// The check running, its measurements landing on their bars, then the verdict.
function RunScene({ scene, step, checks, onDone, onPlots }: { scene: Scene; step?: ToolStep; checks: ConstraintCheck[]; onDone: () => void; onPlots: () => void }) {
  const verdict = verdictOf(step);
  const finished = step?.status === "completed" || step?.status === "error";
  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(timer);
  }, [finished]);
  const status = verdict?.status;
  return (
    <div className="run-scene">
      <div className={`run-pulse ${finished ? "done" : ""}`}>
        <span />
      </div>
      <h2>{finished ? "Measured by " : "Running in "}{scene.tool}</h2>
      {!finished && <p className="muted">The simulator decides this, not the assistant.</p>}
      <div className="run-bars">
        {(verdict?.measurements ?? []).map((item) => {
          const check = checks.find((candidate) => candidate.metric === item.name);
          const bar = check && typeof item.value === "number" ? gauge(check, item.value) : undefined;
          return (
            <div className="run-bar" key={item.name}>
              <div>
                <b>{check?.title ?? item.name}</b>
                <span className={item.status === "pass" ? "pass" : "fail"}>
                  {formatNumber(item.value)} {item.unit ?? check?.unit ?? ""}
                </span>
              </div>
              {bar && (
                <div className="gauge-bar animate">
                  <span className={`gauge-zone ${bar.passAbove ? "above" : "below"}`} style={bar.passAbove ? { left: `${bar.targetAt}%`, right: 0 } : { left: 0, width: `${bar.targetAt}%` }} />
                  <span className="gauge-target" style={{ left: `${bar.targetAt}%` }} />
                  <span className={`gauge-value ${item.status === "pass" ? "pass" : "fail"}`} style={{ left: `${bar.valueAt}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {status && (
        <div className={`run-verdict ${status === "PASS" ? "pass" : status === "FAIL" ? "fail" : ""}`}>
          <Icon name={status === "PASS" ? "check" : status === "FAIL" ? "x" : "warning"} size={18} />
          {status.replace("_", " ")}
        </div>
      )}
      {finished && verdict?.reason && <p className="muted run-reason">{verdict.reason}</p>}
      {finished && (
        <button className="btn" onClick={onPlots}>
          <Icon name="plot" size={13} />
          Open the plots
        </button>
      )}
    </div>
  );
}

const SCENE_ICON: Record<Scene["kind"], IconName> = { code: "code", drawing: "diagram", run: "play" };

// The build as it happens, as one smooth sequence: code line by line, drawings mark by mark, checks measured. Work done
// faster than it can be shown waits its turn and plays a little quicker. It's all replayable afterwards.
export function LiveView({
  project,
  entries,
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
  const scenes = useMemo(() => scenesFromSteps(steps, project.dir), [steps, project.dir]);
  // Earlier work isn't replayed by itself: playback starts from whatever comes next.
  const [index, setIndex] = useState(scenes.length);
  const [replaying, setReplaying] = useState(false);

  const atEnd = index >= scenes.length;
  // Finished: rest on the last drawing, or the last thing made.
  const restingOn = useMemo(() => [...scenes].reverse().find((scene) => scene.kind === "drawing") ?? scenes[scenes.length - 1], [scenes]);
  const scene = atEnd ? restingOn : scenes[index];
  const waiting = Math.max(0, scenes.length - index - 1);
  const stepOf = (item?: Scene) => steps.find((candidate) => candidate.id === item?.stepId);
  const next = () => setIndex((current) => (current === index ? current + 1 : current));
  useEffect(() => {
    if (atEnd) setReplaying(false);
  }, [atEnd]);
  const resting = atEnd;
  const done = resting ? () => undefined : next;

  const status = !scenes.length ? (busy ? "Planning the build…" : "Ready when you are") : resting ? (busy ? "Thinking about the next step…" : "Finished") : (scene?.title ?? "");

  let stage;
  if (!scene) {
    stage = (
      <div className="live-idle">
        <Icon name="pulse" size={30} />
        <h2>{busy ? "Getting started" : "Nothing built yet"}</h2>
        <p>{busy ? "The first step will appear here in a moment." : "Ask the assistant to build something, and watch it take shape here."}</p>
      </div>
    );
  } else if (scene.kind === "code") {
    stage = <CodeScene key={scene.id} scene={scene} waiting={resting ? 0 : waiting} onDone={done} />;
  } else if (scene.kind === "run") {
    stage = <RunScene key={scene.id} scene={scene} step={stepOf(scene)} checks={project.constraints.checks ?? []} onDone={done} onPlots={() => onNavigate("plots")} />;
  } else if (scene.drawing === "blocks") {
    stage = <BlockScene key={scene.id} scene={scene} entries={entries} onAsk={onAsk} onDone={done} />;
  } else if (scene.drawing === "schematic") {
    stage = <SchematicScene key={scene.id} scene={scene} onAsk={onAsk} onOpenFile={onOpenFile} onDone={done} />;
  } else if (scene.drawing === "svg") {
    stage = <SvgDrawing key={scene.id} scene={scene} onDone={done} />;
  } else if (scene.drawing === "page") {
    stage = <iframe className="live-page" key={scene.id} src={viewUrl(scene.file!)} title={scene.title} sandbox="allow-scripts" onLoad={() => window.setTimeout(done, 2500)} />;
  } else {
    stage = <img className="live-paper-image" key={scene.id} src={viewUrl(scene.file!)} alt={scene.title} onLoad={() => window.setTimeout(done, 1800)} onError={done} />;
  }

  const total = scenes.length;
  const reached = Math.min(index + 1, total);
  return (
    <div className="live">
      <header className="live-bar">
        <span className={`live-dot ${busy || !resting ? "on" : ""}`} />
        <b key={status} className="live-status">
          {status}
        </b>
        <span className="head-spacer" />
        {/* While it's building nobody knows how many steps are left, so a total would only mislead. */}
        {total > 0 && !busy && (
          <span className="live-progress" aria-hidden="true">
            <i style={{ width: `${(100 * reached) / total}%` }} />
          </span>
        )}
        {total > 0 && <span className="muted live-count">{busy ? `Step ${reached}` : `Step ${reached} of ${total}`}</span>}
        {resting && total > 0 && !busy && (
          <button
            className="btn"
            onClick={() => {
              setReplaying(true);
              setIndex(0);
            }}
          >
            <Icon name="refresh" size={13} />
            Replay the build
          </button>
        )}
      </header>
      <section className={`live-stage ${replaying ? "replaying" : ""}`} aria-label="What's being built">
        <div className="live-scene" key={scene?.id ?? "idle"}>
          {stage}
        </div>
      </section>
      {total > 0 && (
        <nav className="live-steps" aria-label="Steps of the build">
          {scenes.map((item, at) => (
            <button
              key={item.id}
              title={item.file ? `${item.title}: ${item.file}` : item.title}
              className={`live-step ${item.kind} ${at === Math.min(index, total - 1) ? "active" : ""} ${at <= index ? "reached" : ""}`}
              onClick={() => setIndex(at)}
            >
              <Icon name={SCENE_ICON[item.kind]} size={12} />
              <span>{item.title.replace(/^Writing the |^Writing a |^Drawing the |^Setting the /, "").replace(/^Simulating with /, "")}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
