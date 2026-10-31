import { useEffect, useRef, useState } from "react";
import { api, type Evidence, type ProjectSummary } from "../api";
import { Icon } from "./icons";
import { SurfaceHeader } from "./ui";

// The Terminal page: Rocket Engine operations typed by hand ("run_spice {...}"), sent through the
// same project-bound engine call the assistant and Run checks use. Not a general shell.

type Entry = { id: number; command: string; status: "running" | "ok" | "error"; output: string; ms?: number };

// Kept for the session, so leaving the page doesn't lose the output.
let saved: Entry[] = [];
let savedHistory: string[] = [];

function template(operation: string, project: ProjectSummary, evidence: Evidence[]): Record<string, unknown> {
  const sim = project.constraints.simulation;
  const latest = evidence[0]?.run_id;
  switch (operation) {
    case "run_spice":
      return {
        sources: sim?.sources ?? [],
        analyses: sim?.analyses ?? [],
        measurements: (project.constraints.checks ?? []).map((check) => ({ name: check.metric })),
      };
    case "get_check_results":
    case "get_logs":
    case "get_job_status":
      return latest ? { run_id: latest } : {};
    default:
      return {};
  }
}

function summary(result: Record<string, unknown>): string | undefined {
  const verdict = (result.verdict ?? undefined) as { status?: string; reason?: string; measurements?: { name: string; value: number; status: string }[] } | undefined;
  if (verdict?.status) {
    const measured = verdict.measurements?.map((m) => `${m.name} ${m.value.toFixed(2)} ${m.status}`).join(" · ");
    return `${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ""}${measured ? ` · ${measured}` : ""}`;
  }
  if (result.ok === false) return `${result.code ?? "error"}: ${result.message ?? ""}`;
  return undefined;
}

export function EngineConsole({ project, evidence }: { project: ProjectSummary; evidence: Evidence[] }) {
  const [operations, setOperations] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>(saved);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>(savedHistory);
  const [cursor, setCursor] = useState<number>();
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = entries.some((entry) => entry.status === "running");

  useEffect(() => {
    api.engineOperations().then(setOperations).catch(() => setOperations([]));
  }, []);
  useEffect(() => {
    saved = entries;
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [entries]);
  useEffect(() => {
    savedHistory = history;
  }, [history]);

  const pick = (operation: string) => {
    setInput(`${operation} ${JSON.stringify(template(operation, project, evidence))}`);
    inputRef.current?.focus();
  };

  const run = async (line: string) => {
    const command = line.trim();
    if (!command || busy) return;
    setHistory((previous) => [...previous.filter((item) => item !== command), command].slice(-50));
    setCursor(undefined);
    setInput("");
    const id = Date.now();
    const update = (patch: Partial<Entry>) => setEntries((previous) => previous.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
    setEntries((previous) => [...previous, { id, command, status: "running", output: "" }]);
    const space = command.search(/\s/);
    const operation = space === -1 ? command : command.slice(0, space);
    const rest = space === -1 ? "" : command.slice(space).trim();
    if (operation === "help") {
      update({ status: "ok", output: `Engine operations: ${operations.join(", ")}\nType an operation and its arguments as JSON, e.g. ${operations.includes("run_spice") ? "run_spice {\"sources\": [...]}" : "list_job_kinds {}"}.\nClick an operation on the left for a filled-in example.` });
      return;
    }
    if (operations.length && !operations.includes(operation)) {
      update({ status: "error", output: `${operation} is not an engine operation. Type help for the list.` });
      return;
    }
    let args: Record<string, unknown> = {};
    try {
      args = rest ? JSON.parse(rest) : {};
    } catch (err) {
      update({ status: "error", output: `Arguments are not valid JSON: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    const started = performance.now();
    try {
      const result = await api.engineCall(operation, args);
      const headline = summary(result);
      update({ status: result.ok === false ? "error" : "ok", output: `${headline ? `${headline}\n\n` : ""}${JSON.stringify(result, null, 2)}`, ms: performance.now() - started });
    } catch (err) {
      update({ status: "error", output: err instanceof Error ? err.message : String(err), ms: performance.now() - started });
    }
  };

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void run(input);
    } else if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      const next = cursor === undefined ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next);
      setInput(history[next]);
    } else if (event.key === "ArrowDown" && cursor !== undefined) {
      event.preventDefault();
      const next = cursor + 1;
      setCursor(next >= history.length ? undefined : next);
      setInput(next >= history.length ? "" : history[next]);
    }
  };

  return (
    <div className="fill-surface console-page">
      <SurfaceHeader
        eyebrow="Tooling · Rocket Engine"
        title="Engine console"
        subtitle="Run Rocket Engine operations on this project by hand, the same calls the assistant makes. Runs record evidence like Run checks. This is not a general shell."
        actions={
          <button className="secondary-button" onClick={() => setEntries([])} disabled={!entries.length || busy}>
            Clear
          </button>
        }
      />
      <div className="console-layout">
        <aside className="panel console-ops">
          <span className="eyebrow">Operations</span>
          {operations.length === 0 && <p className="muted">Asking the engine…</p>}
          {operations.map((operation) => (
            <button key={operation} className="console-op mono" onClick={() => pick(operation)}>
              {operation}
            </button>
          ))}
        </aside>
        <div className="panel console-main">
          <div className="console-output" ref={outputRef} aria-live="polite">
            {entries.length === 0 && (
              <p className="muted">
                Pick an operation for a filled-in example, or type <span className="mono">help</span>. Enter runs it; ↑ and ↓ go through earlier commands.
              </p>
            )}
            {entries.map((entry) => (
              <div key={entry.id} className={`console-entry ${entry.status}`}>
                <div className="console-command mono">
                  <span className="console-prompt">{project.name} ›</span> {entry.command}
                </div>
                {entry.status === "running" ? (
                  <div className="console-running"><span className="spinner" /> running on the engine…</div>
                ) : (
                  <pre className="console-result">{entry.output}</pre>
                )}
                {entry.ms !== undefined && <div className="console-meta">{(entry.ms / 1000).toFixed(1)} s</div>}
              </div>
            ))}
          </div>
          <div className="console-input">
            <span className="console-prompt mono">{project.name} ›</span>
            <input
              ref={inputRef}
              className="mono"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKey}
              placeholder={busy ? "Waiting for the engine…" : "operation {json arguments}"}
              disabled={busy}
              aria-label="Engine command"
              spellCheck={false}
            />
            <button className="send" onClick={() => void run(input)} disabled={busy || !input.trim()} aria-label="Run">
              <Icon name="play" size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
