import { Logo } from "./Logo";
import type { JobKind } from "../api";
import { Icon } from "./icons";

// The engine's tools, grouped by design domain. Labels are the short marks shown on the bar.
const DOMAIN: Record<string, string> = {
  run_spice: "Analog",
  run_hdl_test: "Digital",
  run_syntax: "Digital",
  run_drc: "Layout",
  run_extraction: "Layout",
  run_lvs: "Layout",
  run_optical: "Photonic",
};
const DOMAINS = ["Analog", "Digital", "Layout", "Photonic"];
const MARK: Record<string, string> = { ngspice: "nG", icarus: "IV", slang: "SL", klayout: "K", magic: "M", netgen: "NG", sax: "SAX" };
const OPERATION: Record<string, string> = {
  run_spice: "SPICE simulation",
  run_hdl_test: "HDL testbench",
  run_syntax: "HDL syntax check",
  run_drc: "DRC",
  run_extraction: "parasitic extraction",
  run_lvs: "LVS",
  run_optical: "optical circuit simulation",
};

// A tool as the engine reports it (get_capabilities): whether it resolves here, what is missing and how to
// get it, and the readiness the engine gives each operation it serves. Nothing here is decided by the IDE.
export type EngineToolEntry = {
  name: string;
  available: boolean;
  missing: string[];
  remedy?: string;
  operations: string[];
  readiness: { operation: string; readiness: string; reason?: string }[];
  domain: string;
};

// One entry per tool (magic serves both DRC and extraction), in domain order. A tool takes the domain of
// the first operation it serves that has one, so ngspice is Analog even though post-layout sim lists first.
export function engineTools(kinds: JobKind[]): EngineToolEntry[] {
  const byName = new Map<string, EngineToolEntry>();
  for (const kind of kinds) {
    for (const tool of kind.tools) {
      const entry = byName.get(tool.name) ?? { ...tool, operations: [], readiness: [], domain: "Other" };
      entry.operations.push(kind.operation);
      entry.readiness.push({ operation: kind.operation, readiness: kind.readiness, reason: kind.reason });
      if (entry.domain === "Other" && DOMAIN[kind.operation]) entry.domain = DOMAIN[kind.operation];
      byName.set(tool.name, entry);
    }
  }
  return [...byName.values()].sort((a, b) => DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain));
}

export const describeOperations = (operations: string[]) => operations.map((op) => OPERATION[op] ?? op).join(" and ");

// The engine's own words for why a tool can't run here: what it found missing, and its remedy.
export const toolNeeds = (tool: EngineToolEntry) =>
  [tool.missing.length ? `missing ${tool.missing.join(", ")}` : "", tool.remedy ?? ""].filter(Boolean).join(". ");

const readinessLines = (tool: EngineToolEntry) =>
  tool.readiness.map((r) => `${r.operation}: ${r.readiness}${r.reason ? ` (${r.reason})` : ""}`).join("\n");

