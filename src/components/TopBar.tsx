import { Icon } from "./icons";

export function TopBar({
  projectName,
  revision,
  dirty,
  runningJobs,
  agentState,
  onExport,
  onSwitchProject,
}: {
  projectName: string;
  revision: string;
  dirty: boolean;
  runningJobs: number;
  agentState: string;
  onExport: () => void;
  onSwitchProject: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">R</span>
        <strong>
          Rocket<span>EDA</span>
        </strong>
      </div>

      <button className="project-pill" onClick={onSwitchProject} title="Switch project">
        <Icon name="folder" size={13} />
        <b>{projectName}</b>
        <span className="branch">switch</span>
      </button>

      <div className="topbar-status">
        <span className="topbar-chip" title="Git revision of the project">
          <span className={`status-dot ${dirty ? "running" : "passed"}`} />
          {revision || "no commits"}
          {dirty ? " +changes" : ""}
        </span>
        <span className="topbar-chip">
          <Icon name="terminal" size={12} />
          Engine {runningJobs > 0 ? `· ${runningJobs} running` : "ready"}
        </span>
        <span className="topbar-chip">
          <Icon name="sparkles" size={12} />
          Assistant {agentState}
        </span>
      </div>

      <div className="topbar-actions">
        <button className="secondary-button" onClick={onExport}>
          <Icon name="export" size={13} />
          Export
        </button>
      </div>
    </header>
  );
}
