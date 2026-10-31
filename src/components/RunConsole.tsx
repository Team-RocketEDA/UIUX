import { useEffect, useRef, useState } from "react";
import type { Job } from "../types";
import { Icon } from "./icons";
import { ProgressBar } from "./ui";

export function RunConsole({
  jobs,
  activeJobId,
  open,
  height,
  onSelectJob,
  onClear,
  onToggle,
}: {
  jobs: Job[];
  activeJobId: string | null;
  open: boolean;
  height: number;
  onSelectJob: (id: string) => void;
  onClear: () => void;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState<"console" | "problems" | "output">("console");
  const problems = jobs.filter((job) => job.status === "failed");
  const selectedJob = jobs.find((job) => job.id === activeJobId) ?? jobs[0];
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [selectedJob?.id, selectedJob?.logs.length]);

  return (
    <section className={`run-console ${open ? "open" : "collapsed"}`} style={{ height: open ? height : 30 }}>
      <div className="console-header">
        <button className="console-toggle" onClick={onToggle} aria-expanded={open} aria-label="Toggle run console" title="Toggle run console">
          <Icon
            name="chevronDown"
            size={13}
            className={open ? "chevron-open" : "chevron-closed"}
          />
          <Icon name="terminal" size={13} />
          Console
        </button>
        <div className="console-tabs" role="tablist" aria-label="Console views">{(["console", "problems", "output"] as const).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); if (!open) onToggle(); }}>{item === "console" ? "Console" : item === "problems" ? `Problems (${problems.length})` : "Output"}</button>)}</div>
        {runningCount > 0 && (
          <span className="console-running">
            <span className="status-dot active" />
            {runningCount} running
          </span>
        )}
        {!open && selectedJob && (
          <span className={`console-latest ${selectedJob.status}`}>
            <span className="status-dot" />
            {selectedJob.title}
          </span>
        )}
        <div className="console-spacer" />
        <span className="console-count">{jobs.length} jobs</span>
        <button className="console-clear" onClick={onClear} disabled={jobs.length === 0}>
          Clear
        </button>
      </div>

      {open && (
        <div className={`console-body console-view-${tab}`}>
          {tab === "problems" ? <div className="console-problems">{problems.length ? problems.map((job) => <button className="problem-row" key={job.id} onClick={() => { onSelectJob(job.id); setTab("output"); }}><Icon name="warning" size={13} /><b>{job.tool}</b><span>{job.title}</span><small>{job.logs.filter((line) => /fail|error|violat/i.test(line)).join(" · ") || "Job failed; inspect output."}</small></button>) : <div className="console-empty">No failed jobs in this console.</div>}</div> : <>

          <div className="job-list" hidden={tab === "output"} role="list" aria-label="Runner jobs">
            {jobs.length === 0 ? (
              <div className="console-empty">
                <Icon name="play" size={16} />
                <span>Run a tool from the toolbelt, terminal, or verification surface.</span>
              </div>
            ) : (
              jobs.map((job) => (
                <button
                  key={job.id}
                  className={`job-row ${job.id === selectedJob?.id ? "selected" : ""}`}
                  onClick={() => onSelectJob(job.id)}
                  role="listitem"
                >
                  <span className={`job-state ${job.status}`}>
                    {job.status === "running" ? (
                      <span className="spinner" />
                    ) : job.status === "passed" ? (
                      <Icon name="check" size={12} />
                    ) : (
                      <Icon name="x" size={12} />
                    )}
                  </span>
                  <span className="job-copy">
                    <b>{job.title}</b>
                    <small>
                      {job.tool} · {job.startedAt}
                    </small>
                  </span>
                  {job.status === "running" && (
                    <span className="job-progress">
                      <ProgressBar value={job.progress} />
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          <div className="job-output">
            {selectedJob ? (
              <>
                <div className="job-output-header">
                  <div>
                    <span className="eyebrow">JOB OUTPUT</span>
                    <b>{selectedJob.tool}</b>
                  </div>
                  <span className={`job-status-text ${selectedJob.status}`}>
                    <span className="status-dot" />
                    {selectedJob.status.toUpperCase()}
                  </span>
                </div>
                <div className="job-logs" ref={logRef}>
                  {selectedJob.logs.length === 0 && (
                    <div className="log-line muted">Waiting for runner output…</div>
                  )}
                  {selectedJob.logs.map((line, index) => (
                    <div
                      className={`log-line ${
                        /fail|error|violat|✕/i.test(line) ? "error" : ""
                      } ${/pass|✓|complete/i.test(line) ? "success" : ""}`}
                      key={index}
                    >
                      <span className="log-index">{String(index + 1).padStart(2, "0")}</span>
                      {line}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="console-empty">
                <Icon name="terminal" size={18} />
                <span>No job selected.</span>
              </div>
            )}
          </div>
          </>}
        </div>
      )}
    </section>
  );
}
