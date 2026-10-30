import { useEffect, useRef, useState } from "react";
import type { Constraints } from "../api";
import type { ToolStep } from "../agent/fuel";
import { useAgent } from "../agent/useAgent";
import type { SurfaceId } from "../types";
import { Icon } from "./icons";

export type AssistantTab = "chat" | "activity" | "settings";

type StepStatus = "completed" | "failed" | "running" | "pending";

const stepLabel: Record<StepStatus, string> = {
  completed: "DONE",
  failed: "FAILED",
  running: "RUNNING",
  pending: "PENDING",
};

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const shortPath = (value: string) => value.replace(/^.*?\/(design|tests|ip|workflows|results)\//, "$1/");

// One line describing a tool call: what it touched, and for simulations what the engine measured.
function stepDetail(step: ToolStep): string {
  const input = step.input as Record<string, unknown>;
  const target = [input.filePath, input.file, input.kind, input.query, input.revision_id, input.block_id, input.run_id]
    .filter((value): value is string => typeof value === "string")
    .map(shortPath)
    .join(" · ");
  if (step.error) return `${target ? target + " · " : ""}${step.error}`;
  if (step.output && (step.tool === "engine_get_job_status" || step.tool === "rocket_run_job")) {
    try {
      const result = JSON.parse(step.output);
      const verdict = result.verdict ?? result;
      if (verdict.measurements) {
        return verdict.measurements.map((m: { name: string; value: number; status: string }) => `${m.name} ${m.value.toFixed(2)} ${m.status}`).join(" · ");
      }
      if (result.checks) {
        return Object.entries(result.checks as Record<string, { status: string; measured?: number }>)
          .map(([id, c]) => `${id.split(".").pop()} ${c.measured ?? ""} ${c.status}`)
          .join(" · ");
      }
      if (verdict.status) return `${verdict.status}${verdict.reason ? `: ${verdict.reason}` : ""}`;
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
      <span key={index} className={line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-del" : ""}>
        {line || " "}
      </span>
    ));
}

export function AssistantPanel({
  width,
  tab,
  onTabChange,
  onClose,
  hidden,
  constraints,
  agentState,
  onOpenFile,
  onNavigate,
}: {
  width: number;
  tab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
  onClose: () => void;
  hidden: boolean;
  constraints: Constraints;
  agentState: string;
  onOpenFile: (path: string) => void;
  onNavigate: (surface: SurfaceId) => void;
}) {
  const agent = useAgent();
  const { view } = agent;
  const replay = agent.mode === "replay";
  const [input, setInput] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const approvals = view.approvals.filter((approval) => approval.status === "pending");
  const busy = view.status === "busy";
  const limit = view.iteration?.limit ?? constraints.agent?.iteration_limit ?? 3;
  const used = view.iteration?.used ?? 0;
  const autonomy = constraints.agent?.mode === "auto" ? "auto" : "approval";
  const ready = replay || agentState === "ready";
  const error = agent.error ?? view.error;
  const steps = view.steps.slice().reverse();
  const quickPrompts = replay
    ? []
    : (constraints.checks ?? []).length
      ? ["Bring the design to spec", "Explain the failing check", "Register it as a reusable block"]
      : ["Propose a design and its checks for this project"];

  useEffect(() => {
    const element = chatRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [view, tab]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy || replay || !ready) return;
    setInput("");
    void agent.send(text, autonomy === "auto" ? "auto" : "approval");
  };

  return (
    <aside className="assistant-panel" style={{ width }} hidden={hidden}>
      <header className="assistant-header">
        <div className="assistant-title">
          <span className="assistant-mark">
            <Icon name="sparkles" size={15} />
          </span>
          <div>
            <b>Rocket assistant</b>
            <span>Rocket Fuel · {view.model ?? view.replay?.model ?? "model chosen by the agent"}</span>
          </div>
        </div>
        <div className="assistant-header-actions">
          {replay ? (
            <span className="live-pill replay">
              <i />
              REPLAY
            </span>
          ) : (
            <span className={`live-pill ${agent.connected && ready ? "" : "offline"}`}>
              <i />
              {agent.connected && ready ? "LIVE" : agentState === "starting" ? "STARTING" : "OFFLINE"}
            </span>
          )}
          <button className="icon-button" onClick={onClose} title="Close assistant" aria-label="Close assistant">
            <Icon name="close" size={15} />
          </button>
        </div>
      </header>

      <div className="assistant-tabs" role="tablist" aria-label="Assistant views">
        {(
          [
            ["chat", "Chat"],
            ["activity", "Activity"],
            ["settings", "Settings"],
          ] as [AssistantTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`assistant-tab ${tab === id ? "active" : ""}`}
            onClick={() => onTabChange(id)}
          >
            {label}
            {id === "activity" && approvals.length > 0 && <span className="tab-dot" />}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <>
          <div className="assistant-chat" ref={chatRef}>
            {replay && (
              <div className="replay-banner">
                <b>REPLAY</b> of a recorded session
                {view.replay?.recordedAt && ` · ${new Date(view.replay.recordedAt).toLocaleString()}`}
                {view.replay?.model && ` · ${view.replay.model}`}. Nothing here is running now.
              </div>
            )}
            {error && <div className="agent-error">{error}</div>}
            {!replay && agentState === "error" && <div className="agent-error">The assistant failed to start for this project.</div>}
            {view.messages.length === 0 && !replay && (
              <p className="agent-empty">
                {ready
                  ? "Describe what you want designed or fixed. The assistant edits files in design/ and tests/, runs the checks on the engine, and asks before changes."
                  : "Starting the assistant for this project…"}
              </p>
            )}
            {view.messages.map((message) => (
              <div className={`assistant-message ${message.role}`} key={message.id}>
                {message.role === "agent" && (
                  <span className="assistant-avatar">
                    <Icon name="sparkles" size={12} />
                  </span>
                )}
                <div className="message-body">
                  <div className="message-meta">
                    <b>{message.role === "agent" ? "Rocket" : "You"}</b>
                    <span>{formatTime(message.time)}</span>
                  </div>
                  <p>{message.text}</p>
                </div>
              </div>
            ))}

            {busy && (
              <div className="assistant-message agent">
                <span className="assistant-avatar">
                  <Icon name="sparkles" size={12} />
                </span>
                <div className="message-body">
                  <div className="typing-indicator">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}

            {approvals.map((approval) => (
              <div className="approval-card" key={approval.id}>
                <div className="approval-heading">
                  <span className="approval-title">
                    <Icon name="warning" size={14} />
                    Approval required: {approval.label}
                  </span>
                  <span className="approval-tool">{approval.permission}</span>
                </div>
                {approval.files.map((file) => (
                  <button className="approval-path" key={file} onClick={() => onOpenFile(shortPath(file))}>
                    <Icon name="file" size={12} />
                    {shortPath(file)}
                  </button>
                ))}
                {approval.hypothesis && <p className="approval-desc">{approval.hypothesis}</p>}
                {approval.note && <p className="approval-desc">{approval.note}</p>}
                {approval.diff && <pre className="diff-block">{diffLines(approval.diff)}</pre>}
                <div className="approval-actions">
                  <button className="secondary-button" onClick={() => void agent.reject(approval.id)} disabled={replay}>
                    Reject
                  </button>
                  <button className="primary-button" onClick={() => void agent.approve(approval.id)} disabled={replay}>
                    <Icon name="check" size={13} />
                    Approve
                  </button>
                </div>
                <small className="approval-note">The assistant waits for your answer. Rejecting changes nothing.</small>
              </div>
            ))}
          </div>

          <div className="assistant-composer">
            <div className="quick-prompts">
              {quickPrompts.map((prompt) => (
                <button key={prompt} onClick={() => send(prompt)} disabled={busy || !ready}>
                  {prompt}
                </button>
              ))}
            </div>
            <div className="composer-box">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    send(input);
                  }
                }}
                rows={2}
                disabled={replay || !ready}
                placeholder={replay ? "Replay is read-only" : ready ? "Describe a design change or ask for evidence…" : "Waiting for the assistant…"}
                aria-label="Message the assistant"
              />
              <div className="composer-actions">
                <span className={`composer-context ${view.iteration?.limitReached ? "limit" : ""}`}>
                  {used}/{limit} iterations · {autonomy}
                </span>
                {busy && !replay ? (
                  <button className="secondary-button" onClick={() => void agent.stop()}>
                    Stop
                  </button>
                ) : (
                  <button className="primary-button" onClick={() => send(input)} disabled={replay || !ready || !input.trim()}>
                    Send
                    <Icon name="chevronRight" size={13} />
                  </button>
                )}
              </div>
            </div>
            <small className="composer-note">⌘ / Ctrl + Enter to send · design edits ask for approval</small>
          </div>
        </>
      )}

      {tab === "activity" && (
        <div className="assistant-scroll">
          <div className="activity-summary">
            <div>
              <span className="eyebrow">ITERATION</span>
              <b>
                {used}/{limit}
              </b>
            </div>
            <div>
              <span className="eyebrow">PENDING</span>
              <b className={approvals.length ? "pending" : ""}>{approvals.length}</b>
            </div>
            <div>
              <span className="eyebrow">TOOL CALLS</span>
              <b>{view.steps.length}</b>
            </div>
          </div>

          {approvals.length > 0 && (
            <div className="approval-banner">
              <Icon name="warning" size={15} />
              <div>
                <b>{approvals.length === 1 ? "Change waiting for approval" : `${approvals.length} changes waiting for approval`}</b>
                <span>{approvals.map((approval) => approval.label).join(" · ")}</span>
              </div>
              <button className="secondary-button" onClick={() => onTabChange("chat")}>
                Review
              </button>
            </div>
          )}

          {steps.length === 0 && <p className="agent-empty">No tool calls yet in this session.</p>}
          <div className="step-list">
            {steps.map((step) => {
              const status: StepStatus = step.status === "error" ? "failed" : step.status;
              return (
                <div className={`step-row ${status}`} key={step.id}>
                  <span className={`step-icon ${status}`}>
                    {status === "completed" ? (
                      <Icon name="check" size={11} />
                    ) : status === "failed" ? (
                      <Icon name="x" size={11} />
                    ) : status === "pending" ? (
                      <Icon name="clock" size={11} />
                    ) : (
                      <span className="spinner" />
                    )}
                  </span>
                  <div className="step-copy">
                    <b>{step.label}</b>
                    <span>{stepDetail(step)}</span>
                    <small>
                      {step.tool} · {formatTime(step.time)}
                    </small>
                  </div>
                  <span className={`step-state ${status}`}>{stepLabel[status]}</span>
                </div>
              );
            })}
          </div>

          <div className="activity-footer">
            <button className="secondary-button" onClick={() => onNavigate("verification")}>
              <Icon name="verification" size={13} />
              Open verification evidence
            </button>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div className="assistant-scroll settings-scroll">
          <div className="settings-heading">
            <div>
              <span className="eyebrow">AGENT</span>
              <h3>Rocket Fuel</h3>
            </div>
          </div>
          <div className="settings-block">
            <div className="settings-row">
              <span>Model in use</span>
              <b>{view.model ?? "shown after the first message"}</b>
            </div>
            <div className="settings-row">
              <span>Agent profile</span>
              <b>{view.agent ?? (autonomy === "auto" ? "rocket-auto" : "rocket-approval")}</b>
            </div>
            <div className="settings-row">
              <span>Autonomy</span>
              <b>{autonomy === "auto" ? "Automatic" : "Approval at changes"}</b>
            </div>
            <div className="settings-row">
              <span>Repair limit</span>
              <b>{limit} iterations</b>
            </div>
            <button className="text-button" onClick={() => onOpenFile("constraints.yaml")}>
              Edit autonomy and limits in constraints.yaml
              <Icon name="chevronRight" size={12} />
            </button>
          </div>
          <p className="settings-note">
            The model and its key are configured where the agent runs, never in this page: ROCKET_MODEL and MODEL_API_KEY in
            rocket_fuel/.env today, the OS keychain in the desktop app. Default: Meta Muse Spark 1.3.
          </p>
        </div>
      )}
    </aside>
  );
}
