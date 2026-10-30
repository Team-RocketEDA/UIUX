import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Constraints } from "../api";
import type { ToolStep } from "../agent/fuel";
import { useAgent } from "../agent/useAgent";
import type { SurfaceId } from "../types";
import { Icon, type IconName } from "./icons";

const shortPath = (value: string) =>
  value.replace(/^.*?\/((?:design|tests|ip|workflows|results)\/.*|[^/]+\.(?:yaml|yml|md|json))$/, "$1");

// One quiet line per tool call: what it touched, and for simulations what the engine measured.
function stepDetail(step: ToolStep): string {
  const input = step.input as Record<string, unknown>;
  const target = [input.filePath, input.file, input.query, input.revision_id, input.block_id]
    .filter((value): value is string => typeof value === "string")
    .map(shortPath)
    .join(" · ");
  if (step.error) return step.error.split("\n")[0];
  if (step.output && (step.tool === "engine_get_job_status" || step.tool === "rocket_run_job")) {
    try {
      const result = JSON.parse(step.output);
      const verdict = result.verdict ?? result;
      if (verdict.measurements) {
        return `${verdict.status} · ` + verdict.measurements.map((m: { name: string; value: number }) => `${m.name} ${m.value.toFixed(2)}`).join(", ");
      }
      if (verdict.status) return `${verdict.status}${verdict.reason ? ` · ${verdict.reason}` : ""}`;
    } catch {
      return target;
    }
  }
  return target;
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
}: {
  width: number;
  onClose: () => void;
  constraints: Constraints;
  agentState: string;
  onOpenFile: (path: string) => void;
  onNavigate: (surface: SurfaceId) => void;
}) {
  const agent = useAgent();
  const { view } = agent;
  const replay = agent.mode === "replay";
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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
        <div className="menu-anchor">
          <button className="ghost-icon" onClick={() => setMenuOpen((open) => !open)} aria-label="Assistant settings" aria-expanded={menuOpen}>
            <Icon name="more" size={16} />
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <div className="menu-row"><span>Model</span><b>{model || "after first message"}</b></div>
              <div className="menu-row"><span>Profile</span><b>{view.agent ?? (autonomy === "Auto" ? "rocket-auto" : "rocket-approval")}</b></div>
              <div className="menu-row"><span>Repair limit</span><b>{limit} iterations</b></div>
              <button className="menu-item" onClick={() => { setMenuOpen(false); onOpenFile("constraints.yaml"); }}>
                Edit autonomy and limits
              </button>
              <button className="menu-item" onClick={() => { setMenuOpen(false); onNavigate("verification"); }}>
                Open verification evidence
              </button>
              <p className="menu-note">The model and its key are set where the agent runs (rocket_fuel/.env), never in this page.</p>
            </div>
          )}
        </div>
        <button className="ghost-icon" onClick={onClose} aria-label="Close assistant">
          <Icon name="close" size={15} />
        </button>
      </header>

      <div className="assistant-body" ref={bodyRef}>
        {replay && (
          <div className="notice warn">
            Replay of a recorded session{view.replay?.recordedAt ? ` from ${new Date(view.replay.recordedAt).toLocaleString()}` : ""}. Nothing here is running now.
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
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
