import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Constraints } from "../api";
import { attachmentFromFile, captureView } from "../agent/attachments";
import type { Approval, Attachment, SessionView, ToolStep } from "../agent/fuel";
import { applyUnifiedDiff, describeChanges, type CircuitChange, type Proposal } from "../schematic/changes";
import { useAgent } from "../agent/useAgent";
import type { SurfaceId } from "../types";
import { Icon, type IconName } from "./icons";
import { LastModelCall, ModelCallList, useModelCalls } from "./ModelCalls";
import { ModelKeyForm, useModelKey } from "./ModelKey";

const shortPath = (value: string) =>
  value.replace(/^.*?\/((?:design|tests|src|rtl|docs|scripts|ip|workflows|results)\/.*|[^/]+\.(?:yaml|yml|md|json))$/, "$1");

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
        Autonomy and the repair limit live in constraints.yaml (agent.mode, agent.iteration_limit).
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

const LESSON_SUGGESTIONS: { icon: IconName; text: string }[] = [
  { icon: "bulb", text: "Start this lesson with me" },
  { icon: "sliders", text: "Explain what the checks are asking for" },
  { icon: "warning", text: "Run the checks and help me understand the result" },
  { icon: "sparkles", text: "Give me a hint, but not the answer" },
];

const LEARN_SUGGESTIONS: { icon: IconName; text: string }[] = [
  { icon: "bulb", text: "Walk me through this design, block by block" },
  { icon: "sliders", text: "Explain what each check measures and why it matters" },
  { icon: "warning", text: "Run the checks and help me understand the result" },
  { icon: "sparkles", text: "Quiz me on this circuit" },
];

