import { useState } from "react";

type CheckStatus = "passed" | "running" | "unsupported";

type Tool = {
  name: string;
  detail: string;
  icon: string;
  state: "ready" | "active" | "unavailable";
};

const tools: Tool[] = [
  { name: "Yosys", detail: "RTL synthesis", icon: "⌁", state: "ready" },
  { name: "Verilator", detail: "RTL simulation", icon: "◈", state: "active" },
  { name: "KLayout", detail: "Layout viewer", icon: "▦", state: "ready" },
  { name: "ngspice", detail: "Circuit simulation", icon: "∿", state: "unavailable" },
];

const checks: { name: string; value: string; status: CheckStatus }[] = [
  { name: "RTL simulation", value: "128 / 128 tests", status: "passed" },
  { name: "Timing constraints", value: "8.42 ns critical path", status: "passed" },
  { name: "DRC / LVS", value: "Waiting for layout", status: "running" },
  { name: "Power analysis", value: "Not available in runner", status: "unsupported" },
];

function StatusDot({ status }: { status: CheckStatus | Tool["state"] }) {
  return <span className={`status-dot ${status}`} aria-label={status} />;
}

export function App() {
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeSurface, setActiveSurface] = useState("Overview");

  const runDesign = () => {
    if (!prompt.trim()) return;
    setIsRunning(true);
    window.setTimeout(() => setIsRunning(false), 1800);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">R</span><strong>Rocket<span>EDA</span></strong></div>
        <div className="project-switcher"><span className="eyebrow">PROJECT</span><b>riscv-gpio</b><span className="chevron">⌄</span></div>
        <div className="top-actions"><span className="sync"><i /> Synced</span><button className="icon-button">?</button><div className="avatar">AA</div></div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading"><span>WORKSPACE</span><button className="icon-button">+</button></div>
          <nav className="nav-list">
            {["Overview", "Schematic", "Layout", "Terminal", "Plots"].map((item) => (
              <button className={activeSurface === item ? "nav-item active" : "nav-item"} onClick={() => setActiveSurface(item)} key={item}>
                <span className="nav-icon">{({ Overview: "⌂", Schematic: "⌘", Layout: "▦", Terminal: ">_", Plots: "⌁" } as Record<string, string>)[item]}</span>{item}
                {item === "Layout" && <span className="nav-badge">NEW</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-divider" />
          <div className="sidebar-heading"><span>PROJECT FILES</span><button className="icon-button">+</button></div>
          <div className="file-tree">
            <div className="tree-group"><span>⌄</span> src</div>
            <div className="tree-file selected"><span>◇</span> top.sv</div>
            <div className="tree-file"><span>◇</span> gpio.sv</div>
            <div className="tree-file"><span>◇</span> constraints.sdc</div>
            <div className="tree-group"><span>⌄</span> verification</div>
            <div className="tree-file muted"><span>▤</span> simulation.log</div>
            <div className="tree-file muted"><span>▤</span> timing.rpt</div>
          </div>
          <div className="sidebar-footer"><div className="pdk-icon">S</div><div><span className="eyebrow">ACTIVE PDK</span><b>SkyWater SKY130</b></div><span className="chevron">⌄</span></div>
        </aside>

        <section className="content">
          <div className="content-header"><div><span className="eyebrow">WORKBENCH / {activeSurface.toUpperCase()}</span><h1>{activeSurface === "Overview" ? "Design overview" : activeSurface}</h1></div><div className="revision"><span className="green-dot" /> Revision <b>8f3c1a2</b><button className="secondary-button">View history</button></div></div>

          <div className="metrics">
            <div className="metric-card"><span className="eyebrow">DESIGN STATUS</span><div className="metric-value"><span className="status-dot passed" />Ready for review</div><small>Last run 4 min ago</small></div>
            <div className="metric-card"><span className="eyebrow">VERIFICATION</span><div className="metric-value">2 <span className="slash">/</span> 4 <span className="metric-label">checks passed</span></div><div className="progress"><span style={{ width: "50%" }} /></div></div>
            <div className="metric-card"><span className="eyebrow">ITERATION</span><div className="metric-value">03 <span className="metric-label">of 10 max</span></div><small>Auto-repair enabled</small></div>
          </div>

          <div className="main-grid">
            <section className="panel design-panel"><div className="panel-heading"><div><span className="eyebrow">DESIGN CANVAS</span><h2>RISC-V GPIO controller</h2></div><button className="secondary-button">Open editor ↗</button></div><div className="canvas"><div className="canvas-grid" /><div className="chip-outline"><span className="chip-label">RV32I CORE</span><div className="chip-block gpio">GPIO<br /><small>8-bit</small></div><div className="chip-block bus">SYSTEM BUS</div><div className="chip-block memory">SRAM<br /><small>2 KB</small></div><div className="pin pin-a" /><div className="pin pin-b" /><div className="pin pin-c" /></div><div className="canvas-toolbar"><span>⌕ 100%</span><span>◫ Fit to view</span><span>⊙ Select</span></div></div><div className="panel-footer"><span><i className="legend-line" /> Logical connectivity</span><span><i className="legend-dashed" /> Physical placement pending</span><span className="source">Source: <b>src/top.sv</b></span></div></section>

            <section className="panel assistant-panel"><div className="panel-heading"><div><span className="eyebrow">ASSISTANT</span><h2>Design agent</h2></div><span className="live-pill"><i /> LIVE</span></div><div className="chat"><div className="chat-message agent"><div className="agent-avatar">✦</div><div><b>Rocket</b><p>Verification found a timing issue in the GPIO path. I can reduce the combinational depth and rerun the affected checks.</p><span className="time">10:42 AM</span></div></div><div className="chat-message user"><div><b>You</b><p>Fix it and keep the clock target at 125 MHz.</p><span className="time">10:43 AM</span></div></div><div className="activity"><div className="activity-title"><span className="status-dot passed" /> Repair completed <span>· 2m ago</span></div><div className="activity-row"><span className="activity-icon">✓</span><span>Updated <b>src/gpio.sv</b></span><span className="activity-tag">DIFF</span></div><div className="activity-row"><span className="activity-icon">↻</span><span>Reran Verilator simulation</span><span className="activity-tag success">PASS</span></div></div></div><div className="prompt-box"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe a change to your design..." rows={2} /><div className="prompt-actions"><span>⌘ Enter to run</span><button className="run-button" onClick={runDesign} disabled={isRunning}>{isRunning ? "Running..." : "Run agent  ↗"}</button></div></div></section>
          </div>

          <div className="bottom-grid"><section className="panel"><div className="panel-heading compact"><div><span className="eyebrow">VERIFICATION</span><h2>Checks & evidence</h2></div><button className="secondary-button">Run all checks</button></div><div className="check-list">{checks.map((check) => <div className="check-row" key={check.name}><StatusDot status={check.status} /><div><b>{check.name}</b><span>{check.value}</span></div><span className={`check-status ${check.status}`}>{check.status}</span><span className="row-chevron">›</span></div>)}</div></section><section className="panel"><div className="panel-heading compact"><div><span className="eyebrow">ENGINE TOOLBELT</span><h2>Available tools</h2></div><button className="icon-button">⋮</button></div><div className="tool-list">{tools.map((tool) => <div className="tool-row" key={tool.name}><span className={`tool-icon ${tool.state}`}>{tool.icon}</span><div><b>{tool.name}</b><span>{tool.detail}</span></div><StatusDot status={tool.state} /></div>)}</div></section></div>
        </section>
      </div>
    </main>
  );
}
