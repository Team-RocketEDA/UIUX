import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ActiveView,
  Check,
  CheckStatus,
  ConstraintSet,
  Job,
  ProjectFile,
  SurfaceId,
} from "./types";
import {
  initialChecks,
  initialConstraints,
  initialFiles,
  project,
  toolRegistry,
} from "./data";
import {
  createEngineClient,
  ENGINE_SCHEMA,
  type EngineClient,
  type RunOperation,
} from "./engine";
import { useAgent } from "./agent/useAgent";
import { buildVerificationReport, downloadText } from "./utils";
import { AssistantPanel, type AssistantTab } from "./components/AssistantPanel";
import { ConstraintsSurface } from "./components/ConstraintsSurface";
import { ExportSurface } from "./components/ExportSurface";
import { Icon, type IconName } from "./components/icons";
import { LayoutSurface } from "./components/LayoutSurface";
import { OverviewSurface } from "./components/OverviewSurface";
import { PlotsSurface } from "./components/PlotsSurface";
import { RunConsole } from "./components/RunConsole";
import { SchematicSurface } from "./components/SchematicSurface";
import { Sidebar } from "./components/Sidebar";
import { SourceSurface } from "./components/SourceSurface";
import { TerminalSurface } from "./components/TerminalSurface";
import { Toolbelt } from "./components/Toolbelt";
import { TopBar } from "./components/TopBar";
import { ResizeHandle } from "./components/ui";
import { VerificationSurface } from "./components/VerificationSurface";

const surfaceMeta: Record<SurfaceId, { label: string; icon: IconName }> = {
  overview: { label: "Overview", icon: "home" },
  schematic: { label: "Schematic", icon: "schematic" },
  layout: { label: "Layout", icon: "layout" },
  constraints: { label: "Constraints", icon: "constraints" },
  verification: { label: "Verification", icon: "verification" },
  plots: { label: "Plots", icon: "plot" },
  terminal: { label: "Terminal", icon: "terminal" },
  export: { label: "Export", icon: "export" },
};

const fillViews = new Set<SurfaceId>(["schematic", "layout", "terminal"]);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const GPIO_COMBINATIONAL = `  always_comb begin
    readback = read_pending ? bus_data : gpio_in;
  end`;

const GPIO_REGISTERED = `  // Repaired: register readback to close the 125 MHz setup path.
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) readback <= 8'h00;
    else readback <= read_pending ? bus_data : gpio_in;
  end`;

const constraintsToYaml = (constraints: ConstraintSet) => `pdk: ${constraints.pdk}
domains: [${constraints.domains.join(", ")}]

targets:
  supply_v: ${constraints.supplyV}
  clock_mhz: ${constraints.clockMhz}
  max_power_mw: ${constraints.maxPowerMw}
  max_area_mm2: ${constraints.maxAreaMm2}
  wavelength_nm: ${constraints.wavelengthNm}
  extinction_db: ${constraints.extinctionDb}

verification:
  required:
${constraints.requiredChecks.map((id) => `    - ${id}`).join("\n")}
  max_iterations: ${constraints.maxIterations}
  autonomy: ${constraints.autonomy}
`;

const toolToEngineOp: Record<string, RunOperation> = {
  klayout: "generate_views",
  magic: "run_drc",
  netgen: "run_lvs",
  verilator: "run_hdl_test",
  librelane: "run_digital_flow",
  opensta: "run_timing",
  ngspice: "run_spice",
  sax: "run_optical",
  meow: "run_optical",
};