export function TopBar({
  projectName,
  branch,
  revision,
  dirty,
  tools,
  runningJobs,
  agentStatus,
  onSwitchProject,
  onRunTool,
  onRefreshTools,
  onShortcuts,
  onExport,
}: {
  projectName: string;
  branch: string;
  revision: string;
  dirty: boolean;
  tools: EngineToolEntry[] | null;
  runningJobs: number;
  agentStatus: "connected" | "starting" | "offline";
  onSwitchProject: () => void;
  onRunTool: (tool: EngineToolEntry) => void;
  onRefreshTools: () => void;
  onShortcuts: () => void;
  onExport: () => void;
}) {
  const unavailable = tools?.filter((tool) => !tool.available).length ?? 0;
  return (
    <header className="topbar">
      <button className="brand" onClick={onSwitchProject} title="Switch project">
        <Logo size={26} />
        <b>RocketEDA</b>
      </button>
      <button className="project-pill" onClick={onSwitchProject} title="Switch project">
        <Icon name="folder" size={13} />
        <b>{projectName}</b>
        {branch && <span>{branch}</span>}
      </button>

      <div className="toolbelt" role="toolbar" aria-label="Engine tools">
        <button
          className="toolbelt-label"
          onClick={onRefreshTools}
          disabled={!tools}
          title="What Rocket Engine says it can run on this machine (get_capabilities). Click to ask it again, e.g. after installing a tool."
        >
          Engine
          <small>{tools ? `${tools.length - unavailable}/${tools.length} ready` : "asking…"}</small>
        </button>
        {DOMAINS.map((domain) => {
          const group = (tools ?? []).filter((tool) => tool.domain === domain);
          if (!group.length) return null;
          return (
            <span className="tool-group" key={domain} title={domain}>
              {group.map((tool) => {
                const what = describeOperations(tool.operations);
                const summary = tool.available
                  ? `${tool.name}: ${what}. ${tool.name === "ngspice" ? "Runs the checks in constraints.yaml." : "Asks the assistant to run it on this project."}`
                  : `${tool.name}: ${what}. Rocket Engine can't run it here: ${toolNeeds(tool) || "no reason given"}.`;
                const title = `${summary}\n${readinessLines(tool)}`;
                return (
                  <button
                    key={tool.name}
                    className={`tool-mark ${tool.available ? "" : "unavailable"}`}
                    onClick={() => onRunTool(tool)}
                    title={title}
                    aria-label={summary}
                  >
                    {MARK[tool.name] ?? tool.name.slice(0, 3)}
                  </button>
                );
              })}
            </span>
          );
        })}
      </div>

      <div className="topbar-status">
        <span className="topbar-chip" title={dirty ? "Design files have changes that are not committed" : "Git revision of the project"}>
          <span className={`dot ${dirty ? "amber" : "green"}`} />
          {revision || "no commits"}
        </span>
        <span className="topbar-chip">
          <Icon name="terminal" size={12} />
          {runningJobs > 0 ? `${runningJobs} running` : "Runner ready"}
        </span>
        <span className="topbar-chip">
          <span className={`dot ${agentStatus === "connected" ? "green" : agentStatus === "starting" ? "amber" : "red"}`} />
          {agentStatus === "connected" ? "Agent connected" : agentStatus === "starting" ? "Agent starting" : "Agent offline"}
        </span>
      </div>
      <button className="btn ghost" onClick={onShortcuts} title="Keyboard shortcuts (?)">
        <kbd>?</kbd>
        Shortcuts
      </button>
      <button className="btn ghost" onClick={onExport}>
        <Icon name="export" size={13} />
        Export
      </button>
    </header>
  );
}

export const SHORTCUT_PAGES = ["overview", "verification", "constraints", "schematic", "layout", "plots", "terminal", "export"] as const;

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const pages = ["Overview", "Verification", "Constraints", "Schematic", "Layout", "Plots", "Terminal", "Export"];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <b>Keyboard shortcuts</b>
          <button className="ghost-icon" onClick={onClose} aria-label="Close keyboard shortcuts">
            <Icon name="close" size={15} />
          </button>
        </header>
        <div className="shortcut-columns">
          <div>
            <span className="eyebrow">Pages</span>
            {pages.map((page, index) => (
              <div className="shortcut-row" key={page}><span>{page}</span><kbd>{index + 1}</kbd></div>
            ))}
          </div>
          <div>
            <span className="eyebrow">Panels</span>
            <div className="shortcut-row"><span>Files</span><kbd>Ctrl B</kbd></div>
            <div className="shortcut-row"><span>Run console</span><kbd>Ctrl J</kbd></div>
            <div className="shortcut-row"><span>Assistant</span><kbd>Ctrl I</kbd></div>
            <span className="eyebrow">Editor</span>
            <div className="shortcut-row"><span>Save file</span><kbd>Ctrl S</kbd></div>
            <span className="eyebrow">Assistant</span>
            <div className="shortcut-row"><span>Send</span><kbd>Enter</kbd></div>
            <div className="shortcut-row"><span>New line</span><kbd>Shift Enter</kbd></div>
            <span className="eyebrow">This list</span>
            <div className="shortcut-row"><span>Show / hide</span><kbd>?</kbd></div>
            <div className="shortcut-row"><span>Close</span><kbd>Esc</kbd></div>
          </div>
        </div>
      </div>
    </div>
  );
}
