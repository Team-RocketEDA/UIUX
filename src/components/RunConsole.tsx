import { useEffect, useRef } from "react";
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
  const selectedJob = jobs.find((job) => job.id === activeJobId) ?? jobs[0];
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [selectedJob?.id, selectedJob?.logs.length]);

  return (
    <section className={`run-console ${open ? "open" : "collapsed"}`} style={{ height: open ? height : 38 }}>
      <div className="console-header">
        <button className="console-toggle" onClick={onToggle} aria-expanded={open}>
          <Icon
            name="chevronDown"
            size={13}
            className={open ? "chevron-open" : "chevron-closed"}
          />
          <Icon name="terminal" size={13} />
          Run console
        </button>
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
        <div className="console-body">
          <div className="job-list" role="list" aria-label="Runner jobs">
            {jobs.length === 0 ? (
              <div className="console-empty">
                <Icon name="play" size={16} />
                <span>Press Run checks to simulate the design. Agent runs appear under Verification.</span>
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
                    ) : job.status === "failed" ? (
                      <Icon name="x" size={12} />
                    ) : (
                      "–"
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
                    <span className="eyebrow">Output</span>
                    <b>{selectedJob.tool}</b>
                  </div>
                  <span className={`job-status-text ${selectedJob.status}`}>
                    <span className="status-dot" />
                    {selectedJob.status.replace("_", " ").toUpperCase()}
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
        </div>
      )}
    </section>
  );
}
