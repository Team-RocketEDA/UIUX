import type { Check, ConstraintSet, ProjectFile } from "../types";
import { project as projectMeta } from "../data";
import { buildVerificationReport, downloadText } from "../utils";
import { Icon } from "./icons";
import { ProgressBar, StatusPill, SurfaceHeader } from "./ui";

const binaryArtifacts = [
  {
    path: "exports/riscv_top.gds",
    kind: "GDSII",
    size: "2.1 MB",
    producedBy: "LibreLane 2.4 / KLayout",
  },
  {
    path: "exports/mzi.gds",
    kind: "GDSII",
    size: "840 KB",
    producedBy: "GDSFactory / cspdk",
  },
];

function formatBytes(content: string) {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function ExportSurface({
  files,
  checks,
  constraints,
  revision,
  onOpenFile,
  notify,
}: {
  files: ProjectFile[];
  checks: Check[];
  constraints: ConstraintSet;
  revision: string;
  onOpenFile: (path: string) => void;
  notify: (message: string) => void;
}) {
  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const unsupported = checks.filter((check) => check.status === "unsupported").length;

  const exportReport = () => {
    downloadText(
      `verification-${revision}.md`,
      buildVerificationReport(checks, constraints, revision, projectMeta.name),
    );
    notify("Verification report downloaded.");
  };

  const exportBundle = () => {
    const bundle = {
      schema: "rocketeda.project-export.v1",
      project: projectMeta.name,
      revision,
      generatedAt: new Date().toISOString(),
      constraints,
      checks,
      files: Object.fromEntries(files.map((file) => [file.path, file.content])),
      runnerArtifacts: binaryArtifacts,
      disclaimer:
        "Text sources and reports are exported from local project state. Binary GDS files remain in runner artifact storage. This bundle is not foundry signoff.",
    };
    downloadText(
      `${projectMeta.name}-${revision}.json`,
      JSON.stringify(bundle, null, 2),
      "application/json",
    );
    notify("Project bundle downloaded.");
  };

  const sourceFiles = files.filter((file) => !file.readOnly);
  const evidenceFiles = files.filter((file) => file.readOnly);

  return (
    <div className="page-surface export-surface">
      <SurfaceHeader
        eyebrow="DELIVERABLES / REPRODUCIBILITY"
        title="Export"
        subtitle="Package project sources, configuration and verification evidence with traceable revision references."
        actions={
          <>
            <button className="secondary-button" onClick={exportReport}>
              <Icon name="download" size={13} />
              Export report
            </button>
            <button className="primary-button" onClick={exportBundle}>
              <Icon name="export" size={13} />
              Export project bundle
            </button>
          </>
        }
      />

      <div className="export-summary">
        <div className="export-summary-main">
          <span className="eyebrow">PROJECT SNAPSHOT</span>
          <h2>{projectMeta.name}</h2>
          <p>{projectMeta.title}</p>
          <div className="export-meta">
            <span>
              revision <b>{revision}</b>
            </span>
            <span>
              PDK <b>{constraints.pdk}</b>
            </span>
            <span>
              domains <b>{constraints.domains.join(", ")}</b>
            </span>
          </div>
        </div>
        <div className="export-score">
          <span className="eyebrow">VERIFICATION</span>
          <div className="export-score-value">
            {passed}
            <span>/{checks.length}</span>
          </div>
          <ProgressBar value={(passed / checks.length) * 100} />
          <small>
            {failed} failed · {unsupported} unsupported
          </small>
        </div>
      </div>

      <div className="export-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PROJECT SOURCES</span>
              <h2>Readable, versionable files</h2>
            </div>
            <span className="panel-note">{sourceFiles.length} files</span>
          </div>
          <div className="artifact-list">
            {sourceFiles.map((file) => (
              <div className="artifact-row" key={file.path}>
                <span className={`artifact-icon ${file.kind}`}>
                  <Icon name="file" size={14} />
                </span>
                <button className="artifact-path" onClick={() => onOpenFile(file.path)}>
                  <b>{file.path}</b>
                  <small>
                    {file.language} · {file.kind} · {formatBytes(file.content)}
                  </small>
                </button>
                <span className="artifact-ready">
                  <span className="status-dot passed" />
                  READY
                </span>
                <button
                  className="icon-button"
                  onClick={() =>
                    downloadText(file.path.split("/").pop() ?? "source.txt", file.content)
                  }
                  title={`Download ${file.path}`}
                  aria-label={`Download ${file.path}`}
                >
                  <Icon name="download" size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="export-side">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">EVIDENCE & REPORTS</span>
                <h2>Verification artifacts</h2>
              </div>
            </div>
            <div className="artifact-list compact">
              <div className="artifact-row">
                <span className="artifact-icon report">
                  <Icon name="verification" size={14} />
                </span>
                <span className="artifact-path static">
                  <b>verification-{revision}.md</b>
                  <small>Generated report · {checks.length} checks</small>
                </span>
                <button
                  className="icon-button"
                  onClick={exportReport}
                  title="Download verification report"
                  aria-label="Download verification report"
                >
                  <Icon name="download" size={14} />
                </button>
              </div>
              {evidenceFiles.map((file) => (
                <div className="artifact-row" key={file.path}>
                  <span className="artifact-icon evidence">
                    <Icon name="lock" size={13} />
                  </span>
                  <button className="artifact-path" onClick={() => onOpenFile(file.path)}>
                    <b>{file.path}</b>
                    <small>
                      {file.language} · {formatBytes(file.content)}
                    </small>
                  </button>
                  <button
                    className="icon-button"
                    onClick={() =>
                      downloadText(file.path.split("/").pop() ?? "evidence.txt", file.content)
                    }
                    title={`Download ${file.path}`}
                    aria-label={`Download ${file.path}`}
                  >
                    <Icon name="download" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">RUNNER ARTIFACTS</span>
                <h2>Binary layout outputs</h2>
              </div>
              <span className="viewer-pill">
                <Icon name="lock" size={11} />
                RUNNER STORAGE
              </span>
            </div>
            <div className="artifact-list compact">
              {binaryArtifacts.map((artifact) => (
                <div className="artifact-row" key={artifact.path}>
                  <span className="artifact-icon binary">
                    <Icon name="layout" size={14} />
                  </span>
                  <span className="artifact-path static">
                    <b>{artifact.path}</b>
                    <small>
                      {artifact.kind} · {artifact.size} · {artifact.producedBy}
                    </small>
                  </span>
                  <button
                    className="icon-button"
                    disabled
                    title="Binary artifact is held by the runner adapter; this UI build cannot download it."
                    aria-label="Binary artifact unavailable in UI build"
                  >
                    <Icon name="download" size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="artifact-note">
              <Icon name="warning" size={13} />
              GDS is not packaged by the UI mock. A real export requires the runner adapter and a
              configured artifact store.
            </p>
          </section>
        </div>
      </div>

      <div className="export-grid export-bottom">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">BUNDLE CONTENTS</span>
              <h2>What leaves the workbench</h2>
            </div>
          </div>
          <div className="bundle-grid">
            {[
              ["Project source", "RTL, SPICE, Python, schematic/layout YAML, tests and workflows", true],
              ["Configuration", "rocket.yaml, constraints.yaml, IP manifest and tool pins", true],
              ["Evidence", "Tool logs, timing report, spectra and generated verification report", true],
              ["Binary layout", "GDS/OASIS stays in runner artifact storage until explicitly fetched", false],
            ].map(([title, detail, included]) => (
              <div className="bundle-row" key={String(title)}>
                <span className={`bundle-check ${included ? "on" : "off"}`}>
                  {included ? <Icon name="check" size={11} /> : <Icon name="lock" size={11} />}
                </span>
                <div>
                  <b>{title}</b>
                  <p>{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">HONESTY CHECK</span>
              <h2>Before you share this result</h2>
            </div>
          </div>
          <div className="export-checks">
            <div className={`export-check ${failed > 0 ? "warning" : "ok"}`}>
              <StatusPill status={failed > 0 ? "failed" : "passed"} />
              <span>{failed > 0 ? "A required check is failing." : "All supported checks pass."}</span>
            </div>
            <div className={`export-check ${unsupported > 0 ? "warning" : "ok"}`}>
              <StatusPill status={unsupported > 0 ? "unsupported" : "passed"} />
              <span>
                {unsupported > 0
                  ? `${unsupported} checks have no compatible tool or deck.`
                  : "No unsupported checks."}
              </span>
            </div>
            <p className="export-disclaimer">
              A green dashboard is not foundry signoff. Verification is specific to the recorded
              PDK, models, tool versions and operating conditions.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
