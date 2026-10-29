import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ActiveView,
  Check,
  ConstraintSet,
  Job,
  ProjectFile,
  SurfaceId,
} from "./types";
import {
  initialChecks,
  initialConstraints,
  initialFiles,
  initialRevision,
  project,
  toolRegistry,
} from "./data";
import { buildVerificationReport, downloadText } from "./utils";
import { ActivityBar } from "./components/ActivityBar";
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

const makeRevision = () => Math.random().toString(16).slice(2, 9);

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

export function App() {
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [constraints, setConstraints] = useState<ConstraintSet>(initialConstraints);
  const [checks, setChecks] = useState<Check[]>(initialChecks);
  const [revision, setRevision] = useState(initialRevision);
  const [iteration, setIteration] = useState(3);
  const [timingFixed, setTimingFixed] = useState(false);

  const [surface, setSurface] = useState<SurfaceId>("overview");
  const [view, setView] = useState<ActiveView>({ kind: "surface", id: "overview" });
  const [openFiles, setOpenFiles] = useState<string[]>(["design/digital/top.sv"]);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(244);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantWidth, setAssistantWidth] = useState(356);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("chat");

  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(196);

  const [toast, setToast] = useState<string | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);

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

  const saveFile = (path: string) => {
    setDirtyFiles((previous) => {
      const next = new Set(previous);
      next.delete(path);
      return next;
    });
    setRevision(makeRevision());
    notify(`${path} saved to the project working tree.`);
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

  const runTool = (toolId: string) => {
    const tool = toolRegistry.find((item) => item.id === toolId);
    if (!tool) return;
    if (!tool.available) {
      notify(`${tool.label} is unavailable: ${tool.unavailableReason}`);
      return;
    }
    const outcome = toolId === "opensta" && !timingFixed ? "failed" : "passed";
    startJob(`${tool.label} run`, tool.label, tool.logs, outcome);
    notify(`${tool.label} queued through the local runner.`);
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

  const runChecks = () => {
    if (checks.some((check) => check.status === "running")) return;
    const unsupportedCount = checks.filter((check) => check.status === "unsupported").length;
    const willFail = !timingFixed;

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

    const nextRevision = makeRevision();
    setTimingFixed(true);
    setIteration((previous) => previous + 1);
    setRevision(nextRevision);
    setFiles((previous) =>
      previous.map((file) => {
        if (file.path === "design/digital/gpio.sv") {
          return {
            ...file,
            content: file.content.replace(GPIO_COMBINATIONAL, GPIO_REGISTERED),
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

  const saveConstraints = (next: ConstraintSet) => {
    setConstraints(next);
    setFiles((previous) =>
      previous.map((file) =>
        file.path === "constraints.yaml"
          ? { ...file, content: constraintsToYaml(next) }
          : file,
      ),
    );
    setRevision(makeRevision());
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
  const failed = checks.filter((check) => check.status === "failed").length;
  const unsupported = checks.filter((check) => check.status === "unsupported").length;
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
            checks={checks}
            constraints={constraints}
            iteration={iteration}
            tools={toolRegistry}
            onNavigate={navigate}
            onOpenFile={openFile}
            onRunChecks={runChecks}
            onOpenAssistant={() => openAssistant("chat")}
          />
        );
      case "schematic":
        return <SchematicSurface onOpenFile={openFile} />;
      case "layout":
        return <LayoutSurface onOpenFile={openFile} onRunTool={runTool} />;
      case "constraints":
        return (
          <ConstraintsSurface
            constraints={constraints}
            checks={checks}
            onSave={saveConstraints}
            onOpenFile={openFile}
          />
        );
      case "verification":
        return (
          <VerificationSurface
            checks={checks}
            constraints={constraints}
            iteration={iteration}
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
        onExport={() => navigate("export")}
      />
      <Toolbelt
        tools={toolRegistry}
        onRunTool={runTool}
        onToggleConsole={() => setConsoleOpen((open) => !open)}
        consoleOpen={consoleOpen}
        onToggleAssistant={() => setAssistantOpen((open) => !open)}
        assistantOpen={assistantOpen}
      />

      <div className="workspace">
        <ActivityBar
          surface={surface}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onNavigate={navigate}
          assistantOpen={assistantOpen}
          onOpenAssistant={openAssistant}
        />

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
            <button
              className={`editor-tab surface-tab ${view.kind === "surface" ? "active" : ""}`}
              role="tab"
              aria-selected={view.kind === "surface"}
              onClick={() => setView({ kind: "surface", id: surface })}
            >
              <Icon name={surfaceMeta[surface].icon} size={13} />
              <span>{surfaceMeta[surface].label}</span>
            </button>

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
          iteration={iteration}
          checks={checks}
          timingFixed={timingFixed}
          onApplyTimingRepair={applyTimingRepair}
          onRunChecks={runChecks}
          onOpenFile={openFile}
          onNavigate={navigate}
          notify={notify}
        />
      </div>

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
