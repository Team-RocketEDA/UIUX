import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { api, checkRows, formatNumber, jobStatus, type Evidence, type FileEntry, type ProjectSummary, type WorkspaceStatus } from "./api";
import type { ActiveView, Job, ProjectFile, SurfaceId } from "./types";
import { ActivityBar } from "./components/ActivityBar";
import { AssistantPanel } from "./components/AssistantPanel";
import { Icon, type IconName } from "./components/icons";
import { DiagramsView } from "./components/DiagramsView";
import { LiveView } from "./components/LiveView";
import type { SessionView } from "./agent/fuel";
import { ProjectPicker } from "./components/ProjectPicker";
import { RunConsole } from "./components/RunConsole";
import { Sidebar } from "./components/Sidebar";
import { SourceSurface } from "./components/SourceSurface";
import { ResizeHandle } from "./components/ui";
import { describeOperations, engineTools, toolNeeds, SHORTCUT_PAGES, ShortcutsDialog, TopBar, type EngineToolEntry } from "./components/TopBar";
import { PlotsView } from "./components/PlotsView";
import { EngineConsole } from "./components/EngineConsole";
import { LayoutView } from "./components/LayoutView";
import { SchematicView } from "./components/SchematicView";
import type { Proposal } from "./schematic/changes";
import { ChecksView, ConstraintsView, ExportView, OverviewView, verificationReport } from "./components/WorkspaceViews";

const surfaceMeta: Record<SurfaceId, { label: string; icon: IconName }> = {
  overview: { label: "Overview", icon: "home" },
  live: { label: "Live build", icon: "pulse" },
  schematic: { label: "Schematic", icon: "schematic" },
  diagrams: { label: "Diagrams", icon: "diagram" },
  layout: { label: "Layout", icon: "layout" },
  constraints: { label: "Constraints", icon: "constraints" },
  verification: { label: "Verification", icon: "verification" },
  plots: { label: "Plots", icon: "plot" },
  terminal: { label: "Terminal", icon: "terminal" },
  export: { label: "Export", icon: "export" },
};

const fillViews = new Set<SurfaceId>(["schematic", "layout", "terminal"]);
const POLL_MS = 3000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const LANGUAGES: Record<string, string> = { cir: "SPICE", sp: "SPICE", spice: "SPICE", yaml: "YAML", yml: "YAML", py: "Python", v: "Verilog", sv: "SystemVerilog", json: "JSON", md: "Markdown", log: "Log" };

function toProjectFile(entry: FileEntry, content = ""): ProjectFile {
  const top = entry.path.split("/")[0];
  const kind: ProjectFile["kind"] =
    top === "design" ? "source" : top === "tests" ? "test" : top === "results" ? "result" : top === "ip" ? "ip" : top === "workflows" ? "workflow" : "config";
  const extension = entry.path.split(".").pop() ?? "";
  return { path: entry.path, kind, language: LANGUAGES[extension] ?? "Text", content, readOnly: entry.readOnly };
}

const FILES_OPEN_KEY = "rocketide.files.open";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}

