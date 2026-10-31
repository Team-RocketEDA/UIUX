import type { SurfaceId } from "../types";
import { Icon, type IconName } from "./icons";

const PAGES: { id: SurfaceId; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "verification", label: "Verification", icon: "verification" },
  { id: "constraints", label: "Constraints", icon: "sliders" },
  { id: "schematic", label: "Schematic", icon: "schematic" },
  { id: "layout", label: "Layout", icon: "layout" },
  { id: "plots", label: "Plots", icon: "plot" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "export", label: "Export", icon: "export" },
];

// Slim icon rail: the page navigation (keys 1–8 in this order). Explorer, assistant and project at the bottom.
export function ActivityBar({
  surface,
  onNavigate,
  explorerOpen,
  onToggleExplorer,
  assistantOpen,
  onToggleAssistant,
  onSwitchProject,
  issues,
}: {
  surface: SurfaceId | null;
  onNavigate: (surface: SurfaceId) => void;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  onSwitchProject: () => void;
  issues: number;
}) {
  return (
    <nav className="rail" aria-label="Workbench">
      {PAGES.map((page) => (
        <button
          key={page.id}
          className={`rail-button ${surface === page.id ? "active" : ""}`}
          onClick={() => onNavigate(page.id)}
          title={page.label}
          aria-label={page.label}
          aria-current={surface === page.id ? "page" : undefined}
        >
          <Icon name={page.icon} size={18} />
          {page.id === "verification" && issues > 0 && <span className="rail-badge">{issues}</span>}
        </button>
      ))}
      <div className="rail-spacer" />
      <button
        className={`rail-button ${explorerOpen ? "active" : ""}`}
        onClick={onToggleExplorer}
        title="Files"
        aria-label="Toggle files"
        aria-pressed={explorerOpen}
      >
        <Icon name="folder" size={18} />
      </button>
      <button
        className={`rail-button ${assistantOpen ? "active" : ""}`}
        onClick={onToggleAssistant}
        title="Assistant"
        aria-label="Toggle assistant"
        aria-pressed={assistantOpen}
      >
        <Icon name="sparkles" size={18} />
      </button>
      <button className="rail-button" onClick={onSwitchProject} title="Switch project" aria-label="Switch project">
        <Icon name="history" size={18} />
      </button>
    </nav>
  );
}
