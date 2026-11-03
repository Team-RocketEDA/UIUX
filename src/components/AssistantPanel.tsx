import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Constraints } from "../api";
import type { Approval, SessionView, ToolStep } from "../agent/fuel";
import { applyUnifiedDiff, describeChanges, type CircuitChange, type Proposal } from "../schematic/changes";
import { useAgent } from "../agent/useAgent";
import type { SurfaceId } from "../types";
import { Icon, type IconName } from "./icons";

const shortPath = (value: string) =>
  value.replace(/^.*?\/((?:design|tests|ip|workflows|results)\/.*|[^/]+\.(?:yaml|yml|md|json))$/, "$1");

// One quiet line per tool call: what it touched, and for simulations what the engine measured.
function stepDetail(step: ToolStep): string {
  const input = step.input as Record<string, unknown>;
  const sources = Array.isArray(input.sources) ? input.sources.filter((item): item is string => typeof item === "string") : [];
  const target = [input.filePath, input.file, ...sources, input.query, input.revision_id, input.block_id]
    .filter((value): value is string => typeof value === "string")
    .map(shortPath)
    .join(" · ");
  if (step.error) return step.error.split("\n")[0];
  if (step.output && (step.tool === "engine_run_spice" || step.tool === "engine_run_job" || step.tool === "engine_get_job_status" || step.tool === "rocket_run_job")) {
    try {
      const result = JSON.parse(step.output);
      const verdict = result.verdict ?? result;
      if (verdict.measurements) {
        return `${verdict.status} · ` + verdict.measurements.map((m: { name: string; value: number | null }) => `${m.name} ${m.value === null ? "—" : m.value.toFixed(2)}`).join(", ");
      }
      if (verdict.status) return `${verdict.status}${verdict.reason ? ` · ${verdict.reason}` : ""}`;
      if (result.ok === false) return result.message ?? result.code;
    } catch {
      return target;
    }
  }
  return target;
}

// "at 14:05", or "tomorrow at 00:43" when the provider backs off past midnight.
function retryTime(next: number) {
  const at = new Date(next);
  const clock = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? `at ${clock}` : `on ${at.toLocaleDateString([], { weekday: "long" })} at ${clock}`;
}

// What an approval's netlist diff does to the circuit, read against the file as it is now.
function CircuitEffect({
  approval,
  readFile,
  onProposal,
}: {
  approval: Approval;
  readFile: (path: string) => Promise<string>;
  onProposal: (proposal?: Proposal) => void;
}) {
  const [changes, setChanges] = useState<CircuitChange[]>();
  const file = approval.files.map(shortPath).find((path) => /\.(cir|sp|spice|net|ckt)$/i.test(path));
  useEffect(() => {
    if (!file || !approval.diff) return;
    let cancelled = false;
    readFile(file)
      .then((text) => {
        const after = applyUnifiedDiff(text, approval.diff!);
        if (cancelled) return;
        const described = after === undefined ? undefined : describeChanges(text, after);
        setChanges(described);
        if (described?.length) onProposal({ file, changes: described });
      })
      .catch(() => undefined);
    // Answered or gone: the schematic stops showing it.
    return () => {
      cancelled = true;
      onProposal(undefined);
    };
  }, [file, approval.diff]);
  if (!changes?.length) return null;
  return (
    <div className="circuit-effect">
      <span className="eyebrow">Effect on the circuit</span>
      <ul>
        {changes.slice(0, 8).map((change, index) => (
          <li key={index}>
            {change.kind === "param" ? (
              <><b className="mono">{change.name}</b> {change.before} → <b>{change.after}</b></>
            ) : change.kind === "device" ? (
              <>
                <b className="mono">{change.device}</b>{" "}
                {change.fields.map((field, i) => (
                  <span key={field.name}>{i ? " · " : ""}{field.name} {field.before} → <b>{field.after}</b></span>
                ))}
              </>
            ) : (
              <><b className="mono">{change.device}</b> {change.kind === "added" ? "added" : "removed"}</>
            )}
          </li>
        ))}
        {changes.length > 8 && <li className="muted">and {changes.length - 8} more</li>}
      </ul>
    </div>
  );
}

