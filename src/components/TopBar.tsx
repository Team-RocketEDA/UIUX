import { project } from "../data";
import { Icon } from "./icons";

export function TopBar({
  revision,
  runningJobs,
  onExport,
}: {
  revision: string;
  runningJobs: number;
  onExport: () => void;
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
      </div>

      <div className="topbar-actions">
        <button className="secondary-button" onClick={onExport}>
          <Icon name="export" size={13} />
          Export
        </button>
        <div className="avatar" title="Signed in as Ayush">
          AA
        </div>
      </div>
    </header>
  );
}
