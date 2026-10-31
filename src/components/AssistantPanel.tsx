import { useEffect, useRef, useState } from "react";
import type { ToolStep } from "../agent/fuel";
import { useAgent, type Agent } from "../agent/useAgent";
import type { Check, ConstraintSet, SurfaceId } from "../types";
import { Icon } from "./icons";
import { StatusPill } from "./ui";

export type AssistantTab = "chat" | "activity" | "settings";

type Message = {
  id: string;
  role: "agent" | "user";
  text: string;
  time: string;
};

type StepStatus = "completed" | "failed" | "running" | "pending";

type ActivityStep = {
  id: string;
  label: string;
  detail: string;
  tool: string;
  status: StepStatus;
  time: string;
};

const seedMessages: Message[] = [
  {
    id: "seed-1",
    role: "agent",
    text: "OpenSTA flagged −1.12 ns setup slack on design/digital/gpio.sv (125 MHz). Prepared a registered readback patch below.",
    time: "10:44 AM",
  },
];

const seedSteps: ActivityStep[] = [
  {
    id: "read-timing",
    label: "Read timing report",
    detail: "results/timing.rpt · WNS −1.12 ns at 125 MHz",
    tool: "read_file",
    status: "completed",
    time: "10:44",
  },
  {
    id: "propose-edit",
    label: "Proposed readback register edit",
    detail: "design/digital/gpio.sv · one-level registered readback",
    tool: "edit_file",
    status: "pending",
    time: "10:44",
  },
  {
    id: "run-opensta",
    label: "Ran static timing",
    detail: "−1.12 ns setup violation, critical path u_gpio.readback[7]",
    tool: "OpenSTA",
    status: "failed",
    time: "10:43",
  },
  {
    id: "run-librelane",
    label: "Completed place-and-route",
    detail: "0.184 mm² · GDS written by KLayout export",
    tool: "LibreLane",
    status: "completed",
    time: "10:41",
  },
  {
    id: "run-verilator",
    label: "Ran functional tests",
    detail: "128 / 128 tests passed",
    tool: "Verilator",
    status: "completed",
    time: "10:39",
  },
  {
    id: "search-ip",
    label: "Searched project IP registry",
    detail: "rv32i_core, gpio_controller, sky130_sram_2k",
    tool: "ip-registry",
    status: "completed",
    time: "10:36",
  },
];

const providers = [
  {
    id: "meta",
    label: "Meta Models API (Rocket Fuel default)",
    models: [
      "meta/muse-spark-1.3 (Muse Spark 1.3)",
      "meta/muse-spark-1.3-contributor (Contributor)",
      "Llama 4 Maverick",
      "Llama 3.3 70B Instruct",
    ],
  },
  {
    id: "opencode",
    label: "OpenCode Harness (free rehearsal)",
    models: [
      "opencode/beam-free",
      "opencode/nemotron-3.5-lightning-free",
      "opencode/glm-5.3-flash-free",
    ],
  },
  {
    id: "openai",
    label: "OpenAI-compatible endpoint",
    models: ["custom-chat-model"],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    models: ["qwen2.5-coder:32b", "llama3.1:8b"],
  },
];

