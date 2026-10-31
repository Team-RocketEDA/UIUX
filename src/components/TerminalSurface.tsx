import { useEffect, useRef, useState } from "react";
import type { Check, ConstraintSet, ToolDefinition } from "../types";
import { Icon } from "./icons";
import { SurfaceHeader } from "./ui";

type TerminalLine = {
  kind: "command" | "output" | "muted" | "error" | "success";
  text: string;
};

const initialLines: TerminalLine[] = [
  { kind: "muted", text: "RocketEDA command adapter · simulated runner" },
  { kind: "muted", text: "Type help for commands. Tool jobs appear in the Console dock." },
];

export function TerminalSurface({
  checks,
  constraints,
  tools,
  onRunTool,
  onRunScript,
}: {
  checks: Check[];
  constraints: ConstraintSet;
  tools: ToolDefinition[];
  onRunTool: (toolId: string) => void;
  onRunScript: (script: string) => void;
}) {
  const [lines, setLines] = useState<TerminalLine[]>(initialLines);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const append = (...next: TerminalLine[]) => setLines((previous) => [...previous, ...next]);

  const execute = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    append({ kind: "command", text: trimmed });
    setHistory((previous) => [...previous, trimmed]);
    setHistoryIndex(-1);

    if (trimmed === "clear") {
      setLines([]);
      return;
    }
    if (trimmed === "help") {
      append(
        { kind: "output", text: "help                 show this reference" },
        { kind: "output", text: "checks               print verification status" },
        { kind: "output", text: "constraints          print active constraints" },
        { kind: "output", text: "run <tool>           queue a registered engine tool" },
        { kind: "output", text: "python <file|code>   submit a Python job through the runner" },
        { kind: "output", text: "clear                clear this terminal" },
        { kind: "muted", text: "The UI build simulates runner jobs; native execution lives behind the runner adapter." },
      );
      return;
    }
    if (trimmed === "checks") {
      append(
        ...checks.map<TerminalLine>((check) => ({
          kind:
            check.status === "passed"
              ? "success"
              : check.status === "failed"
                ? "error"
                : "muted",
          text: `${check.status.toUpperCase().padEnd(12)} ${check.name} — ${check.measured}`,
        })),
      );
      return;
    }
    if (trimmed === "constraints") {
      append(
        { kind: "output", text: `PDK:       ${constraints.pdk}` },
        { kind: "output", text: `Domains:   ${constraints.domains.join(", ")}` },
        { kind: "output", text: `Clock:     ${constraints.clockMhz} MHz` },
        { kind: "output", text: `Supply:    ${constraints.supplyV} V` },
        { kind: "output", text: `Optical:   ${constraints.wavelengthNm} nm` },
        { kind: "output", text: `Autonomy:  ${constraints.autonomy}` },
        { kind: "output", text: `Limit:     ${constraints.maxIterations} repair iterations` },
      );
      return;
    }
    if (trimmed.startsWith("run ")) {
      const query = trimmed.slice(4).trim().toLowerCase();
      const tool = tools.find(
        (item) => item.id === query || item.label.toLowerCase() === query,
      );
      if (!tool) {
        append({ kind: "error", text: `Unknown tool: ${query}. Type \`help\` for commands.` });
        return;
      }
      if (!tool.available) {
        append({ kind: "error", text: `${tool.label} is unavailable: ${tool.unavailableReason}` });
        return;
      }
      onRunTool(tool.id);
      append(
        { kind: "output", text: `Queued ${tool.label} through the local runner interface.` },
        { kind: "muted", text: "Job logs stream into the run console at the bottom of the workbench." },
      );
      return;
    }
    if (/^python(?:\s|$)/.test(trimmed)) {
      const script = trimmed.slice(6).trim();
      if (!script) {
        append({ kind: "error", text: "Provide a script path or inline Python code." });
        return;
      }
      onRunScript(script);
      append(
        { kind: "output", text: `Submitting python job: ${script.slice(0, 90)}${script.length > 90 ? "…" : ""}` },
        { kind: "success", text: "Job handed to the shared runner interface. See the run console." },
      );
      return;
    }

    append({
      kind: "error",
      text: `Command not found: ${trimmed}. Type \`help\` for supported commands.`,
    });
  };

  const submit = () => {
    execute(command);
    setCommand("");
  };

  const quickCommands = ["help", "checks", "run verilator", "run opensta", "python design/photonic/mzi.py"];

  return (
    <div className="fill-surface terminal-surface">
      <SurfaceHeader
        eyebrow="TOOLING / SHARED JOB INTERFACE"
        title="Project terminal"
        subtitle="Python scripting and direct tool jobs share the assistant's tool registry and runner interfaces."
        actions={
          <button className="secondary-button" onClick={() => setLines([])}>
            <Icon name="refresh" size={13} />
            Clear
          </button>
        }
      />

      <section className="panel terminal-panel">
        <div className="terminal-titlebar">
          <span className="terminal-tab active">
            <Icon name="code" size={12} />
            project shell
          </span>
          <span className="terminal-connection">
            <span className="status-dot passed" />
            local runner · simulated
          </span>
        </div>

        <div className="terminal-output" ref={outputRef} aria-live="polite">
          {lines.map((line, index) => (
            <div className={`terminal-line ${line.kind}`} key={index}>
              {line.kind === "command" && <span className="terminal-prompt">rocket-demo:~ $</span>}
              <span>{line.text}</span>
            </div>
          ))}
          <form
            className="terminal-input-row"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <span className="terminal-prompt">rocket-demo:~ $</span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  if (!history.length) return;
                  const nextIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
                  setHistoryIndex(nextIndex);
                  setCommand(history[nextIndex]);
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  if (historyIndex < 0) return;
                  const nextIndex = historyIndex + 1;
                  if (nextIndex >= history.length) {
                    setHistoryIndex(-1);
                    setCommand("");
                  } else {
                    setHistoryIndex(nextIndex);
                    setCommand(history[nextIndex]);
                  }
                }
              }}
              placeholder="Type a command…"
              aria-label="Terminal command"
              autoComplete="off"
              spellCheck={false}
            />
          </form>
        </div>

        <div className="terminal-footer">
          <span>commands run through the same job/tool interface as the assistant</span>
          <div className="quick-commands">
            {quickCommands.map((quick) => (
              <button key={quick} onClick={() => execute(quick)}>
                {quick}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
