import { useEffect, useState } from "react";
import { api, timeAgo, type ProjectEntry, type Template, type WorkspaceStatus } from "../api";
import { Icon } from "./icons";
import { StatusPill } from "./ui";

// Start screen: open an existing project or create one from a template.
export function ProjectPicker({ onOpen }: { onOpen: (name: string) => void }) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("opamp-engine");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.status(), api.templates(), api.projects()])
      .then(([s, t, p]) => {
        setStatus(s);
        setTemplates(t);
        setProjects(p);
        if (t.length && !t.some((item) => item.id === "opamp-engine")) setTemplate(t[0].id);
      })
      .catch((err: Error) => setError(`Workspace server unreachable: ${err.message}`));
  }, []);

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.createProject(name.trim(), template);
      onOpen(created.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="picker-shell">
      <section className="picker">
        <header className="picker-header">
          <span className="brand-mark">R</span>
          <div>
            <h1>RocketEDA</h1>
            <p>Set your constraints. Describe your chip. Watch it get designed, tested and improved.</p>
          </div>
        </header>

        {error && <div className="agent-error">{error}</div>}

        <div className="picker-grid">
          <div className="panel picker-panel">
            <div className="panel-heading">
              <span className="eyebrow">NEW PROJECT</span>
            </div>
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                placeholder="my-opamp"
                autoFocus
                onChange={(event) => setName(event.target.value.toLowerCase())}
                onKeyDown={(event) => event.key === "Enter" && name.trim() && !busy && void create()}
              />
              <small>Lowercase letters, digits, - and _. The project becomes its own git repository.</small>
            </label>
            <div className="template-list" role="radiogroup" aria-label="Template">
              {templates.map((item) => (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={template === item.id}
                  className={`template-option ${template === item.id ? "selected" : ""}`}
                  onClick={() => setTemplate(item.id)}
                >
                  <b>{item.title}</b>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
            <button className="primary-button" disabled={!name.trim() || busy} onClick={() => void create()}>
              <Icon name="check" size={13} />
              {busy ? "Creating…" : "Create and open"}
            </button>
          </div>

          <div className="panel picker-panel">
            <div className="panel-heading">
              <span className="eyebrow">OPEN PROJECT</span>
              <small>{status?.projectsDir}</small>
            </div>
            {projects.length === 0 ? (
              <p className="picker-empty">No projects yet. Create one to start designing.</p>
            ) : (
              <div className="project-list">
                {projects.map((project) => (
                  <button key={project.name} className="project-row" onClick={() => onOpen(project.name)}>
                    <Icon name="folder" size={14} />
                    <div>
                      <b>{project.name}</b>
                      <span>{project.title} · edited {timeAgo(new Date(project.modified).toISOString())}</span>
                    </div>
                    <Icon name="chevronRight" size={13} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {status && (
          <footer className="picker-footer">
            <span>Rocket Engine</span>
            <StatusPill status={status.engineFound ? "ready" : "unavailable"} />
            {Object.entries(status.tools).map(([tool, found]) => (
              <span key={tool} className={`tool-chip ${found ? "found" : ""}`} title={found ? `${tool} is installed` : `${tool} is not on PATH`}>
                {tool}
              </span>
            ))}
          </footer>
        )}
      </section>
    </main>
  );
}