export function App() {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [checked, setChecked] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<Evidence[]>([]);

  // A #surface in the URL (e.g. #verification) opens that page directly.
  const initialSurface = (Object.keys(surfaceMeta) as SurfaceId[]).find((id) => `#${id}` === window.location.hash) ?? "overview";
  const [surface, setSurface] = useState<SurfaceId>(initialSurface);
  const [view, setView] = useState<ActiveView>({ kind: "surface", id: initialSurface });
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());

  // The file tree starts hidden; Files in the navigation (or Ctrl+B) brings it back, and the choice is remembered.
  const [sidebarOpen, setSidebarOpen] = useState(() => readFlag(FILES_OPEN_KEY, false));
  useEffect(() => saveFlag(FILES_OPEN_KEY, sidebarOpen), [sidebarOpen]);
  const [sidebarWidth, setSidebarWidth] = useState(232);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantWidth, setAssistantWidth] = useState(400);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(196);
  const [running, setRunning] = useState(false);
  // What the assistant's pending netlist change would do; the schematic highlights it.
  const [proposal, setProposal] = useState<Proposal>();

  const [tools, setTools] = useState<EngineToolEntry[] | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // A request for the assistant prepared by a toolbelt button; the user reviews it before sending.
  const [draft, setDraft] = useState<{ text: string; id: number }>();
  const [activity, setActivity] = useState<SessionView>();
  const wasBusy = useRef(false);

  const [toast, setToast] = useState<string | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  const notify = (message: string) => setToast(message);

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(null));
    // The workspace server keeps the open project across page reloads.
    api.project().then((open) => setProject(open)).catch(() => setProject(null)).finally(() => setChecked(true));
  }, []);

  const refresh = useCallback(async () => {
    const [summary, files, runs] = await Promise.all([api.project(), api.files(), api.evidence()]);
    setProject(summary);
    setEntries(files);
    setEvidence(runs);
  }, []);

  // The agent edits files and runs checks on its own, so keep the project view in step.
  useEffect(() => {
    if (!project) return;
    void refresh().catch(() => undefined);
    const timer = window.setInterval(() => void refresh().catch(() => undefined), POLL_MS);
    return () => window.clearInterval(timer);
  }, [project?.name, refresh]);

  useEffect(() => {
    viewRef.current?.scrollTo({ top: 0 });
  }, [view]);

  // Back/forward or an edited #page in the address bar switches page too.
  useEffect(() => {
    const onHash = () => {
      const id = (Object.keys(surfaceMeta) as SurfaceId[]).find((page) => `#${page}` === window.location.hash);
      if (!id) return;
      setSurface(id);
      setView({ kind: "surface", id });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // What the engine can run, asked again for each project opened (the server re-asks on open). A late answer
  // for a project that is no longer open is dropped.
  const toolsFor = useRef("");
  useEffect(() => {
    if (!project) return;
    const name = project.name;
    toolsFor.current = name;
    setTools(null);
    api.engineJobs()
      .then((kinds) => toolsFor.current === name && setTools(engineTools(kinds)))
      .catch((err) => {
        if (toolsFor.current !== name) return;
        setTools([]);
        notify(`Could not ask Rocket Engine what it can run: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [project?.name]);

  // Asks the engine again: from the Engine label, and quietly after each run, so a tool installed while the
  // IDE is open shows up without a restart. The old answer stays on screen until the new one arrives.
  const refreshTools = (quiet = false) => {
    const name = project?.name ?? "";
    if (!quiet) setTools(null);
    api.engineJobs(true)
      .then((kinds) => toolsFor.current === name && setTools(engineTools(kinds)))
      .catch((err) => {
        if (toolsFor.current !== name) return;
        if (!quiet) setTools([]);
        notify(`Could not ask Rocket Engine what it can run: ${err instanceof Error ? err.message : String(err)}`);
      });
  };

  // Keys: 1–8 pages, Ctrl+B files, Ctrl+J console, Ctrl+I assistant, ? this list, Esc closes it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.closest("input, textarea, select, [contenteditable=true]");
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.shiftKey && !event.altKey) {
        const key = event.key.toLowerCase();
        const toggle = key === "b" ? setSidebarOpen : key === "j" ? setConsoleOpen : key === "i" ? setAssistantOpen : undefined;
        if (toggle) {
          event.preventDefault();
          toggle((open) => !open);
        }
        return;
      }
      if (event.key === "Escape" && shortcutsOpen) setShortcutsOpen(false);
      if (typing || event.altKey) return;
      if (event.key === "?") setShortcutsOpen((open) => !open);
      const page = SHORTCUT_PAGES[Number(event.key) - 1];
      if (/^[1-8]$/.test(event.key) && page) navigate(page);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const resetWorkspaceState = () => {
    setEntries([]);
    setContents({});
    setEvidence([]);
    setOpenFiles([]);
    setDirtyFiles(new Set());
    setJobs([]);
    setActiveJobId(null);
    setSurface("overview");
    setView({ kind: "surface", id: "overview" });
  };

  // A new project can open with its first request in the assistant's box, ready to review and send.
  const openProject = async (name: string, firstRequest?: string) => {
    try {
      resetWorkspaceState();
      setProject(await api.openProject(name));
      if (firstRequest) setDraft({ text: firstRequest, id: Date.now() });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  const switchProject = async () => {
    if (dirtyFiles.size && !window.confirm("Discard unsaved changes and switch project?")) return;
    await api.closeProject().catch(() => undefined);
    resetWorkspaceState();
    setProject(null);
  };

  // When the assistant starts working, show what it's building rather than the project summary. Only from Overview: if
  // you've gone somewhere else, you meant to.
  useEffect(() => {
    const busy = activity?.status === "busy";
    if (busy && !wasBusy.current && view.kind === "surface" && view.id === "overview") navigate("live");
    wasBusy.current = busy;
  }, [activity?.status]);

  const navigate = (nextSurface: SurfaceId) => {
    setSurface(nextSurface);
    setView({ kind: "surface", id: nextSurface });
    window.history.replaceState(null, "", `#${nextSurface}`);
  };

  const openFile = async (path: string) => {
    if (!entries.some((entry) => entry.path === path)) {
      notify(`${path} is not in the project.`);
      return;
    }
    if (!(path in contents)) {
      try {
        const file = await api.readFile(path);
        setContents((previous) => ({ ...previous, [path]: file.content }));
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
        return;
      }
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
    setContents((previous) => ({ ...previous, [path]: content }));
    setDirtyFiles((previous) => new Set(previous).add(path));
  };

  const saveFile = async (path: string) => {
    try {
      setProject(await api.saveFile(path, contents[path] ?? ""));
      setDirtyFiles((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
      notify(`${path} saved and committed.`);
      void refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  // Save text that didn't come from an open editor tab (e.g. the constraints form).
  const saveContent = async (path: string, content: string) => {
    try {
      setProject(await api.saveFile(path, content));
      if (path in contents && !dirtyFiles.has(path)) setContents((previous) => ({ ...previous, [path]: content }));
      notify(`${path} saved and committed.`);
      void refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  // Files the agent changed on disk: reload any open file without unsaved edits.
  useEffect(() => {
    for (const path of openFiles) {
      if (dirtyFiles.has(path)) continue;
      void api.readFile(path).then((file) =>
        setContents((previous) => (previous[path] === file.content ? previous : { ...previous, [path]: file.content })),
      ).catch(() => undefined);
    }
  }, [project?.revision, evidence.length]);

  const runChecks = async () => {
    if (running || !project) return;
    const id = `job-${Date.now()}`;
    const startedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setRunning(true);
    const operation = project.constraints.simulation?.operation ?? "run_spice";
    setJobs((previous) => [{ id, title: "Run checks", tool: `${operation} via Rocket Engine`, status: "running" as const, progress: 10,
      logs: [`$ ${operation} ${(project.constraints.simulation?.sources ?? []).join(" ")}`], startedAt }, ...previous].slice(0, 10));
    setActiveJobId(id);
    setConsoleOpen(true);
    try {
      const result = await api.runChecks();
      const runs = await api.evidence();
      setEvidence(runs);
      const record = runs.find((run) => run.run_id === result.run_id);
      const verdict = result.verdict;
      const lines = [
        ...(record?.log ? record.log.split("\n").slice(-40) : []),
        ...(verdict.measurements ?? []).map((m) => `${m.name} = ${formatNumber(m.value)} ${m.unit} (${m.status}, margin ${formatNumber(m.margin)})`),
        `verdict: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ""} · run ${result.run_id}`,
      ];
      setJobs((previous) => previous.map((job) => (job.id === id
        ? { ...job, status: jobStatus(verdict.status), progress: 100, logs: [...job.logs, ...lines] }
        : job)));
      notify(`Checks finished: ${verdict.status.replace("_", " ")}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setJobs((previous) => previous.map((job) => (job.id === id ? { ...job, status: "failed" as const, progress: 100, logs: [...job.logs, message] } : job)));
      notify(message);
    } finally {
      setRunning(false);
      refreshTools(true);
    }
  };

  const openAssistant = () => setAssistantOpen(true);

  const runTool = (tool: EngineToolEntry) => {
    const what = describeOperations(tool.operations);
    if (!tool.available) {
      notify(`Rocket Engine can't run ${what} with ${tool.name} here: ${toolNeeds(tool) || "it gave no reason"}.`);
    } else if (tool.name === "ngspice") {
      void runChecks();
    } else {
      // Other tools need inputs only the design knows (which GDS, which testbench); the assistant picks them.
      setAssistantOpen(true);
      setDraft({ text: `Run the engine's ${what} with ${tool.name} on this project and tell me the verdict.`, id: Date.now() });
    }
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
          setAssistantWidth(clamp(startAssistant - (moveEvent.clientX - startX), 320, 640));
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
          clamp(width + (event.key === "ArrowLeft" ? step : -step), 320, 640),
        );
      } else {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        setConsoleHeight((height) =>
          clamp(height + (event.key === "ArrowUp" ? step : -step), 120, 420),
        );
      }
    };
  if (!checked) return <main className="picker-shell" />;
  if (!project) return <ProjectPicker onOpen={(name, firstRequest) => void openProject(name, firstRequest)} />;

  const files = entries.map((entry) => toProjectFile(entry, contents[entry.path]));
  const activeFile = view.kind === "file" ? files.find((file) => file.path === view.path) : null;
  const rows = checkRows(project.constraints, evidence, project.revision);
  const issues = rows.filter((row) => row.status === "FAIL" || row.status === "NOT_RUN").length;
  const runningJobs = jobs.filter((job) => job.status === "running").length;
  const isFill = view.kind === "file" || fillViews.has(surface);
  const exportReport = () => verificationReport(project, evidence);

  const renderSurface = () => {
    if (view.kind === "file") {
      if (!activeFile || !(activeFile.path in contents)) {
        return (
          <div className="empty-state page-surface">
            <Icon name="file" size={24} />
            <b>File not available</b>
            <span>It may have been removed. Open another project file from the explorer.</span>
          </div>
        );
      }
      return (
        <SourceSurface
          key={activeFile.path}
          file={activeFile}
          dirty={dirtyFiles.has(activeFile.path)}
          onChange={(content) => changeFile(activeFile.path, content)}
          onSave={() => void saveFile(activeFile.path)}
        />
      );
    }

    switch (surface) {
      case "overview":
        return (
          <OverviewView
            project={project}
            evidence={evidence}
            running={running}
            onNavigate={navigate}
            onRunChecks={() => void runChecks()}
            onOpenAssistant={openAssistant}
            onAsk={(text) => {
              setAssistantOpen(true);
              setDraft({ text, id: Date.now() });
            }}
            engineTools={tools}
          />
        );
      case "schematic":
        return (
          <SchematicView
            paths={entries.map((entry) => entry.path)}
            revision={entries.map((entry) => entry.modified).join(",")}
            readFile={async (path) => (await api.readFile(path)).content}
            onOpenFile={(path) => void openFile(path)}
            onAsk={openAssistant}
            onAskAbout={(text) => {
              openAssistant();
              setDraft({ text, id: Date.now() });
            }}
            proposal={proposal}
          />
        );
      case "plots":
        return (
          <PlotsView
            evidence={evidence}
            constraints={project.constraints}
            running={running}
            readFile={async (path) => (await api.readFile(path)).content}
            onRunChecks={() => void runChecks()}
          />
        );
      case "constraints":
        return (
          <ConstraintsView
            project={project}
            readFile={async (path) => (await api.readFile(path)).content}
            onSave={saveContent}
            onOpenFile={(path) => void openFile(path)}
          />
        );
      case "verification":
        return (
          <ChecksView project={project} evidence={evidence} running={running} onRunChecks={() => void runChecks()} onExportReport={exportReport}
            onOpenFile={(path) => void openFile(path)} />
        );
      case "live":
        return (
          <LiveView
            project={project}
            entries={entries}
            evidence={evidence}
            activity={activity}
            onAsk={(text) => {
              openAssistant();
              setDraft({ text, id: Date.now() });
            }}
            onOpenFile={(path) => void openFile(path)}
            onNavigate={navigate}
          />
        );
      case "diagrams":
        return <DiagramsView entries={entries} onAsk={(text) => { openAssistant(); setDraft({ text, id: Date.now() }); }} />;
      case "layout":
        return (
          <LayoutView
            paths={entries.map((entry) => entry.path)}
            revision={entries.map((entry) => entry.modified).join(",")}
            klayout={status?.tools.klayout ?? false}
            onAsk={openAssistant}
            onOpenFile={(path) => void openFile(path)}
          />
        );
      case "terminal":
        return <EngineConsole project={project} evidence={evidence} />;
      case "export":
        return <ExportView project={project} evidence={evidence} onExportReport={exportReport} />;
    }
  };

  const agentStatus = project.agent.state === "ready" ? "connected" : project.agent.state === "starting" ? "starting" : "offline";

  return (
    <div className="app-frame">
    <TopBar
      projectName={project.name}
      branch={project.branch}
      revision={project.revision}
      dirty={project.dirty}
      tools={tools}
      runningJobs={runningJobs}
      agentStatus={agentStatus}
      onSwitchProject={() => void switchProject()}
      onRunTool={runTool}
      onRefreshTools={() => refreshTools()}
      onShortcuts={() => setShortcutsOpen(true)}
      onExport={() => navigate("export")}
    />
    <main className="app-shell">
      <ActivityBar
        surface={view.kind === "surface" ? surface : null}
        onNavigate={navigate}
        explorerOpen={sidebarOpen}
        onToggleExplorer={() => setSidebarOpen((open) => !open)}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => setAssistantOpen((open) => !open)}
        onSwitchProject={() => void switchProject()}
        issues={issues}
        checksRunning={running}
        plotRuns={evidence.filter((run) => run.datasets?.length).length}
        agentState={project.agent.state}
      />

      {sidebarOpen && (
        <>
          <Sidebar
            files={files}
            dirtyFiles={dirtyFiles}
            openFilePath={view.kind === "file" ? view.path : null}
            onOpenFile={(path) => void openFile(path)}
            width={sidebarWidth}
            pdk={project.constraints.pdk}
            domains={project.constraints.domains}
            onOpenConstraints={() => navigate("constraints")}
          />
          <ResizeHandle
            orientation="column"
            label="Resize files"
            onPointerDown={startResize("sidebar")}
            onKeyDown={resizeWithKeyboard("sidebar")}
          />
        </>
      )}

      <section className="main">
        <header className="main-head">
          <div className="tabs" role="tablist" aria-label="Open views">
            <button
              className={`tab ${view.kind === "surface" ? "active" : ""}`}
              role="tab"
              aria-selected={view.kind === "surface"}
              onClick={() => setView({ kind: "surface", id: surface })}
            >
              <Icon name={surfaceMeta[surface].icon} size={13} />
              {surfaceMeta[surface].label}
            </button>
            {openFiles.map((path) => {
              const file = files.find((item) => item.path === path);
              const isActive = view.kind === "file" && view.path === path;
              return (
                <span className={`tab file ${isActive ? "active" : ""}`} key={path}>
                  <button role="tab" aria-selected={isActive} onClick={() => setView({ kind: "file", path })} title={path}>
                    <Icon name={file?.readOnly ? "lock" : "file"} size={12} />
                    {path.split("/").pop()}
                    {dirtyFiles.has(path) && <i className="dirty-dot" />}
                  </button>
                  <button
                    className="tab-close"
                    onClick={() => closeFile(path)}
                    aria-label={`Close ${path}`}
                    title={`Close ${path}`}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              );
            })}
          </div>
          <button className={`ghost-icon ${consoleOpen ? "on" : ""}`} onClick={() => setConsoleOpen((open) => !open)} title="Run console" aria-label="Toggle run console">
            <Icon name="terminal" size={15} />
            {runningJobs > 0 && <i className="running-dot" />}
          </button>
        </header>

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
        <>
          <ResizeHandle
            orientation="column"
            label="Resize assistant"
            onPointerDown={startResize("assistant")}
            onKeyDown={resizeWithKeyboard("assistant")}
          />
          <AssistantPanel
            key={project.name}
            width={assistantWidth}
            onClose={() => setAssistantOpen(false)}
            constraints={project.constraints}
            lesson={project.lesson}
            onActivity={setActivity}
            agentState={project.agent.state}
            onOpenFile={(path) => void openFile(path)}
            onNavigate={navigate}
            readFile={async (path) => (await api.readFile(path)).content}
            onProposal={setProposal}
            draft={draft}
          />
        </>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {toast}
      </div>
    </main>
    {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
