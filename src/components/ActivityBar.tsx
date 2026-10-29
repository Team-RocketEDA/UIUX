import type { SurfaceId } from "../types";
import { Icon } from "./icons";

export function ActivityBar({
  surface,
  sidebarOpen,
  onToggleSidebar,
  onNavigate,
  assistantOpen,
  onOpenAssistant,
}: {
  surface: SurfaceId;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNavigate: (surface: SurfaceId) => void;
  assistantOpen: boolean;
  onOpenAssistant: (tab: "chat" | "settings") => void;
}) {
  return (
    <aside className="activity-bar" aria-label="Workbench activity">
      <button
        className={`activity-button ${sidebarOpen ? "active" : ""}`}
        onClick={onToggleSidebar}
        title="Project explorer"
        aria-label="Toggle project explorer"
        aria-pressed={sidebarOpen}
      >
        <Icon name="folder" size={19} />
      </button>
      <button
        className={`activity-button ${surface === "schematic" ? "active" : ""}`}
        onClick={() => onNavigate("schematic")}
        title="Hierarchical schematic"
      >
        <Icon name="schematic" size={19} />
      </button>
      <button
        className={`activity-button ${surface === "layout" ? "active" : ""}`}
        onClick={() => onNavigate("layout")}
        title="Layout viewer"
      >
        <Icon name="layout" size={19} />
      </button>
      <button
        className={`activity-button ${surface === "verification" ? "active" : ""}`}
        onClick={() => onNavigate("verification")}
        title="Verification and evidence"
      >
        <Icon name="verification" size={19} />
      </button>

      <div className="activity-spacer" />

      <button
        className={`activity-button ${assistantOpen ? "active agent" : ""}`}
        onClick={() => onOpenAssistant("chat")}
        title="AI assistant"
        aria-pressed={assistantOpen}
      >
        <Icon name="sparkles" size={19} />
      </button>
      <button
        className="activity-button"
        onClick={() => onOpenAssistant("settings")}
        title="Model and runner settings"
      >
        <Icon name="settings" size={18} />
      </button>
    </aside>
  );
}