export function AssistantPanel({
  width,
  onClose,
  constraints,
  lesson,
  onActivity,
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
  lesson?: boolean;
  onActivity?: (view: SessionView) => void;
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
  const modelKey = useModelKey();
  const modelCalls = useModelCalls(replay);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string>();
  // A lesson always opens in Learn mode.
  const [learn, setLearn] = useState(() => {
    if (lesson) return true;
    try {
      return localStorage.getItem("rocketide.learn") === "1";
    } catch {
      return false;
    }
  });
  const toggleLearn = () => {
    setLearn((on) => {
      try {
        localStorage.setItem("rocketide.learn", on ? "0" : "1");
      } catch {
        // Only a convenience: it just won't be remembered.
      }
      return !on;
    });
  };
  const addFiles = async (picked: Iterable<File>) => {
    setNotice(undefined);
    for (const file of picked) {
      try {
        const attachment = await attachmentFromFile(file);
        setFiles((current) => [...current, attachment]);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    }
  };
  const addView = async () => {
    setNotice(undefined);
    const view = await captureView();
    if (view) setFiles((current) => [...current, view]);
    else setNotice("Open the layout, plots or schematic first, then attach what you see.");
  };

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
  // The rest of the app follows the work, not every word of the reply.
  const lastStep = view.steps[view.steps.length - 1];
  useEffect(() => onActivity?.(view), [view.status, view.steps.length, lastStep?.status, lastStep?.id]);
  const limit = view.iteration?.limit ?? constraints.agent?.iteration_limit ?? 10;
  const used = view.iteration?.used ?? 0;
  const autonomy = constraints.agent?.mode === "approval" ? "Approval" : "Auto";
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
    const text = raw.trim() || (files.length ? "Tell me what you read from this, and ask about anything unclear." : "");
    if (!text || busy || replay || !ready) return;
    setInput("");
    setFiles([]);
    void agent.send(text, learn ? "tutor" : autonomy === "Auto" ? "auto" : "approval", files);
  };
  const secondOpinion = () => {
    if (busy || replay || !ready) return;
    void agent.send("Give me an independent second opinion on this design and its evidence.", "reviewer");
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

      {tab === "activity" && <ModelCallList calls={modelCalls} />}
      {tab === "activity" && <ActivityView view={view} onOpenFile={onOpenFile} onShowChat={() => setTab("chat")} />}
      {tab === "settings" && !replay && (
        <div className="assistant-key">
          <ModelKeyForm status={modelKey.status} onChange={modelKey.setStatus} />
        </div>
      )}
      {tab === "settings" && (
        <SettingsView
          rows={[
            ["Connection", replay ? "Replay of a recorded session" : live ? "Connected" : agentState === "starting" ? "Starting" : "Not connected"],
            ["Model", model || "known after the first answer"],
            ["Profile", view.agent ?? (autonomy === "Auto" ? "rocket-auto" : "rocket-approval")],
            ["Autonomy", autonomy === "Auto" ? "Auto: builds until done without asking" : "Approval: you approve each design edit"],
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
        {!replay && modelKey.status && !modelKey.status.configured && <ModelKeyForm status={modelKey.status} onChange={modelKey.setStatus} />}
        {error && <div className="notice error">{/\b401\b|unauthorized|invalid api key|bad key/i.test(error) ? "Meta's API refused your key. Replace it under Settings." : error}</div>}
        {view.retry && !replay && (
          <div className="notice warn">
            The model isn't answering: {view.retry.message}.{" "}
            {view.retry.next ? `Next try ${retryTime(view.retry.next)}. ` : ""}
            Stop, or check your key under Settings.
          </div>
        )}
        {!replay && agentState === "error" && <div className="notice error">The assistant failed to start for this project.</div>}

        {timeline.length === 0 && !replay ? (
          <div className="assistant-empty">
            <h2>{lesson ? constraints.title : (constraints.checks ?? []).length ? "Design, check, or fix this project" : "What do you want to build?"}</h2>
            {lesson && (
              <button className="btn lesson-open" onClick={() => onOpenFile("LESSON.md")}>
                <Icon name="file" size={13} />
                Read the lesson
              </button>
            )}
            <div className="suggestion-grid">
              {(lesson ? LESSON_SUGGESTIONS : learn ? LEARN_SUGGESTIONS : suggestions(constraints)).map((item) => (
                <button key={item.text} className="suggestion" onClick={() => send(item.text)} disabled={!ready || busy}>
                  <span className="suggestion-icon">
                    <Icon name={item.icon} size={14} />
                  </span>
                  <span className="suggestion-text">{item.text}</span>
                  <Icon name="chevronRight" size={13} />
                </button>
              ))}
            </div>
            {!replay && !lesson && (
              <button
                className="suggestion sketch"
                disabled={!ready || busy}
                onClick={() => {
                  setInput("Turn this sketch into a netlist and a testbench, then run it with the engine.");
                  fileRef.current?.click();
                }}
              >
                <span className="suggestion-icon">
                  <Icon name="camera" size={14} />
                </span>
                <span className="suggestion-text">Start from a photo of your circuit sketch or a spec</span>
                <Icon name="chevronRight" size={13} />
              </button>
            )}
            {!ready && <p className="assistant-hint">Starting the assistant for this project…</p>}
          </div>
        ) : (
          <div className="timeline">
            {timeline.map((item) =>
              item.kind === "message" ? (
                item.message.role === "user" ? (
                  <div className={`msg user ${item.message.attachment ? "with-attachment" : ""}`} key={item.message.id}>
                    {item.message.attachment?.mime.startsWith("image/") ? (
                      <img className="msg-image" src={item.message.attachment.url} alt={item.message.attachment.name} />
                    ) : item.message.attachment ? (
                      <span className="msg-file">
                        <Icon name="file" size={13} />
                        {item.message.attachment.name}
                      </span>
                    ) : null}
                    {item.message.text}
                  </div>
                ) : (
                  <div className="msg agent markdown" key={item.message.id}>
                    {item.message.model?.startsWith("muse-wonder") && (
                      <div className="msg-author">
                        <Icon name="eye" size={12} />
                        Muse Wonder · independent review
                      </div>
                    )}
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

      <footer
        className="composer"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!replay) void addFiles(event.dataTransfer.files);
        }}
      >
        {notice && <div className="composer-notice">{notice}</div>}
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((file, index) => (
              <span className="composer-file" key={`${file.name}-${index}`}>
                {file.mime.startsWith("image/") ? <img src={file.url} alt="" /> : <Icon name="file" size={13} />}
                <span>{file.name}</span>
                <button onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          onChange={(event) => {
            void addFiles(event.target.files ?? []);
            event.target.value = "";
          }}
        />
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
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (pasted.length) {
              event.preventDefault();
              void addFiles(pasted);
            }
          }}
          rows={2}
          disabled={replay || !ready}
          placeholder={
            replay ? "Replay is read-only" : !ready ? "Waiting for the assistant…" : learn ? "Ask anything. The tutor explains and asks back…" : "Ask the assistant to design, check, or fix…"
          }
          aria-label="Message the assistant"
        />
        <LastModelCall calls={modelCalls} />
        {!replay && (
          <div className="composer-tools">
            <button className="tool-button" onClick={() => fileRef.current?.click()} disabled={!ready} title="Attach a photo, screenshot or PDF. You can also paste or drop one.">
              <Icon name="paperclip" size={13} />
              Attach
            </button>
            <button className="tool-button" onClick={() => void addView()} disabled={!ready} title="Show Muse Spark the layout, plots or schematic you have open">
              <Icon name="camera" size={13} />
              This view
            </button>
            <button className={`tool-button ${learn ? "on" : ""}`} onClick={toggleLearn} aria-pressed={learn} title="Learn mode: the tutor explains and asks questions, and leaves the changes to you">
              <Icon name="graduation" size={13} />
              Learn
            </button>
            <button className="tool-button" onClick={secondOpinion} disabled={!ready || busy} title="Muse Wonder independently reviews the design and its evidence. It can't edit or change a verdict.">
              <Icon name="eye" size={13} />
              Second opinion
            </button>
          </div>
        )}
        <div className="composer-row">
          {model && <span className="pill">{model}</span>}
          <span className="pill" title={learn ? "The tutor explains and doesn't edit" : "Change it on the Constraints page"}>{learn ? "Learn" : autonomy}</span>
          <span className={`composer-meta ${view.iteration?.limitReached ? "limit" : ""}`}>
            {used}/{limit} repairs
          </span>
          <div className="head-spacer" />
          {busy && !replay ? (
            <button className="send stop" onClick={() => void agent.stop()} aria-label="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button className="send" onClick={() => send(input)} disabled={replay || !ready || (!input.trim() && !files.length)} aria-label="Send">
              <Icon name="arrowUp" size={15} />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}