const timeNow = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const stepLabel: Record<StepStatus, string> = {
  completed: "DONE",
  failed: "FAILED",
  running: "RUNNING",
  pending: "PENDING",
};

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// One line describing a live tool call: what it touched, and for simulations what the runner measured.
function liveStepDetail(step: ToolStep): string {
  const input = step.input as Record<string, unknown>;
  const sources = Array.isArray(input.sources)
    ? input.sources.filter((item): item is string => typeof item === "string").join(", ")
    : undefined;
  const target = [input.filePath, input.file, sources, input.kind, input.query, input.revision_id, input.block_id, input.run_id]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.replace(/^.*?\/(design|tests|ip|workflows)\//, "$1/"))
    .join(" · ");
  if (step.error) return `${target ? target + " · " : ""}${step.error}`;
  if (step.output) {
    try {
      const result = JSON.parse(step.output);
      if (result.error) return result.error;
      if (step.tool === "rocket_run_job" && result.checks) {
        const checks = Object.entries(result.checks) as [string, { status: string; measured?: number }][];
        return checks.map(([id, check]) => `${id.split(".").pop()} ${check.measured ?? ""} ${check.status}`).join(" · ");
      }
      if (step.tool === "engine_get_job_status" && result.verdict) {
        const measurements = Array.isArray(result.verdict.measurements) ? result.verdict.measurements : [];
        if (measurements.length > 0) {
          return measurements
            .map((m: { name?: string; value?: number; unit?: string; status?: string }) =>
              `${m.name ?? "metric"} ${m.value ?? ""}${m.unit ? " " + m.unit : ""} ${(m.status ?? "").toUpperCase()}`,
            )
            .join(" · ");
        }
        return `${result.verdict.status ?? result.state ?? ""}${result.verdict.reason ? " · " + result.verdict.reason : ""}`;
      }
      if (step.tool === "engine_run_spice" && result.run_id) {
        return `${target ? target + " · " : ""}${result.state ?? "queued"} (${result.run_id})`;
      }
    } catch {
      return target;
    }
  }
  return target;
}

function liveActivityStep(step: ToolStep): ActivityStep {
  const status: StepStatus = step.status === "error" ? "failed" : step.status;
  return { id: step.id, label: step.label, detail: liveStepDetail(step), tool: step.tool, status, time: formatTime(step.time) };
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
  iteration,
  checks,
  timingFixed,
  onApplyTimingRepair,
  onRunChecks,
  onOpenFile,
  onNavigate,
  notify,
  agent: externalAgent,
}: {
  width: number;
  tab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
  onClose: () => void;
  hidden: boolean;
  constraints: ConstraintSet;
  iteration: number;
  checks: Check[];
  timingFixed: boolean;
  onApplyTimingRepair: () => boolean;
  onRunChecks: () => void;
  onOpenFile: (path: string) => void;
  onNavigate: (surface: SurfaceId) => void;
  notify: (message: string) => void;
  agent?: Agent;
}) {
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [steps, setSteps] = useState<ActivityStep[]>(seedSteps);
  const [pendingApproval, setPendingApproval] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [providerId, setProviderId] = useState("meta");
  const [model, setModel] = useState(providers[0].models[0]);
  const [apiKey, setApiKey] = useState("");
  const [runnerUrl, setRunnerUrl] = useState("http://127.0.0.1:8765");
  const [settingsSaved, setSettingsSaved] = useState(false);

  const chatRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const provider = providers.find((item) => item.id === providerId) ?? providers[0];
  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const limitReached = iteration >= constraints.maxIterations;

  // Live/replay: everything below comes from the Rocket Fuel agent's event stream instead of the mock.
  const fallbackAgent = useAgent();
  const agent = externalAgent ?? fallbackAgent;
  const live = agent.mode !== "mock";
  const replay = agent.mode === "replay";
  const liveApprovals = agent.view.approvals.filter((approval) => approval.status === "pending");
  const liveChecks = Object.values(agent.view.checks);
  const shownMessages: Message[] = live
    ? agent.view.messages.map((message) => ({ ...message, time: formatTime(message.time) }))
    : messages;
  const shownSteps = live ? agent.view.steps.slice().reverse().map(liveActivityStep) : steps;
  const shownBusy = live ? agent.view.status === "busy" : busy;
  const pendingCount = live ? liveApprovals.length : pendingApproval ? 1 : 0;
  const shownIteration = live ? agent.view.iteration?.used ?? 0 : iteration;
  const shownLimit = live ? agent.view.iteration?.limit ?? constraints.maxIterations : constraints.maxIterations;
  const shownLimitReached = live ? !!agent.view.iteration?.limitReached : limitReached;
  const shownPassed = live ? liveChecks.filter((check) => check.status === "PASS").length : passed;
  const shownTotal = live ? liveChecks.length : checks.length;
  const liveError = agent.error ?? agent.view.error;
  const quickPrompts = replay
    ? []
    : live
      ? ["Bring this op-amp to spec", "Explain the failing check", "Register it as a reusable block"]
      : ["Fix timing at 125 MHz", "Run supported checks", "Explain the failing check"];

  useEffect(() => {
    const element = chatRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, busy, pendingApproval, tab, agent.view]);

  const addMessage = (role: Message["role"], text: string) => {
    idRef.current += 1;
    setMessages((previous) => [
      ...previous,
      { id: `msg-${idRef.current}`, role, text, time: timeNow() },
    ]);
  };

  const addStep = (step: Omit<ActivityStep, "id" | "time">) => {
    idRef.current += 1;
    setSteps((previous) => [
      { ...step, id: `step-${idRef.current}`, time: timeNow() },
      ...previous,
    ]);
  };

  const performRepair = () => {
    if (timingFixed) {
      addMessage("agent", "Timing already passes at 125 MHz (+0.32 ns slack). No new edit is needed.");
      return;
    }
    if (limitReached) {
      addMessage(
        "agent",
        `The repair limit is ${constraints.maxIterations} iterations. I stopped and will not apply another change without human direction. You can inspect the failing evidence, raise the limit in Constraints, or change the design targets.`,
      );
      return;
    }

    const applied = onApplyTimingRepair();
    if (!applied) {
      addMessage(
        "agent",
        "I could not start that repair. The iteration limit or current project state blocks it; review the constraints and evidence before continuing.",
      );
      return;
    }

    setPendingApproval(false);
    setSteps((previous) =>
      previous.map((step) =>
        step.id === "propose-edit"
          ? { ...step, status: "completed", detail: "Approved and applied to design/digital/gpio.sv" }
          : step,
      ),
    );
    addStep({
      label: "Reran Verilator",
      detail: "128 / 128 tests passed after the readback change",
      tool: "Verilator",
      status: "completed",
    });
    addStep({
      label: "Reran OpenSTA",
      detail: "WNS +0.32 ns at 125 MHz · timing passes",
      tool: "OpenSTA",
      status: "completed",
    });
    addStep({
      label: "Wrote timing evidence",
      detail: "results/timing.rpt updated for the repaired revision",
      tool: "write_file",
      status: "completed",
    });
    addMessage(
      "agent",
      "Repair applied. The readback path is now registered, Verilator passes 128/128, and OpenSTA reports +0.32 ns slack at 125 MHz. DRC/LVS and power remain unsupported; they are not counted as passes.",
    );
  };

  const rejectRepair = () => {
    setPendingApproval(false);
    setSteps((previous) =>
      previous.map((step) =>
        step.id === "propose-edit"
          ? { ...step, status: "failed", detail: "Rejected by user; no source files changed" }
          : step,
      ),
    );
    addMessage(
      "agent",
      "I rejected the proposed edit and changed nothing. The timing check remains failed. Tell me if you want a different topology or a higher clock/area tradeoff.",
    );
  };

  const proposeRepair = () => {
    addStep({
      label: "Analyzed readback path",
      detail: "Combinational mux depth is the dominant setup path at 125 MHz",
      tool: "analyze",
      status: "completed",
    });

    if (constraints.autonomy === "auto") {
      addStep({
        label: "Edited readback path",
        detail: "design/digital/gpio.sv · registered readback (automatic mode)",
        tool: "edit_file",
        status: "completed",
      });
      performRepair();
      return;
    }

    setPendingApproval(true);
    setSteps((previous) => [
      {
        id: "propose-edit",
        label: "Proposed readback register edit",
        detail: "design/digital/gpio.sv · one-level registered readback",
        tool: "edit_file",
        status: "pending",
        time: timeNow(),
      },
      ...previous.filter((step) => step.id !== "propose-edit"),
    ]);
    addMessage(
      "agent",
      "I found the source of the violation: the combinational readback mux in design/digital/gpio.sv. The proposed edit registers the readback one level earlier. Approve it and I will edit the file, rerun Verilator, and rerun OpenSTA.",
    );
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (live) {
      // The user's message comes back on the event stream, so it isn't added here.
      if (!text || shownBusy || replay) return;
      setInput("");
      void agent.send(text, constraints.autonomy === "auto" ? "auto" : "approval");
      return;
    }
    if (!text || busy) return;

    addMessage("user", text);
    setInput("");

    if (pendingApproval) {
      window.setTimeout(
        () =>
          addMessage(
            "agent",
            "There is a pending source edit in the approval card. Approve or reject it before I start another change.",
          ),
        450,
      );
      return;
    }

    if (limitReached) {
      addMessage(
        "agent",
        `The configured repair limit (${constraints.maxIterations}) has been reached. I must stop and consult you rather than continue or claim success. Review the evidence, raise the limit, or adjust the targets.`,
      );
      return;
    }

    setBusy(true);
    window.setTimeout(() => {
      if (/fix|timing|slack|repair|critical path/i.test(text)) {
        if (timingFixed) {
          addMessage("agent", "Timing already passes at 125 MHz with +0.32 ns slack. Nothing needs repair.");
        } else {
          proposeRepair();
        }
      } else if (/run|check|verify|verification/i.test(text)) {
        onRunChecks();
        addStep({
          label: "Requested verification rerun",
          detail: "Supported gates queued through the shared runner interface",
          tool: "runner",
          status: "completed",
        });
        addMessage(
          "agent",
          "I queued the supported verification gates. DRC/LVS and power will still return UNSUPPORTED because their decks or reports are missing. Unsupported is not a pass.",
        );
      } else if (/export|package|download/i.test(text)) {
        onNavigate("export");
        addMessage(
          "agent",
          "I opened the export surface. Sources and the verification report are exportable now; binary GDS stays in the runner artifact store.",
        );
      } else if (/explain|why|fail|unsupported/i.test(text)) {
        addMessage(
          "agent",
          `OpenSTA reports −1.12 ns setup slack at 125 MHz, caused by the GPIO readback path. ${failed} check is failing and ${checks.filter((check) => check.status === "unsupported").length} checks are unsupported. The unsupported rows have no compatible deck or report, so they are not green.`,
        );
      } else {
        addMessage(
          "agent",
          "In this UI slice I can inspect project files, propose source-backed schematic/RTL repairs, queue registered tools, and show verification evidence. Try “fix timing at 125 MHz”, “run supported checks”, or open the schematic and layout views.",
        );
      }
      setBusy(false);
    }, 850);
  };

  const savedBadge = settingsSaved ? (
    <span className="saved-pill">
      <span className="status-dot passed" />
      SAVED
    </span>
  ) : null;

  return (
    <aside className="assistant-panel" style={{ width }} hidden={hidden}>
      <header className="assistant-header">
        <div className="assistant-title">
          <span className="assistant-mark">
            <Icon name="sparkles" size={15} />
          </span>
          <div>
            <b>Rocket assistant</b>
            <span>{live ? `Rocket Fuel · ${agent.view.model ?? agent.view.replay?.model ?? "opencode"}` : `${provider.label} · ${model}`}</span>
          </div>
        </div>
        <div className="assistant-header-actions">
          {replay ? (
            <span className="live-pill replay">
              <i />
              REPLAY
            </span>
          ) : live ? (
            <span className={`live-pill ${agent.connected ? "" : "offline"}`}>
              <i />
              {agent.connected ? "LIVE" : "OFFLINE"}
            </span>
          ) : (
            <span className="live-pill offline">
              <i />
              MOCK
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
            {id === "activity" && pendingCount > 0 && <span className="tab-dot" />}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <>
          <div className="assistant-chat" ref={chatRef}>
            {replay && (
              <div className="replay-banner">
                <b>REPLAY</b> of a recorded session
                {agent.view.replay?.recordedAt && ` · ${new Date(agent.view.replay.recordedAt).toLocaleString()}`}
                {agent.view.replay?.model && ` · ${agent.view.replay.model}`}. Nothing here is running now.
              </div>
            )}
            {live && liveError && <div className="agent-error">{liveError}</div>}
            {live && !replay && shownMessages.length === 0 && (
              <p className="agent-empty">Connected to the Rocket Fuel agent. Ask it to work on the open project.</p>
            )}
            {shownMessages.map((message) => (
              <div className={`assistant-message ${message.role}`} key={message.id}>
                {message.role === "agent" && (
                  <span className="assistant-avatar">
                    <Icon name="sparkles" size={12} />
                  </span>
                )}
                <div className="message-body">
                  <div className="message-meta">
                    <b>{message.role === "agent" ? "Rocket" : "You"}</b>
                    <span>{message.time}</span>
                  </div>
                  <p>{message.text}</p>
                </div>
              </div>
            ))}

            {shownBusy && (
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

            {live &&
              liveApprovals.map((approval) => (
                <div className="approval-card" key={approval.id}>
                  <div className="approval-heading">
                    <span className="approval-title">
                      <Icon name="warning" size={14} />
                      Approval required: {approval.label}
                    </span>
                    <span className="approval-tool">{approval.permission}</span>
                  </div>
                  {approval.files.map((file) => (
                    <div className="approval-path" key={file}>
                      <Icon name="file" size={12} />
                      {file.replace(/^.*?\/(design|tests|ip|workflows)\//, "$1/")}
                    </div>
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
                  <small className="approval-note">The agent waits until you answer. Rejecting changes nothing.</small>
                </div>
              ))}

            {!live && pendingApproval && (
              <div className="approval-card">
                <div className="approval-heading">
                  <span className="approval-title">
                    <Icon name="warning" size={14} />
                    Approval required
                  </span>
                  <span className="approval-tool">edit_file</span>
                </div>
                <button className="approval-path" onClick={() => onOpenFile("design/digital/gpio.sv")}>
                  <Icon name="file" size={12} />
                  design/digital/gpio.sv
                </button>
                <p className="approval-desc">
                  Register the readback path one level earlier to remove the 125 MHz setup violation.
                </p>
                <pre className="diff-block">
                  <span className="diff-del">- always_comb begin</span>
                  <span className="diff-del">-   readback = read_pending ? bus_data : gpio_in;</span>
                  <span className="diff-del">- end</span>
                  <span className="diff-add">+ always_ff @(posedge clk or negedge rst_n) begin</span>
                  <span className="diff-add">+   if (!rst_n) readback &lt;= 8'h00;</span>
                  <span className="diff-add">+   else readback &lt;= read_pending ? bus_data : gpio_in;</span>
                  <span className="diff-add">+ end</span>
                </pre>
                <div className="approval-actions">
                  <button className="secondary-button" onClick={rejectRepair}>
                    Reject
                  </button>
                  <button
                    className="primary-button"
                    onClick={performRepair}
                    disabled={limitReached}
                    title={limitReached ? "Repair iteration limit reached" : "Apply edit and rerun checks"}
                  >
                    <Icon name="check" size={13} />
                    Approve & rerun
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="assistant-composer">
            {!pendingApproval && (
              <div className="quick-prompts">
                {quickPrompts.map((prompt) => (
                  <button key={prompt} onClick={() => send(prompt)} disabled={shownBusy}>
                    {prompt}
                  </button>
                ))}
              </div>
            )}
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
                disabled={replay}
                placeholder={replay ? "Replay is read-only" : "Describe a design change or ask for evidence…"}
                aria-label="Message the assistant"
              />
              <div className="composer-actions">
                <span className={`composer-context ${shownLimitReached ? "limit" : ""}`}>
                  {shownIteration}/{shownLimit} iterations ·{" "}
                  {constraints.autonomy === "auto" ? "auto" : "approval"}
                </span>
                {live && !replay && shownBusy ? (
                  <button className="secondary-button" onClick={() => void agent.stop()}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    onClick={() => send(input)}
                    disabled={shownBusy || replay || !input.trim()}
                  >
                    {shownBusy ? "Thinking…" : "Send"}
                    <Icon name="chevronRight" size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "activity" && (
        <div className="assistant-scroll">
          <div className="activity-summary">
            <div>
              <span className="eyebrow">ITERATION</span>
              <b>
                {shownIteration}/{shownLimit}
              </b>
            </div>
            <div>
              <span className="eyebrow">PENDING</span>
              <b className={pendingCount > 0 ? "pending" : ""}>{pendingCount}</b>
            </div>
            <div>
              <span className="eyebrow">{live ? "PASSING" : "VERIFIED"}</span>
              <b>
                {shownPassed}/{shownTotal}
              </b>
            </div>
          </div>

          {live && liveApprovals.length > 0 && (
            <div className="approval-banner">
              <Icon name="warning" size={15} />
              <div>
                <b>{liveApprovals.length === 1 ? "Change waiting for approval" : `${liveApprovals.length} changes waiting for approval`}</b>
                <span>{liveApprovals.map((approval) => approval.label).join(" · ")}</span>
              </div>
              <button className="secondary-button" onClick={() => onTabChange("chat")}>
                Review
              </button>
            </div>
          )}

          {!live && pendingApproval && (
            <div className="approval-banner">
              <Icon name="warning" size={15} />
              <div>
                <b>Source edit waiting for approval</b>
                <span>design/digital/gpio.sv · registered readback</span>
              </div>
              <button className="secondary-button" onClick={() => onTabChange("chat")}>
                Review
              </button>
            </div>
          )}

          <div className="step-list">
            {shownSteps.map((step) => (
              <div className={`step-row ${step.status}`} key={step.id}>
                <span className={`step-icon ${step.status}`}>
                  {step.status === "completed" ? (
                    <Icon name="check" size={11} />
                  ) : step.status === "failed" ? (
                    <Icon name="x" size={11} />
                  ) : step.status === "pending" ? (
                    <Icon name="clock" size={11} />
                  ) : (
                    <span className="spinner" />
                  )}
                </span>
                <div className="step-copy">
                  <b>{step.label}</b>
                  <span>{step.detail}</span>
                  <small>
                    {step.tool} · {step.time}
                  </small>
                </div>
                <span className={`step-state ${step.status}`}>{stepLabel[step.status]}</span>
              </div>
            ))}
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
              <span className="eyebrow">BYOK / MODEL ROUTING</span>
              <h3>Provider settings</h3>
            </div>
            {savedBadge}
          </div>

          <label className="field">
            <span>Provider</span>
            <select
              value={providerId}
              onChange={(event) => {
                const next = event.target.value;
                setProviderId(next);
                const nextProvider = providers.find((item) => item.id === next) ?? providers[0];
                setModel(nextProvider.models[0]);
                setSettingsSaved(false);
              }}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <small>Meta Models API is the hackathon default. The harness stays replaceable.</small>
          </label>

          <label className="field">
            <span>Model</span>
            <select
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setSettingsSaved(false);
              }}
            >
              {provider.models.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>API key</span>
            <div className="input-with-icon">
              <Icon name="lock" size={13} />
              <input
                type="password"
                value={apiKey}
                placeholder="Paste a session key"
                autoComplete="off"
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setSettingsSaved(false);
                }}
              />
            </div>
            <small>Held in memory for this session. Never written to project files or logs.</small>
          </label>

          <label className="field">
            <span>Runner endpoint</span>
            <div className="input-with-icon">
              <Icon name="terminal" size={13} />
              <input
                value={runnerUrl}
                onChange={(event) => {
                  setRunnerUrl(event.target.value);
                  setSettingsSaved(false);
                }}
              />
            </div>
            <small>Electron and browser builds both talk to the runner through this adapter.</small>
          </label>

          <div className="settings-block">
            <span className="eyebrow">HARNESS</span>
            <div className="settings-row">
              <span>Agent harness</span>
              <b>Rocket in-app harness</b>
            </div>
            <div className="settings-row">
              <span>Tool registry</span>
              <b>Engine registry · 15 tools</b>
            </div>
            <div className="settings-row">
              <span>Autonomy</span>
              <b>{constraints.autonomy === "auto" ? "Automatic" : "Approval at stages"}</b>
            </div>
            <div className="settings-row">
              <span>Repair limit</span>
              <b>{constraints.maxIterations} iterations</b>
            </div>
            <button className="text-button" onClick={() => onNavigate("constraints")}>
              Edit autonomy and limits
              <Icon name="chevronRight" size={12} />
            </button>
          </div>

          <button
            className="primary-button settings-save"
            onClick={() => {
              setSettingsSaved(true);
              notify("Assistant provider settings saved for this session.");
            }}
          >
            <Icon name="save" size={13} />
            Save settings
          </button>

          <p className="settings-note">
            Settings are UI-side in this slice. Credentials and native execution belong behind the
            agent service and runner adapters; keys are never included in exports.
          </p>
        </div>
      )}
    </aside>
  );
}
