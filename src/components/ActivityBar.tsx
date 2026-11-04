import { useState } from "react";
import type { SurfaceId } from "../types";
import { Icon, type IconName } from "./icons";

type Page = { id: SurfaceId; label: string; icon: IconName };

// Grouped in the order of the 1–8 keys (SHORTCUT_PAGES), so each page's number reads down the list.
const GROUPS: { title: string; pages: Page[] }[] = [
  {
    title: "Project",
    pages: [
      { id: "overview", label: "Overview", icon: "home" },
      { id: "verification", label: "Verification", icon: "verification" },
      { id: "constraints", label: "Constraints", icon: "sliders" },
    ],
  },
  {
    title: "Design",
    pages: [
      { id: "live", label: "Live build", icon: "pulse" },
      { id: "diagrams", label: "Diagrams", icon: "diagram" },
      { id: "schematic", label: "Schematic", icon: "schematic" },
      { id: "layout", label: "Layout", icon: "layout" },
      { id: "plots", label: "Plots", icon: "plot" },
    ],
  },
  {
    title: "Tools",
    pages: [
      { id: "terminal", label: "Terminal", icon: "terminal" },
      { id: "export", label: "Export", icon: "export" },
    ],
  },
];

const COLLAPSED_KEY = "rocketide.nav.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}

type Tip = { label: string; hint?: string; top: number };

function NavItem({
  icon,
  label,
  hint,
  active,
  pressed,
  badge,
  count,
  busy,
  status,
  collapsed,
  onTip,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  active?: boolean;
  pressed?: boolean;
  badge?: number;
  count?: number;
  busy?: boolean;
  status?: "ready" | "starting" | "error" | "stopped";
  collapsed: boolean;
  onTip: (tip: Tip | null) => void;
  onClick: () => void;
}) {
  const show = (event: { currentTarget: HTMLElement }) => {
    if (!collapsed) return;
    const box = event.currentTarget.getBoundingClientRect();
    onTip({ label: badge ? `${label} · ${badge} to fix` : label, hint, top: box.top + box.height / 2 });
  };
  const trailing = busy ? (
    <span className="spinner" aria-label="running" />
  ) : badge ? (
    <span className="nav-badge" aria-label={`${badge} to fix`}>
      {badge}
    </span>
  ) : count ? (
    <span className="nav-count" aria-label={`${count} runs`}>
      {count}
    </span>
  ) : hint ? (
    <kbd className="nav-key">{hint}</kbd>
  ) : null;
  return (
    <button
      className={`nav-item ${active || pressed ? "active" : ""}`}
      onClick={onClick}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => onTip(null)}
      onBlur={() => onTip(null)}
      title={collapsed ? undefined : hint ? `${label} (${hint})` : label}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      aria-pressed={pressed}
    >
      <span className="nav-icon">
        <Icon name={icon} size={17} />
        {!!badge && <span className="nav-dot" aria-hidden="true" />}
        {status && <span className={`nav-status ${status}`} aria-hidden="true" />}
      </span>
      <span className="nav-label">{label}</span>
      {trailing}
    </button>
  );
}

// The navigation: files and project switching at the top, then the labelled pages, the assistant at the bottom.
// It collapses to an icon rail with tooltips.
export function ActivityBar({
  surface,
  onNavigate,
  explorerOpen,
  onToggleExplorer,
  assistantOpen,
  onToggleAssistant,
  onSwitchProject,
  issues,
  checksRunning,
  plotRuns,
  agentState,
}: {
  surface: SurfaceId | null;
  onNavigate: (surface: SurfaceId) => void;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  onSwitchProject: () => void;
  issues: number;
  checksRunning: boolean;
  plotRuns: number;
  agentState: "starting" | "ready" | "error" | "stopped";
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [tip, setTip] = useState<Tip | null>(null);
  const toggle = () => {
    setTip(null);
    setCollapsed((value) => {
      saveCollapsed(!value);
      return !value;
    });
  };
  const agentLabel = agentState === "ready" ? "Assistant" : agentState === "starting" ? "Assistant (starting)" : agentState === "error" ? "Assistant (not running)" : "Assistant (stopped)";
  let key = 0;
  return (
    <nav className={`rail ${collapsed ? "collapsed" : ""}`} aria-label="Workbench">
      <div className="nav-group nav-top" role="group" aria-label="Workspace">
        <NavItem icon="folder" label="Files" hint="Ctrl B" pressed={explorerOpen} collapsed={collapsed} onTip={setTip} onClick={onToggleExplorer} />
        <NavItem icon="history" label="Switch project" collapsed={collapsed} onTip={setTip} onClick={onSwitchProject} />
      </div>
      <div className="nav-scroll">
        {GROUPS.map((group) => (
          <div className="nav-group" key={group.title} role="group" aria-label={group.title}>
            <span className="nav-heading">{group.title}</span>
            {group.pages.map((page) => (
              <NavItem
                key={page.id}
                icon={page.icon}
                label={page.label}
                hint={String(++key)}
                active={surface === page.id}
                badge={page.id === "verification" ? issues : undefined}
                busy={page.id === "verification" && checksRunning}
                count={page.id === "plots" ? plotRuns : undefined}
                collapsed={collapsed}
                onTip={setTip}
                onClick={() => onNavigate(page.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="nav-group nav-footer">
        <NavItem
          icon="sparkles"
          label={collapsed ? agentLabel : "Assistant"}
          hint="Ctrl I"
          pressed={assistantOpen}
          status={agentState}
          collapsed={collapsed}
          onTip={setTip}
          onClick={onToggleAssistant}
        />
        <button
          className="nav-collapse"
          onClick={toggle}
          title={collapsed ? "Show labels" : "Hide labels"}
          aria-label={collapsed ? "Show labels" : "Hide labels"}
          aria-expanded={!collapsed}
        >
          <Icon name="chevronRight" size={14} />
          <span className="nav-label">Collapse</span>
        </button>
      </div>
      {collapsed && tip && (
        <div className="nav-tip" role="tooltip" style={{ top: tip.top }}>
          {tip.label}
          {tip.hint && <kbd>{tip.hint}</kbd>}
        </div>
      )}
    </nav>
  );
}
