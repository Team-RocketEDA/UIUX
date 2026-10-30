import { project } from "../data";
import type { AgentMode } from "../agent/useAgent";
import { Icon } from "./icons";

export function TopBar({
  revision,
  runningJobs,
  agentMode = "mock",
  agentConnected = false,
  onExport,
  onOpenShortcuts,
}: {
  revision: string;
  runningJobs: number;
  agentMode?: AgentMode;
  agentConnected?: boolean;
  onExport: () => void;
  onOpenShortcuts: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">R</span>
        <strong>
          Rocket<span>EDA</span>
        </strong>
      </div>

      <div className="project-pill">
        <Icon name="folder" size={13} />
        <b>{project.name}</b>
        <span className="branch">{project.branch}</span>
      </div>

      <div className="topbar-status">
        <span className="topbar-chip">
          <span className="status-dot passed" />
          {revision}
        </span>
        <span className="topbar-chip">
          <Icon name="terminal" size={12} />
          Local runner {runningJobs > 0 ? `· ${runningJobs} running` : "ready"}
        </span>
        {agentMode !== "mock" && (
          <span className="topbar-chip">
            <span className={`status-dot ${agentConnected ? "passed" : "unsupported"}`} />
            Fuel {agentMode.toUpperCase()}
          </span>
        )}
      </div>

      <div className="topbar-actions">
        <button
          className="secondary-button"
          onClick={onOpenShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <span className="kbd-badge">?</span>
          Shortcuts
        </button>
        <button className="secondary-button" onClick={onExport}>
          <Icon name="export" size={13} />
          Export
        </button>
        <div className="avatar" title="Team RocketEDA Workbench">
          TR
        </div>
      </div>
    </header>
  );
}
