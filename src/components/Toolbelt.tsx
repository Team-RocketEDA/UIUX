import { useState } from "react";
import type { ToolDefinition } from "../types";
import { Icon, ToolIcon } from "./icons";

const categoryOrder: ToolDefinition["category"][] = [
  "Layout",
  "Digital",
  "Analog",
  "Photonic",
  "Project",
];

export function Toolbelt({
  tools,
  onRunTool,
  sidebarOpen = true,
  onToggleSidebar,
  onToggleConsole,
  consoleOpen,
  onToggleAssistant,
  assistantOpen,
}: {
  tools: ToolDefinition[];
  onRunTool: (toolId: string) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onToggleConsole: () => void;
  consoleOpen: boolean;
  onToggleAssistant: () => void;
  assistantOpen: boolean;
}) {
  const [analysisMode, setAnalysisMode] = useState("Transient");

  return (
    <div className="toolbelt">
      {onToggleSidebar && (
        <button
          className={`toolbar-button ${sidebarOpen ? "active" : ""}`}
          onClick={onToggleSidebar}
          title="Toggle sidebar (⌘B)"
          aria-pressed={sidebarOpen}
        >
          <Icon name="folder" size={13} />
          Files
        </button>
      )}
      <div className="toolbelt-scroll" role="toolbar" aria-label="Engine tools">
        {categoryOrder.map((category, groupIndex) => (
          <div className="toolbelt-group" key={category} role="group" aria-label={category}>
            {groupIndex > 0 && <span className="toolbelt-separator" aria-hidden="true" />}
            {tools
              .filter((tool) => tool.category === category)
              .map((tool) => {
                const description = tool.available
                  ? `${tool.label} — ${tool.detail}. Run through the local runner.`
                  : `${tool.label} — unavailable: ${tool.unavailableReason}`;
                return (
                  <button
                    key={tool.id}
                    className={`tool-button ${tool.available ? "" : "unavailable"}`}
                    title={description}
                    aria-label={description}
                    disabled={!tool.available}
                    onClick={() => {
                      const mode: Record<string, string> = { ngspice: "AC", cace: "AC", magic: "DRC", drc: "DRC", librelane: "PnR", openroad: "PnR", verilator: "Transient" };
                      if (mode[tool.id]) setAnalysisMode(mode[tool.id]);
                      onRunTool(tool.id);
                    }}
                  >
                    <span className="tool-button-icon"><ToolIcon toolId={tool.id} fallback={tool.icon} /></span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      <div className="toolbelt-actions">
        <span className="analysis-mode" title="Last selected tool analysis mode">{analysisMode}</span>
        <button
          className={`toolbar-button ${consoleOpen ? "active" : ""}`}
          onClick={onToggleConsole}
          aria-pressed={consoleOpen}
        >
          <Icon name="terminal" size={13} />
          Console
        </button>
        <button
          className={`toolbar-button assistant ${assistantOpen ? "active" : ""}`}
          onClick={onToggleAssistant}
          aria-pressed={assistantOpen}
        >
          <Icon name="sparkles" size={13} />
          Assistant
        </button>
      </div>
    </div>
  );
}
