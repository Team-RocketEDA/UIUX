import { useEffect, useRef } from "react";
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
  const menuRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const closeMenus = (event: globalThis.PointerEvent | globalThis.KeyboardEvent) => {
      if (event instanceof globalThis.KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof globalThis.PointerEvent && menuRef.current?.contains(event.target as Node)) return;
      menuRef.current?.querySelectorAll("details[open]").forEach((menu) => menu.removeAttribute("open"));
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => { document.removeEventListener("pointerdown", closeMenus); document.removeEventListener("keydown", closeMenus); };
  }, []);
  const navigate = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  const menus = [
    { label: "File", items: [{ label: "Project overview", action: () => navigate("1") }, { label: "Export project…", action: onExport }] },
    { label: "Edit", items: [{ label: "Project constraints", action: () => navigate("4") }] },
    { label: "View", items: [{ label: "Overview", action: () => navigate("1") }, { label: "Layout", action: () => navigate("3") }, { label: "Waveforms", action: () => navigate("6") }] },
    { label: "Add", items: [{ label: "Component / Symbol editor", action: () => navigate("2") }] },
    { label: "Simulation", items: [{ label: "Verification checks", action: () => navigate("5") }, { label: "Waveforms & spectra", action: () => navigate("6") }] },
    { label: "Tools", items: [{ label: "Project terminal", action: () => navigate("7") }] },
    { label: "Help", items: [{ label: "Keyboard shortcuts", action: onOpenShortcuts }] },
  ];
  return (
    <header className="topbar">
      <div className="brand"><Icon name="schematic" size={17} /><strong>Rocket<span>EDA</span></strong></div>
      <nav ref={menuRef} className="desktop-menu" aria-label="Application menu">
        {menus.map((menu) => <details className="desktop-menu-item" key={menu.label} onToggle={(event) => {
          if (!event.currentTarget.open) return;
          const selected = event.currentTarget;
          menuRef.current?.querySelectorAll("details[open]").forEach((other) => { if (other !== selected) other.removeAttribute("open"); });
        }}>
          <summary>{menu.label}</summary>
          <div className="desktop-menu-popup">{menu.items.map((item) =>
            <button key={item.label} onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              item.action();
            }}>{item.label}</button>)}</div>
        </details>)}
      </nav>
      <div className="project-pill" title={`${project.name} / ${project.branch}`}>
        <Icon name="folder" size={12} /><b>{project.name}</b><span className="revision">rev:{revision}</span>
      </div>
      <div className="topbar-status">
        {runningJobs > 0 && <span className="topbar-chip"><span className="status-dot active" />{runningJobs} running</span>}
        <span className="topbar-chip" title={`Fuel ${agentConnected ? "connected" : "disconnected"}`}><span className={`status-dot ${agentConnected ? "passed" : "unsupported"}`} />Fuel {agentMode.toUpperCase()}</span>
      </div>
      <div className="topbar-actions">
        <button className="secondary-button" onClick={onOpenShortcuts} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><span className="kbd-badge">?</span></button>
        <button className="secondary-button" onClick={onExport}><Icon name="export" size={13} />Export</button>
      </div>
    </header>
  );
}