export function App() {
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [constraints, setConstraints] = useState<ConstraintSet>(initialConstraints);
  const [checks, setChecks] = useState<Check[]>(initialChecks);
  const [revision, setRevision] = useState("p12");
  const [iteration, setIteration] = useState(3);
  const [timingFixed, setTimingFixed] = useState(false);
  const [eventCursor, setEventCursor] = useState(0);
  const [lastRewind, setLastRewind] = useState("rewind:p12");

  const [surface, setSurface] = useState<SurfaceId>("schematic");
  const [view, setView] = useState<ActiveView>({ kind: "surface", id: "schematic" });
  const [openFiles, setOpenFiles] = useState<string[]>(["design/digital/top.sv"]);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantWidth, setAssistantWidth] = useState(292);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("chat");

  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(196);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const agent = useAgent();
  const engineRef = useRef<EngineClient | null>(null);
  if (!engineRef.current) {
    engineRef.current = createEngineClient({
      projectId: project.name,
      initialRevision: "p12",
      initialDocs: initialFiles
        .filter((f) => !f.path.startsWith("results/"))
        .map((f) => ({ path: f.path, content: f.content })),
      baseUrl: import.meta.env.VITE_ROCKET_ENGINE_URL || undefined,
    });
  }
  const engine = engineRef.current;

  // Map live/replay Rocket Fuel check verdicts onto workbench checks when present.
  const liveCheckEntries = Object.entries(agent.view.checks);
  const effectiveChecks: Check[] =
    agent.mode !== "mock" && liveCheckEntries.length > 0
      ? liveCheckEntries.map(([id, item]) => {
          const statusMap: Record<string, CheckStatus> = {
            PASS: "passed",
            FAIL: "failed",
            NOT_RUN: "not_run",
            UNSUPPORTED: "unsupported",
          };
          return {
            id,
            name: id.replace(/^opamp\./, "Op-amp ").replace(/_/g, " "),
            domain: "analog" as const,
            tool: item.producer === "stub" ? "rocket_fuel (stub)" : "ngspice 44 / Rocket Engine",
            target: item.target ?? "from constraints.yaml",
            measured:
              item.measured !== undefined
                ? `${item.measured}${id.includes("gain") ? " dB" : id.includes("ugbw") ? " MHz" : id.includes("phase") ? "°" : ""}`
                : item.status,
            status: statusMap[item.status] ?? "not_run",
            artifact: "design/opamp.cir",
            log: `Producer: ${item.producer ?? "runner"} · margin: ${item.margin ?? "—"}`,
            revision,
            updated: "live stream",
          };
        })
      : checks;
  const effectiveIteration =
    agent.mode !== "mock" && agent.view.iteration ? agent.view.iteration.used : iteration;

  useEffect(() => {
    viewRef.current?.scrollTo({ top: 0 });
  }, [view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = (message: string) => setToast(message);

  const navigate = (nextSurface: SurfaceId) => {
    setSurface(nextSurface);
    setView({ kind: "surface", id: nextSurface });
  };

  const openFile = (path: string) => {
    if (!files.some((file) => file.path === path)) {
      notify(`${path} is a runner artifact and is not available as text in this build.`);
      return;
    }
    setOpenFiles((previous) => (previous.includes(path) ? previous : [...previous, path]));
    setView({ kind: "file", path });
  };

  const closeFile = (path: string) => {
    setOpenFiles((previous) => previous.filter((item) => item !== path));
    if (view.kind === "file" && view.path === path) {
      setView({ kind: "surface", id: surface });
    }
  };

  const changeFile = (path: string, content: string) => {
    setFiles((previous) =>
      previous.map((file) => (file.path === path ? { ...file, content } : file)),
    );
    setDirtyFiles((previous) => new Set(previous).add(path));
  };

  const syncEngineEvents = async () => {
    const evRes = await engine.get_events_since({ project_id: project.name, cursor: eventCursor });
    if (evRes.ok) {
      setEventCursor(evRes.data.next_cursor);
      setRevision(evRes.data.current_revision);
    } else if (evRes.code === "resync_required") {
      const snap = await engine.get_project_snapshot({ project_id: project.name });
      if (snap.ok) {
        setRevision(snap.data.current_revision);
        setEventCursor(snap.data.cursor);
      }
    }
  };

  const saveFile = async (path: string) => {
    const target = files.find((item) => item.path === path);
    if (!target) return;
    const writeRes = await engine.write_doc({
      project_id: project.name,
      path,
      content: target.content,
      expected_revision: revision,
      actor: "human",
    });
    if (!writeRes.ok) {
      if (writeRes.code === "revision_conflict") {
        await syncEngineEvents();
        notify(`Revision conflict on ${path}; resynced head to ${writeRes.current_revision ?? "latest"}.`);
        return;
      }
      notify(`Engine refused write_doc on ${path}: ${writeRes.message}`);
      return;
    }
    setDirtyFiles((previous) => {
      const next = new Set(previous);
      next.delete(path);
      return next;
    });
    setRevision(writeRes.data.revision);
    setLastRewind(writeRes.data.rewind_handle);
    await syncEngineEvents();
    notify(`${path} committed via write_doc → rev:${writeRes.data.revision} (${writeRes.data.rewind_handle}).`);
  };

  const startJob = (
    title: string,
    tool: string,
    logs: string[],
    outcome: Job["status"] = "passed",
  ) => {
    const id = `job-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const startedAt = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setJobs((previous) =>
      [
        {
          id,
          title,
          tool,
          status: "running" as const,
          progress: 5,
          logs: [],
          startedAt,
        },
        ...previous,
      ].slice(0, 10),
    );
    setActiveJobId(id);
    setConsoleOpen(true);

    logs.forEach((line, index) => {
      window.setTimeout(() => {
        setJobs((previous) =>
          previous.map((job) =>
            job.id === id
              ? {
                  ...job,
                  logs: [...job.logs, line],
                  progress: Math.round(((index + 1) / (logs.length + 1)) * 100),
                }
              : job,
          ),
        );
      }, 240 * (index + 1));
    });

    window.setTimeout(() => {
      setJobs((previous) =>
        previous.map((job) =>
          job.id === id
            ? {
                ...job,
                status: outcome,
                progress: 100,
                logs: [
                  ...job.logs,
                  outcome === "passed" ? "✓ job completed" : "✕ job failed — inspect evidence",
                ],
              }
            : job,
        ),
      );
    }, 240 * (logs.length + 1));

    return id;
  };

  const runTool = async (toolId: string) => {
    const tool = toolRegistry.find((item) => item.id === toolId);
    if (!tool) return;
    if (!tool.available) {
      notify(`${tool.label} is unavailable: ${tool.unavailableReason}`);
      return;
    }
    const operation: RunOperation = toolToEngineOp[toolId] ?? "run_syntax";
    const requestId = `req-${toolId}-${Date.now()}`;
    const ackRes = await engine.submit({
      schema: ENGINE_SCHEMA,
      request_id: requestId,
      project_id: project.name,
      expected_revision: revision,
      operation,
      actor: "human",
      arguments: { tool: toolId },
    });
    const runRes = ackRes.ok
      ? await engine.run_job({ project_id: project.name, request_id: ackRes.data.request_id })
      : null;
    await syncEngineEvents();
    const contractLogs =
      ackRes.ok && runRes?.ok
        ? [
            `[v0.2 submit] request_id=${ackRes.data.request_id} → run_id=${ackRes.data.run_id} (rev:${ackRes.data.current_revision})`,
            ...runRes.data.measurements.map(
              (m) => `[measure] ${m.name}: ${m.value} ${m.unit} (target ${m.target}, margin ${m.margin >= 0 ? "+" : ""}${m.margin}) → ${m.status}`,
            ),
          ]
        : [];
    const outcome = toolId === "opensta" && !timingFixed ? "failed" : "passed";
    startJob(`${tool.label} (${operation})`, tool.label, [...contractLogs, ...tool.logs], outcome);
    notify(`${tool.label} executed via two-phase submit → run_job (${requestId}).`);
  };

  const runScript = (script: string) => {
    startJob(
      "Python project script",
      "Python 3.12",
      [
        "Resolved project context: rocket-demo",
        "Loaded IP registry and tool adapters",
        `python -c ${script.length > 100 ? `${script.slice(0, 100)}…` : script}`,
        "UI-simulated runner: job completed; native execution stays behind the adapter",
      ],
      "passed",
    );
    notify("Python job queued through the shared runner interface.");
  };

  const runChecks = async () => {
    if (checks.some((check) => check.status === "running")) return;
    const unsupportedCount = checks.filter((check) => check.status === "unsupported").length;
    const willFail = !timingFixed;
    const requestId = `req-checks-${Date.now()}`;
    const ackRes = await engine.submit({
      schema: ENGINE_SCHEMA,
      request_id: requestId,
      project_id: project.name,
      expected_revision: revision,
      operation: "run_timing",
      actor: "human",
      arguments: { suite: "required_gates" },
    });
    if (ackRes.ok) {
      await engine.run_job({ project_id: project.name, request_id: ackRes.data.request_id });
      await syncEngineEvents();
    }

    setChecks((previous) =>
      previous.map((check) =>
        check.status === "unsupported"
          ? check
          : { ...check, status: "running" as const, updated: "running now" },
      ),
    );

    startJob(
      "Run supported verification gates",
      "runner",
      [
        ackRes.ok
          ? `[v0.2 submit → run_job] request_id=${ackRes.data.request_id} · snapshot=${ackRes.data.snapshot_id} · rev:${ackRes.data.current_revision}`
          : "Loaded project snapshot",
        "Loaded constraints.yaml and pinned workflow revisions",
        "Verilator: 128 / 128 functional tests passed",
        `LibreLane: routed design reused at revision ${revision}`,
        willFail
          ? "OpenSTA: WNS −1.12 ns at 125 MHz (VIOLATED)"
          : "OpenSTA: WNS +0.32 ns at 125 MHz (MET)",
        "ngspice and SAX evidence refreshed from stored simulations",
        "DRC/LVS and power not run: unavailable in this runner",
      ],
      willFail ? "failed" : "passed",
    );

    notify("Supported checks queued. Unsupported gates will remain unsupported.");

    window.setTimeout(() => {
      setChecks((previous) =>
        previous.map((check) => {
          if (check.status === "unsupported") return check;
          if (check.id === "static-timing") {
            return timingFixed
              ? {
                  ...check,
                  status: "passed" as const,
                  measured: "+0.32 ns (7.68 ns path)",
                  updated: "just now",
                }
              : {
                  ...check,
                  status: "failed" as const,
                  measured: "−1.12 ns (9.12 ns critical path)",
                  updated: "just now",
                };
          }
          return { ...check, status: "passed" as const, updated: "just now" };
        }),
      );
      notify(
        willFail
          ? `Checks finished: timing still fails · ${unsupportedCount} unsupported.`
          : `Checks finished: all supported gates pass · ${unsupportedCount} unsupported.`,
      );
    }, 2500);
  };

  const applyTimingRepair = (): boolean => {
    if (timingFixed) return false;
    if (iteration >= constraints.maxIterations) {
      notify("Repair limit reached. Raise the iteration limit or adjust the constraints.");
      return false;
    }
    if (dirtyFiles.has("design/digital/gpio.sv")) {
      notify("Resolve unsaved edits in design/digital/gpio.sv before the agent can rewrite it.");
      return false;
    }

    const gpioFile = files.find((file) => file.path === "design/digital/gpio.sv");
    if (!gpioFile || !gpioFile.content.includes(GPIO_COMBINATIONAL)) {
      notify("design/digital/gpio.sv changed from the expected baseline. Re-read the file first.");
      return false;
    }

    const repairedContent = gpioFile.content.replace(GPIO_COMBINATIONAL, GPIO_REGISTERED);
    const nextRevNum = Number.parseInt(revision.replace(/^p/, ""), 10);
    const nextRevision = Number.isFinite(nextRevNum) ? `p${nextRevNum + 1}` : "p13";
    void engine
      .apply_mutations({
        project_id: project.name,
        expected_revision: revision,
        actor: "rocket-fuel",
        mutations: [{ op: "write", path: "design/digital/gpio.sv", content: repairedContent }],
      })
      .then(async (batchRes) => {
        if (batchRes.ok) {
          setRevision(batchRes.data.revision);
          setLastRewind(batchRes.data.rewind_handle);
          await syncEngineEvents();
        }
      });
    setTimingFixed(true);
    setIteration((previous) => previous + 1);
    setRevision(nextRevision);
    setFiles((previous) =>
      previous.map((file) => {
        if (file.path === "design/digital/gpio.sv") {
          return {
            ...file,
            content: repairedContent,
          };
        }
        if (file.path === "results/timing.rpt") {
          return {
            ...file,
            content: `OpenSTA 2.6.0 -- sky130_fd_sc_hd__tt_025C_1v80
Revision: ${nextRevision}

Startpoint: u_gpio.readback[7] (registered)
Endpoint:   u_core.irq
Path group: clk
Path type:   max

  data arrival time   7.68 ns
  data required time  8.00 ns
  slack              +0.32 ns  MET

WNS +0.32 ns
TNS  0.00 ns
`,
          };
        }
        return file;
      }),
    );

    setChecks((previous) =>
      previous.map((check) =>
        check.id === "static-timing"
          ? {
              ...check,
              status: "running" as const,
              measured: "Rerunning after repair",
              updated: "running now",
              revision: nextRevision,
            }
          : check,
      ),
    );

    startJob(
      "Agent repair: close GPIO setup path",
      "Verilator → OpenSTA",
      [
        "Read results/timing.rpt at revision 8f3c1a2",
        "Edited design/digital/gpio.sv: registered the readback path",
        "Verilator: 128 / 128 tests passed",
        "OpenSTA: WNS +0.32 ns at 125 MHz",
        "Wrote results/timing.rpt for the repaired revision",
      ],
      "passed",
    );

    window.setTimeout(() => {
      setChecks((previous) =>
        previous.map((check) =>
          check.id === "static-timing"
            ? {
                ...check,
                status: "passed" as const,
                measured: "+0.32 ns (7.68 ns path)",
                updated: "just now",
                revision: nextRevision,
                log: "Registered readback closed the setup path. WNS +0.32 ns at 125 MHz.",
              }
            : check,
        ),
      );
    }, 1800);

    notify("Agent repair applied. Timing now passes at 125 MHz.");
    return true;
  };

  const saveConstraints = async (next: ConstraintSet) => {
    const nextYaml = constraintsToYaml(next);
    setConstraints(next);
    setFiles((previous) =>
      previous.map((file) =>
        file.path === "constraints.yaml"
          ? { ...file, content: nextYaml }
          : file,
      ),
    );
    const batchRes = await engine.apply_mutations({
      project_id: project.name,
      expected_revision: revision,
      actor: "human",
      mutations: [{ op: "write", path: "constraints.yaml", content: nextYaml }],
    });
    if (batchRes.ok) {
      setRevision(batchRes.data.revision);
      setLastRewind(batchRes.data.rewind_handle);
      await syncEngineEvents();
    }
    notify("constraints.yaml saved. Targets and gates are now explicit for the agent and runner.");
  };

  const exportReport = () => {
    downloadText(
      `verification-${revision}.md`,
      buildVerificationReport(checks, constraints, revision, project.name),
    );
    notify("Verification report downloaded.");
  };

  const openAssistant = (tab: AssistantTab = "chat") => {
    setAssistantOpen(true);
    setAssistantTab(tab);
  };

  useEffect(() => {
    const surfaceOrder: SurfaceId[] = [
      "overview",
      "schematic",
      "layout",
      "constraints",
      "verification",
      "plots",
      "terminal",
      "export",
    ];
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setConsoleOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setAssistantOpen((open) => !open);
        return;
      }
      if (event.key === "Escape" && shortcutsOpen) {
        event.preventDefault();
        setShortcutsOpen(false);
        return;
      }
      if (isInput || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      const digit = Number(event.key);
      if (digit >= 1 && digit <= 8) {
        event.preventDefault();
        const nextSurface = surfaceOrder[digit - 1];
        setSurface(nextSurface);
        setView({ kind: "surface", id: nextSurface });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcutsOpen]);

  const startResize =
    (target: "sidebar" | "assistant" | "console") => (event: ReactPointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startSidebar = sidebarWidth;
      const startAssistant = assistantWidth;
      const startConsole = consoleHeight;

      const move = (moveEvent: globalThis.PointerEvent) => {
        if (target === "sidebar") {
          setSidebarWidth(clamp(startSidebar + moveEvent.clientX - startX, 196, 340));
        } else if (target === "assistant") {
          setAssistantWidth(clamp(startAssistant - (moveEvent.clientX - startX), 300, 520));
        } else {
          setConsoleHeight(clamp(startConsole - (moveEvent.clientY - startY), 120, 420));
        }
      };

      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        document.body.classList.remove("resizing");
      };

      document.body.classList.add("resizing");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    };

  const resizeWithKeyboard =
    (target: "sidebar" | "assistant" | "console") => (event: ReactKeyboardEvent) => {
      const step = 8;
      if (target === "sidebar") {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        setSidebarWidth((width) =>
          clamp(width + (event.key === "ArrowRight" ? step : -step), 196, 340),
        );
      } else if (target === "assistant") {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        setAssistantWidth((width) =>
          clamp(width + (event.key === "ArrowLeft" ? step : -step), 300, 520),
        );
      } else {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        setConsoleHeight((height) =>
          clamp(height + (event.key === "ArrowUp" ? step : -step), 120, 420),
        );
      }
    };

  const activeFile = view.kind === "file" ? files.find((file) => file.path === view.path) : null;
  const failed = effectiveChecks.filter((check) => check.status === "failed").length;
  const unsupported = effectiveChecks.filter(
    (check) => check.status === "unsupported" || check.status === "not_run",
  ).length;
  const runningJobs = jobs.filter((job) => job.status === "running").length;
  const isFill = view.kind === "file" || fillViews.has(surface);

  const renderSurface = () => {
    if (view.kind === "file") {
      if (!activeFile) {
        return (
          <div className="empty-state page-surface">
            <Icon name="file" size={24} />
            <b>File not available</b>
            <span>Open another project file from the explorer.</span>
          </div>
        );
      }
      return (
        <SourceSurface
          key={activeFile.path}
          file={activeFile}
          dirty={dirtyFiles.has(activeFile.path)}
          onChange={(content) => changeFile(activeFile.path, content)}
          onSave={() => saveFile(activeFile.path)}
        />
      );
    }

    switch (surface) {
      case "overview":
        return (
          <OverviewSurface
            checks={effectiveChecks}
            constraints={constraints}
            iteration={effectiveIteration}
            tools={toolRegistry}
            onNavigate={navigate}
            onOpenFile={openFile}
            onRunChecks={runChecks}
            onOpenAssistant={() => openAssistant("chat")}
          />
        );
      case "schematic":
        return <SchematicSurface onOpenFile={openFile} notify={notify} />;
      case "layout":
        return <LayoutSurface onOpenFile={openFile} onRunTool={runTool} />;
      case "constraints":
        return (
          <ConstraintsSurface
            constraints={constraints}
            checks={effectiveChecks}
            onSave={saveConstraints}
            onOpenFile={openFile}
          />
        );
      case "verification":
        return (
          <VerificationSurface
            checks={effectiveChecks}
            constraints={constraints}
            iteration={effectiveIteration}
            onRunChecks={runChecks}
            onExportReport={exportReport}
            onOpenFile={openFile}
          />
        );
      case "plots":
        return <PlotsSurface checks={checks} onOpenFile={openFile} />;
      case "terminal":
        return (
          <TerminalSurface
            checks={checks}
            constraints={constraints}
            tools={toolRegistry}
            onRunTool={runTool}
            onRunScript={runScript}
          />
        );
      case "export":
        return (
          <ExportSurface
            files={files}
            checks={checks}
            constraints={constraints}
            revision={revision}
            onOpenFile={openFile}
            notify={notify}
          />
        );
      default:
        return null;
    }
  };

  return (
    <main className="app-shell">
      <TopBar
        revision={revision}
        runningJobs={runningJobs}
        agentMode={agent.mode}
        agentConnected={agent.connected}
        onExport={() => navigate("export")}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <Toolbelt
        tools={toolRegistry}
        onRunTool={runTool}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onToggleConsole={() => setConsoleOpen((open) => !open)}
        consoleOpen={consoleOpen}
        onToggleAssistant={() => setAssistantOpen((open) => !open)}
        assistantOpen={assistantOpen}
      />

      <div className="workspace">
        <Sidebar
          files={files}
          dirtyFiles={dirtyFiles}
          openFilePath={view.kind === "file" ? view.path : null}
          surface={surface}
          issueCount={failed + unsupported}
          onNavigate={navigate}
          onOpenFile={openFile}
          pdk={constraints.pdk}
          domains={constraints.domains}
          width={sidebarWidth}
          hidden={!sidebarOpen}
        />

        {sidebarOpen && (
          <ResizeHandle
            orientation="column"
            label="Resize project sidebar"
            onPointerDown={startResize("sidebar")}
            onKeyDown={resizeWithKeyboard("sidebar")}
          />
        )}

        <section className="content">
          <div className="tabstrip" role="tablist" aria-label="Open views">
            {(["schematic", "layout", "plots", "verification", "constraints"] as SurfaceId[]).map(
              (tabId) => {
                const isActive = view.kind === "surface" && surface === tabId;
                return (
                  <button
                    key={tabId}
                    className={`editor-tab surface-tab ${isActive ? "active" : ""}`}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => navigate(tabId)}
                  >
                    <Icon name={surfaceMeta[tabId].icon} size={12} />
                    <span>{surfaceMeta[tabId].label}</span>
                  </button>
                );
              },
            )}
            {!["schematic", "layout", "plots", "verification", "constraints"].includes(surface) && (
              <button
                className={`editor-tab surface-tab ${view.kind === "surface" ? "active" : ""}`}
                role="tab"
                aria-selected={view.kind === "surface"}
                onClick={() => setView({ kind: "surface", id: surface })}
              >
                <Icon name={surfaceMeta[surface].icon} size={12} />
                <span>{surfaceMeta[surface].label}</span>
              </button>
            )}

            {openFiles.map((path) => {
              const file = files.find((item) => item.path === path);
              const isActive = view.kind === "file" && view.path === path;
              return (
                <div className={`editor-tab file-tab ${isActive ? "active" : ""}`} key={path}>
                  <button
                    className="file-tab-main"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setView({ kind: "file", path })}
                    title={path}
                  >
                    <Icon name={file?.readOnly ? "lock" : "file"} size={12} />
                    <span>{path.split("/").pop()}</span>
                    {dirtyFiles.has(path) && <i className="dirty-dot" />}
                  </button>
                  <button
                    className="tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeFile(path);
                    }}
                    aria-label={`Close ${path}`}
                    title={`Close ${path}`}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              );
            })}

            <div className="tabstrip-spacer" />
            <span className="tabstrip-meta">
              <span className="status-dot passed" />
              {revision}
            </span>
          </div>

          <div className={`view ${isFill ? "view-fill" : ""}`} ref={viewRef}>
            {renderSurface()}
          </div>

          {consoleOpen && (
            <ResizeHandle
              orientation="row"
              label="Resize run console"
              onPointerDown={startResize("console")}
              onKeyDown={resizeWithKeyboard("console")}
            />
          )}
          <RunConsole
            jobs={jobs}
            activeJobId={activeJobId}
            open={consoleOpen}
            height={consoleHeight}
            onSelectJob={setActiveJobId}
            onClear={() => {
              setJobs([]);
              setActiveJobId(null);
            }}
            onToggle={() => setConsoleOpen((open) => !open)}
          />
        </section>

        {assistantOpen && (
          <ResizeHandle
            orientation="column"
            label="Resize assistant panel"
            onPointerDown={startResize("assistant")}
            onKeyDown={resizeWithKeyboard("assistant")}
          />
        )}

        <AssistantPanel
          width={assistantWidth}
          tab={assistantTab}
          onTabChange={setAssistantTab}
          onClose={() => setAssistantOpen(false)}
          hidden={!assistantOpen}
          constraints={constraints}
          iteration={effectiveIteration}
          checks={effectiveChecks}
          timingFixed={timingFixed}
          onApplyTimingRepair={applyTimingRepair}
          onRunChecks={runChecks}
          onOpenFile={openFile}
          onNavigate={navigate}
          notify={notify}
          agent={agent}
        />
      </div>

      <footer className="ide-statusbar" aria-label="Workbench status bar">
        <div className="ide-statusbar-left">
          <span className="ide-status-item">
            <span className="status-dot passed" />
            {ENGINE_SCHEMA}
          </span>
          <span className="ide-status-item">rev:{revision}</span>
          <span className="ide-status-item">events:{eventCursor}</span>
          <span className="ide-status-item">{lastRewind}</span>
        </div>
        <div className="ide-statusbar-right">
          <span className="ide-status-item">PDK: {constraints.pdk.toUpperCase()}</span>
          <span className="ide-status-item">
            Gates: {effectiveChecks.filter((c) => c.status === "passed").length} PASS · {failed} FAIL · {unsupported} NOT_RUN/UNSUP
          </span>
          <span className="ide-status-item">Grid: On</span>
          <span className="ide-status-item">Snap: On</span>
        </div>
      </footer>

      {shortcutsOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onClick={() => setShortcutsOpen(false)}
        >
          <div className="shortcuts-modal" onClick={(event) => event.stopPropagation()}>
            <div className="shortcuts-header">
              <div>
                <span className="eyebrow">KICAD-STYLE WORKBENCH NAVIGATION</span>
                <h2>Keyboard shortcuts</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close keyboard shortcuts"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="shortcuts-grid">
              <div>
                <span className="eyebrow">SURFACES</span>
                <div className="shortcut-row"><span>Overview</span><kbd>1</kbd></div>
                <div className="shortcut-row"><span>Schematic & Symbol Editor</span><kbd>2</kbd></div>
                <div className="shortcut-row"><span>Layout Viewer (KLayout)</span><kbd>3</kbd></div>
                <div className="shortcut-row"><span>Constraints (YAML)</span><kbd>4</kbd></div>
                <div className="shortcut-row"><span>Verification & Evidence</span><kbd>5</kbd></div>
                <div className="shortcut-row"><span>Waveforms & Spectra</span><kbd>6</kbd></div>
                <div className="shortcut-row"><span>Python / Tool Terminal</span><kbd>7</kbd></div>
                <div className="shortcut-row"><span>Deliverables & Export</span><kbd>8</kbd></div>
              </div>
              <div>
                <span className="eyebrow">PANELS & CANVAS</span>
                <div className="shortcut-row"><span>Toggle Project Explorer</span><kbd>⌘ / Ctrl + B</kbd></div>
                <div className="shortcut-row"><span>Toggle Run Console</span><kbd>⌘ / Ctrl + J</kbd></div>
                <div className="shortcut-row"><span>Toggle AI Assistant</span><kbd>⌘ / Ctrl + I</kbd></div>
                <div className="shortcut-row"><span>Save Active Source File</span><kbd>⌘ / Ctrl + S</kbd></div>
                <div className="shortcut-row"><span>Send Prompt to Rocket Fuel</span><kbd>⌘ / Ctrl + ↵</kbd></div>
                <div className="shortcut-row"><span>Pan Schematic / Layout</span><kbd>Drag Canvas</kbd></div>
                <div className="shortcut-row"><span>Zoom Schematic / Layout</span><kbd>Mouse Wheel</kbd></div>
                <div className="shortcut-row"><span>Show / Hide This Guide</span><kbd>?</kbd></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={14} />
          {toast}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}
