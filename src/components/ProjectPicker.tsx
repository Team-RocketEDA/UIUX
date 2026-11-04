import { useEffect, useState, type FormEvent } from "react";
import { api, timeAgo, type ProjectEntry, type Template, type WorkspaceStatus } from "../api";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { StatusPill } from "./ui";

const RECENT = 6;

function ProjectCard({ project, onOpen }: { project: ProjectEntry; onOpen: () => void }) {
  const [hasPicture, setHasPicture] = useState(true);
  return (
    <button className="home-card" onClick={onOpen}>
      <span className="home-card-picture">
        {hasPicture ? (
          <img src={`/api/projects/${encodeURIComponent(project.name)}/preview`} alt="" loading="lazy" onError={() => setHasPicture(false)} />
        ) : (
          <Icon name="layout" size={30} />
        )}
      </span>
      <b>{project.title}</b>
      <span className="home-card-text">{project.description}</span>
      <small className="home-card-foot">
        <span>Edited {timeAgo(new Date(project.modified).toISOString())}</span>
        {project.lastRun ? (
          <StatusPill status={project.lastRun === "PASS" ? "passed" : project.lastRun === "FAIL" ? "failed" : "skipped"} label={project.lastRun === "NOT_RUN" ? "NOT RUN" : project.lastRun} />
        ) : (
          <span>{project.checks ? `${project.checks} check${project.checks === 1 ? "" : "s"}, not run` : "No checks yet"}</span>
        )}
      </small>
    </button>
  );
}

function NewProjectDialog({ templates, onClose, onCreated }: { templates: Template[]; onClose: () => void; onCreated: (name: string, firstRequest?: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const starters = templates.filter((item) => !item.lesson);

  const start = async (template: string, title: string, firstRequest?: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const { name } = await api.createProjectFor(title, template);
      onCreated(name, firstRequest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wanted = text.trim();
    if (wanted) void start("empty", wanted, `Build this as a complete project: ${wanted}`);
  };

  return (
    <div className="home-dialog-backdrop" onClick={onClose}>
      <form className="home-dialog" role="dialog" aria-modal="true" aria-label="New project" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>What do you want to build?</h2>
          <button type="button" className="ghost-icon" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          autoFocus
          placeholder="An 8-bit counter with enable and reset, or a low-pass filter for audio…"
          aria-label="What do you want to build?"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
          }}
        />
        <p className="muted">The assistant builds it all, the files, targets and tests, and you watch it take shape. Real tools check the result.</p>
        {error && <div className="agent-error">{error}</div>}
        <footer>
          {starters.map((item) => (
            <button type="button" key={item.id} className="secondary-button" disabled={busy} title={item.description} onClick={() => void start(item.id, item.title)}>
              {item.id === "empty" ? "Start empty" : item.title}
            </button>
          ))}
          <span className="head-spacer" />
          <button className="primary-button" disabled={!text.trim() || busy}>
            <Icon name="sparkles" size={13} />
            {busy ? "Creating…" : "Create project"}
          </button>
        </footer>
      </form>
    </div>
  );
}

// The first thing you see: your recent work, a way to start something new, and the lessons.
export function ProjectPicker({ onOpen }: { onOpen: (name: string, firstRequest?: string) => void }) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.status(), api.templates(), api.projects()])
      .then(([s, t, p]) => {
        setStatus(s);
        setTemplates(t);
        setProjects(p);
      })
      .catch((err: Error) => setError(`Workspace server unreachable: ${err.message}`));
  }, []);

  const lessons = templates.filter((item) => item.lesson);
  const lessonIds = new Set(lessons.map((item) => item.id));
  const shown = showAll ? projects : projects.slice(0, RECENT);

  // A lesson is a project named after it. Coming back to one reopens your work rather than starting over.
  const startLesson = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try {
      if (!projects.some((project) => project.name === id)) await api.createProject(id, id);
      onOpen(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const tools = status ? Object.entries(status.tools) : [];
  const ready = tools.filter(([, found]) => found).length;

  return (
    <main className="home">
      <header className="home-head">
        <Logo size={40} animate="launch" title="RocketIDE" />
        <div>
          <h1>RocketIDE</h1>
          <p>Design chips with an AI agent beside you. Every result comes from a real tool.</p>
        </div>
        <span className="head-spacer" />
        <button className="primary-button home-new" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} />
          New project
        </button>
      </header>

      {error && <div className="agent-error">{error}</div>}

      <section className="home-section">
        <div className="home-section-head">
          <h2>Recent projects</h2>
          {projects.length > RECENT && <button onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${projects.length}`}</button>}
        </div>
        {projects.length === 0 ? (
          <button className="home-empty" onClick={() => setCreating(true)}>
            <Icon name="sparkles" size={20} />
            <b>Nothing here yet</b>
            <span>Describe what you want to build, or start a lesson below.</span>
          </button>
        ) : (
          <div className="home-grid">
            {shown.map((project) => (
              <ProjectCard key={project.name} project={project} onOpen={() => onOpen(project.name)} />
            ))}
          </div>
        )}
      </section>

      {lessons.length > 0 && (
        <section className="home-section">
          <div className="home-section-head">
            <h2>New to chip design? Start here</h2>
            <small>No experience needed. A real simulator checks your work.</small>
          </div>
          <div className="lesson-list">
            {lessons.map((item) => (
              <button key={item.id} className="lesson-card" disabled={busy} onClick={() => void startLesson(item.id)}>
                <span className="lesson-icon">
                  <Icon name="graduation" size={16} />
                </span>
                <b>{item.title}</b>
                <span>{item.description}</span>
                <em>
                  {projects.some((project) => project.name === item.id && lessonIds.has(project.name)) ? "Continue" : "Start"}
                  <Icon name="chevronRight" size={12} />
                </em>
              </button>
            ))}
          </div>
        </section>
      )}

      {status && (
        <footer className="home-foot" title={tools.map(([tool, found]) => `${tool}: ${found ? "installed" : "not installed"}`).join("\n")}>
          <span className={`model-dot ${status.engineFound ? "" : "failed"}`} />
          {status.engineFound ? "Rocket Engine ready" : "Rocket Engine not found"} · {ready} of {tools.length} tools installed
        </footer>
      )}

      {creating && (
        <NewProjectDialog
          templates={templates}
          onClose={() => setCreating(false)}
          onCreated={(name, firstRequest) => onOpen(name, firstRequest)}
        />
      )}
    </main>
  );
}