function diffLines(diff: string) {
  return diff
    .split("\n")
    .filter((line) => !/^(Index:|={5,}|--- |\+\+\+ )/.test(line))
    .map((line, index) => (
      <span key={index} className={line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-del" : line.startsWith("@@") ? "diff-hunk" : ""}>
        {line || " "}
      </span>
    ));
}

const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Everything the assistant did in this session, newest first: approvals, tool calls, checks and files.
function ActivityView({ view, onOpenFile, onShowChat }: { view: SessionView; onOpenFile: (path: string) => void; onShowChat: () => void }) {
  const steps = [...view.steps].sort((a, b) => b.time - a.time);
  const approvals = [...view.approvals].sort((a, b) => b.time - a.time);
  const checks = Object.entries(view.checks);
  if (!steps.length && !approvals.length && !checks.length) {
    return (
      <div className="assistant-body">
        <p className="assistant-hint">Nothing yet. Tool calls, approvals, engine runs and the files the assistant changes appear here.</p>
      </div>
    );
  }
  return (
    <div className="assistant-body activity">
      {view.iteration && (
        <section>
          <span className="eyebrow">Repair iterations</span>
          <p className={view.iteration.limitReached ? "limit" : ""}>
            {view.iteration.used} of {view.iteration.limit ?? "?"} engine runs used{view.iteration.limitReached ? ". The limit is reached; the assistant stops here." : "."}
          </p>
        </section>
      )}
      {approvals.length > 0 && (
        <section>
          <span className="eyebrow">Approvals</span>
          {approvals.map((approval) => (
            <button key={approval.id} className="activity-row" onClick={approval.status === "pending" ? onShowChat : () => approval.files[0] && onOpenFile(shortPath(approval.files[0]))}>
              <span className={`status-pill ${approval.status === "approved" ? "passed" : approval.status === "rejected" ? "failed" : "running"}`}>{approval.status}</span>
              <span className="activity-text">{approval.label}{approval.files.length ? ` · ${approval.files.map(shortPath).join(", ")}` : ""}</span>
              <time>{clock(approval.time)}</time>
            </button>
          ))}
        </section>
      )}
      {checks.length > 0 && (
        <section>
          <span className="eyebrow">Checks reported</span>
          {checks.map(([name, check]) => (
            <div key={name} className="activity-row">
              <span className={`status-pill ${check.status === "PASS" ? "passed" : check.status === "FAIL" ? "failed" : ""}`}>{check.status.replace("_", " ")}</span>
              <span className="activity-text mono">{name}{check.measured !== undefined ? ` = ${check.measured}` : ""}{check.target ? ` (target ${check.target})` : ""}</span>
            </div>
          ))}
        </section>
      )}
      {view.lastChanges.length > 0 && (
        <section>
          <span className="eyebrow">Files changed</span>
          {view.lastChanges.map((file) => (
            <button key={file} className="activity-row" onClick={() => onOpenFile(shortPath(file))}>
              <Icon name="file" size={12} />
              <span className="activity-text mono">{shortPath(file)}</span>
            </button>
          ))}
        </section>
      )}
      {steps.length > 0 && (
        <section>
          <span className="eyebrow">Tool calls</span>
          {steps.map((step) => (
            <div key={step.id} className={`step ${step.status}`}>
              <span className="step-mark">
                {step.status === "completed" ? <Icon name="check" size={11} /> : step.status === "error" ? <Icon name="x" size={11} /> : <span className="spinner" />}
              </span>
              <span className="step-label">{step.label}</span>
              <span className="step-detail">{stepDetail(step)}</span>
              <time>{clock(step.time)}</time>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function SettingsView({ rows, onEditConstraints, onEvidence }: { rows: [string, string][]; onEditConstraints: () => void; onEvidence: () => void }) {
  return (
    <div className="assistant-body settings">
      <dl className="settings-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="settings-actions">
        <button className="btn" onClick={onEditConstraints}>
          <Icon name="sliders" size={13} />
          Edit autonomy and limits
        </button>
        <button className="btn" onClick={onEvidence}>
          <Icon name="verification" size={13} />
          Open verification evidence
        </button>
      </div>
      <p className="assistant-hint">
        Autonomy and the repair limit live in constraints.yaml (agent.mode, agent.iteration_limit). The model and its key are set where
        the agent runs (rocket_fuel/.env), never in this page.
      </p>
    </div>
  );
}

type Suggestion = { icon: IconName; text: string };

function suggestions(constraints: Constraints): Suggestion[] {
  if ((constraints.checks ?? []).length === 0) {
    return [
      { icon: "sparkles", text: "Design a two-stage op-amp with gain, bandwidth and phase-margin checks" },
      { icon: "sliders", text: "Propose measurable constraints for what I want to build" },
      { icon: "layers", text: "Look for reusable IP before designing from scratch" },
      { icon: "bulb", text: "Explain how a design moves from netlist to verified block here" },
    ];
  }
  return [
    { icon: "sparkles", text: "Bring the design to spec" },
    { icon: "warning", text: "Explain which check fails and why" },
    { icon: "sliders", text: "Improve the margins without breaking other checks" },
    { icon: "layers", text: "Register this design as a reusable block" },
  ];
}

export function AssistantPanel({
  width,
  onClose,
  constraints,
  agentState,
  onOpenFile,
  onNavigate,
  readFile,
  onProposal,
  draft,
}: {
  width: number;
  onClose: () => void;
  constraints: Constraints;
  agentState: string;
  onOpenFile: (path: string) => void;
  onNavigate: (surface: SurfaceId) => void;
  readFile: (path: string) => Promise<string>;
  onProposal: (proposal?: Proposal) => void;
  draft?: { text: string; id: number };
}) {
  const agent = useAgent();
  const { view } = agent;
  const replay = agent.mode === "replay";
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"chat" | "activity" | "settings">("chat");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // A request prepared elsewhere (e.g. an engine tool on the top bar): put it in the box to review and send.
  useEffect(() => {
    if (!draft) return;
    setTab("chat");
    setInput(draft.text);
    composerRef.current?.focus();
  }, [draft?.id]);
  const bodyRef = useRef<HTMLDivElement>(null);

  const approvals = view.approvals.filter((approval) => approval.status === "pending");
  const busy = view.status === "busy";
  const limit = view.iteration?.limit ?? constraints.agent?.iteration_limit ?? 3;
  const used = view.iteration?.used ?? 0;
  const autonomy = constraints.agent?.mode === "auto" ? "Auto" : "Approval";
  const ready = replay || agentState === "ready";
  const live = replay || (agent.connected && ready);
  const error = agent.error ?? view.error;
  const model = (view.model ?? view.replay?.model ?? "").replace(/^opencode\//, "");

  // Messages and tool calls in the order they happened.
  const timeline = [
    ...view.messages.map((message) => ({ kind: "message" as const, time: message.time, message })),
    ...view.steps.map((step) => ({ kind: "step" as const, time: step.time, step })),
  ].sort((a, b) => a.time - b.time);

  useEffect(() => {
    const element = bodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [view]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy || replay || !ready) return;
    setInput("");
    void agent.send(text, autonomy === "Auto" ? "auto" : "approval");
  };

  return (
    <aside className="assistant" style={{ width }} aria-label="Assistant">
      <header className="assistant-head">
        <b>Assistant</b>
        <span
          className={`conn-dot ${live ? "on" : agentState === "starting" ? "wait" : ""}`}
          title={replay ? "Replay of a recorded session" : live ? "Connected" : agentState === "starting" ? "Starting" : "Not connected"}
        />
        {replay && <span className="replay-tag">REPLAY</span>}
        <div className="head-spacer" />
        <button className="ghost-icon" onClick={onClose} aria-label="Close assistant">
          <Icon name="close" size={15} />
        </button>
      </header>
      <div className="assistant-tabs" role="tablist" aria-label="Assistant views">
        {(["chat", "activity", "settings"] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {id[0].toUpperCase() + id.slice(1)}
            {id === "activity" && approvals.length > 0 && <i className="tab-dot" aria-label={`${approvals.length} waiting for approval`} />}
          </button>
        ))}
      </div>

      {tab === "activity" && <ActivityView view={view} onOpenFile={onOpenFile} onShowChat={() => setTab("chat")} />}
      {tab === "settings" && (
        <SettingsView
          rows={[
            ["Connection", replay ? "Replay of a recorded session" : live ? "Connected" : agentState === "starting" ? "Starting" : "Not connected"],
            ["Model", model || "known after the first answer"],
            ["Profile", view.agent ?? (autonomy === "Auto" ? "rocket-auto" : "rocket-approval")],
            ["Autonomy", autonomy === "Auto" ? "Auto: edits apply without asking" : "Approval: you approve each design edit"],
            ["Repair limit", `${limit} engine runs per session (${used} used)`],
          ]}
          onEditConstraints={() => onOpenFile("constraints.yaml")}
          onEvidence={() => onNavigate("verification")}
        />
      )}

      <div className="assistant-body" ref={bodyRef} hidden={tab !== "chat"}>
        {replay && (
          <div className="notice warn">
            Replay of a recorded session{view.replay?.recordedAt ? ` from ${new Date(view.replay.recordedAt).toLocaleString()}` : ""}. Nothing here is running now.
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
        {view.retry && !replay && (
          <div className="notice warn">
            The model isn't answering: {view.retry.message}.{" "}
            {view.retry.next ? `Next try ${retryTime(view.retry.next)}. ` : ""}
            Stop, or switch the model in rocket_fuel/.env and reopen the project.
          </div>
        )}
        {!replay && agentState === "error" && <div className="notice error">The assistant failed to start for this project.</div>}

        {timeline.length === 0 && !replay ? (
          <div className="assistant-empty">
            <h2>{(constraints.checks ?? []).length ? "Design, check, or fix this project" : "What do you want to build?"}</h2>
            <div className="suggestion-grid">
              {suggestions(constraints).map((item) => (
                <button key={item.text} className="suggestion" onClick={() => send(item.text)} disabled={!ready || busy}>
                  <span className="suggestion-icon">
                    <Icon name={item.icon} size={14} />
                  </span>
                  <span className="suggestion-text">{item.text}</span>
                  <Icon name="chevronRight" size={13} />
                </button>
              ))}
            </div>
            {!ready && <p className="assistant-hint">Starting the assistant for this project…</p>}
          </div>
        ) : (
          <div className="timeline">
            {timeline.map((item) =>
              item.kind === "message" ? (
                item.message.role === "user" ? (
                  <div className="msg user" key={item.message.id}>
                    {item.message.text}
                  </div>
                ) : (
                  <div className="msg agent markdown" key={item.message.id}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.message.text}</ReactMarkdown>
                  </div>
                )
              ) : (
                <div className={`step ${item.step.status}`} key={item.step.id}>
                  <span className="step-mark">
                    {item.step.status === "completed" ? (
                      <Icon name="check" size={11} />
                    ) : item.step.status === "error" ? (
                      <Icon name="x" size={11} />
                    ) : (
                      <span className="spinner" />
                    )}
                  </span>
                  <span className="step-label">{item.step.label}</span>
                  <span className="step-detail">{stepDetail(item.step)}</span>
                </div>
              ),
            )}
            {busy && (
              <div className="typing" aria-label="Working">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        )}

        {approvals.map((approval) => (
          <div className="approval" key={approval.id}>
            <div className="approval-top">
              <Icon name="warning" size={14} />
              <b>{approval.label}</b>
              <span>needs your approval</span>
            </div>
            {approval.files.map((file) => (
              <button className="approval-file" key={file} onClick={() => onOpenFile(shortPath(file))}>
                <Icon name="file" size={12} />
                {shortPath(file)}
              </button>
            ))}
            {approval.hypothesis && <p className="approval-why">{approval.hypothesis}</p>}
            {approval.note && <p className="approval-why">{approval.note}</p>}
            {approval.diff && <CircuitEffect approval={approval} readFile={readFile} onProposal={onProposal} />}
            {approval.diff && <pre className="diff">{diffLines(approval.diff)}</pre>}
            <div className="approval-actions">
              <button className="btn" onClick={() => void agent.reject(approval.id)} disabled={replay}>
                Reject
              </button>
              <button className="btn primary" onClick={() => void agent.approve(approval.id)} disabled={replay}>
                Approve
              </button>
            </div>
          </div>
        ))}
      </div>

      <footer className="composer">
        <textarea
          ref={composerRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          rows={2}
          disabled={replay || !ready}
          placeholder={replay ? "Replay is read-only" : ready ? "Ask the assistant to design, check, or fix…" : "Waiting for the assistant…"}
          aria-label="Message the assistant"
        />
        <div className="composer-row">
          {model && <span className="pill">{model}</span>}
          <span className="pill" title="Set in constraints.yaml">{autonomy}</span>
          <span className={`composer-meta ${view.iteration?.limitReached ? "limit" : ""}`}>
            {used}/{limit} repairs
          </span>
          <div className="head-spacer" />
          {busy && !replay ? (
            <button className="send stop" onClick={() => void agent.stop()} aria-label="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button className="send" onClick={() => send(input)} disabled={replay || !ready || !input.trim()} aria-label="Send">
              <Icon name="arrowUp" size={15} />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}
