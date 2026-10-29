import type { ToolDefinition } from "../types";
import { Icon } from "./icons";

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
  onToggleConsole,
  consoleOpen,
  onToggleAssistant,
  assistantOpen,
}: {
  tools: ToolDefinition[];
  onRunTool: (toolId: string) => void;
  onToggleConsole: () => void;
  consoleOpen: boolean;
  onToggleAssistant: () => void;
  assistantOpen: boolean;
}) {
  const unavailable = tools.filter((tool) => !tool.available).length;

  return (
    <div className="toolbelt">
      <div className="toolbelt-label">
        <span className="eyebrow">ENGINE TOOLBELT</span>
        <span className="toolbelt-count">
          {tools.length} tools
          {unavailable > 0 ? ` · ${unavailable} unavailable` : ""}
        </span>
      </div>

      <div className="toolbelt-scroll" role="toolbar" aria-label="Engine tools">
        {categoryOrder.map((category, groupIndex) => (
          <div className="toolbelt-group" key={category}>
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
                    onClick={() => onRunTool(tool.id)}
                  >
                    <span className="tool-button-icon">{tool.icon}</span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>

      <div className="toolbelt-actions">
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
