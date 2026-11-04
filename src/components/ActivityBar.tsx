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

function NavItem({
  icon,
  label,
  hint,
  active,
  pressed,
  badge,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  active?: boolean;
  pressed?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item ${active || pressed ? "active" : ""}`}
      onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      aria-current={active ? "page" : undefined}
      aria-pressed={pressed}
    >
      <span className="nav-icon">
        <Icon name={icon} size={17} />
        {!!badge && <span className="nav-dot" aria-hidden="true" />}
      </span>
      <span className="nav-label">{label}</span>
      {!!badge && (
        <span className="nav-badge" aria-label={`${badge} failing`}>
          {badge}
        </span>
      )}
      {hint && !badge && <kbd className="nav-key">{hint}</kbd>}
    </button>
  );
}

// The page navigation, labelled and grouped; it collapses to an icon rail. Files, assistant and project below.
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed((value) => {
      saveCollapsed(!value);
      return !value;
    });
  };
  let key = 0;
  return (
    <nav className={`rail ${collapsed ? "collapsed" : ""}`} aria-label="Workbench">
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
                onClick={() => onNavigate(page.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="nav-group nav-footer">
        <NavItem icon="folder" label="Files" hint="Ctrl B" pressed={explorerOpen} onClick={onToggleExplorer} />
        <NavItem icon="sparkles" label="Assistant" hint="Ctrl I" pressed={assistantOpen} onClick={onToggleAssistant} />
        <NavItem icon="history" label="Switch project" onClick={onSwitchProject} />
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
    </nav>
  );
}
