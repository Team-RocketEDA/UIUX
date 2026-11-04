<p align="center">
  <img src=".github/assets/rocketide-logo.svg" width="72" height="72" alt="RocketIDE logo">
</p>

<h1 align="center">RocketEDA UI</h1>

<p align="center"><sub>Part of <a href="https://github.com/Team-RocketEDA/RocketIDE"><b>RocketIDE</b></a> · the workbench</sub></p>

RocketEDA UI is a React-based workbench for an AI-native chip-design IDE. It is designed for an Electron desktop application while keeping the frontend reusable for a future browser deployment.

## What it is now

Everything on screen is real; there is no sample data.

- **Start screen:** create a project from a template (two-stage op-amp on generic models, or empty) or open one.
  Each project is its own git repository under `~/RocketEDA/projects` (override with `ROCKET_PROJECTS_DIR`).
- **Explorer and editor:** the project's real files. Saving commits to the project's git, so revisions are real.
  `results/` (engine evidence) and `ip/manifest.yaml` are read-only.
- **Top bar:** project and git branch, revision, runner and agent status, Shortcuts (`?`), Export. Keys: `1`–`8`
  pages, `Ctrl+B` files, `Ctrl+J` run console, `Ctrl+I` assistant.
- **Constraints:** a form over the project's `constraints.yaml` (PDK, domains, autonomy, repair limit, each check's
  target and required flag). Saving changes only those fields, keeps comments, and commits; the raw file is one click away.
- **Verification:** every status comes from a Rocket Engine run recorded in `results/engine-runs/`, whether you
  pressed Run checks or the assistant ran it. Runs on an older revision are marked stale. Required-gate progress,
  filters, each metric across runs, and every run opens to its tool output and evidence file.
- **Engine toolbelt:** the tools Rocket Engine lists (`list_job_kinds`), each checked on this machine. `nG` runs the
  checks; another installed tool hands the assistant a request to review; a missing one says what it needs.
- **Assistant:** the project's own agent (opencode + Rocket Fuel), started when the project opens. Chat with approval
  cards (real diffs, the effect on the circuit), Activity (tool calls, approvals, checks, changed files), Settings.
- **Overview:** status, next actions read off the checks, recent commits and engine runs, the engine tool registry.
- **Export:** project archive (`.tar.gz`) and a markdown verification report.
- **Schematic:** drawn automatically from the project's SPICE netlists (`design/`, `tests/`): PMOS on top, NMOS
  stacked below, wires routed between rows, supplies and ground as symbols. Sizes like `W={40*L2*1e-6}` are
  evaluated from `.param`, so an edit by you or the assistant redraws with the new values. Hover a wire to trace its
  net; click a part for its model, sizes, connections and netlist line. Subcircuit instances are SHEET blocks:
  double-click to descend (across files), the breadcrumb climbs back. Symbols lists every symbol with its pins,
  models, definition and uses. Read-only: change the netlist to change it.
- **Plots:** the frequency response (gain and phase on one frequency axis) from the AC sweep the engine keeps
  with each run (`results/engine-runs/<run_id>-ac.raw`), with the targets from `constraints.yaml`, the 0 dB crossing
  and phase margin marked, a hover readout, and an earlier run overlaid for before/after.
- **Layout:** the project's GDS files, read in the browser (`src/layout/gds.ts`), flattened from a top cell and drawn
  per layer, with layer toggles, cell choice, coordinates in µm, and Open in KLayout when it is installed.
- **Terminal:** an engine console: Rocket Engine operations by name with JSON arguments, through the same
  project-bound call the assistant makes. Not a general shell.
- **Workspace server safety:** it only answers this page: the Host must be loopback and a browser's Origin must be
  the server itself, so other websites can't drive it.

## Getting started

Clone the repos side by side, then:

```bash
# rocket_fuel: the agent (pinned opencode)
cd rocket_fuel && npm install && cp .env.example .env    # set ROCKET_MODEL / MODEL_API_KEY in .env

# rocket-engine: the branch with the MCP server, plus ngspice on PATH
cd rocket-engine && git checkout GREEN-the-tests && uv sync

# this repo
cd UIUX && npm install
ROCKET_ENGINE_HOME=../rocket-engine npm run dev          # http://localhost:5173
```

The desktop app is the same UI in an Electron window:

```bash
npm run desktop       # build, then open the app; Electron main runs the workspace server itself
npm run desktop:dev   # with `npm run dev` running in another terminal: Electron over the dev server
```

To serve the same app to a browser with no dev server or Electron, as the RocketIDE bundle and its Docker image do:

```bash
npm run serve         # http://localhost:5173; set ROCKET_UI_HOST and ROCKET_UI_PORT to change the address
```

| Variable | Default | What |
|---|---|---|
| `ROCKET_FUEL_HOME` | `../rocket_fuel` | the agent harness |
| `ROCKET_ENGINE_HOME` | `../rocket-engine` | Rocket Engine checkout (simulations, evidence) |
| `ROCKET_ENGINE_URL` | unset | a running engine shared with the agent and other clients (RocketIDE starts one); without it each check starts the engine for that call |
| `ROCKET_PROJECTS_DIR` | `~/RocketEDA/projects` | where projects live |
| `ROCKET_AGENT_URL` | unset | with `VITE_ROCKET_AGENT=replay`, stream a recording from rocket_fuel's `evals/replay_server.py` instead |

The workspace server (`server/workspace.ts`) runs inside the Vite dev server: projects, files, git, checks through
the engine, and the project's agent, proxied at `/agent` with its password added server-side, so no password or
model key reaches browser code. In the desktop app Electron main (`electron/main.ts`) hosts the same module on a
loopback port, next to the built UI, and reads the same variables (shell or `.env`).

## Architecture direction

Reusable React components should depend on service interfaces rather than Electron APIs. Native filesystem access, process execution, credentials, and EDA tools belong behind adapters.

Planned service boundaries:

- Project and file service
- Agent service
- Job runner
- Tool registry
- Verification and evidence service

## Workbench surfaces

| Surface | Responsibility | Status |
| --- | --- | --- |
| Project picker | Create from a template or open a project | Real (workspace server) |
| Project explorer + editor | Browse and edit project files; saves are git commits | Real |
| Assistant | Chat, approvals with diffs, tool activity, Stop | Real (project's Rocket Fuel agent) |
| Constraints | Targets, measurement definitions, repair limit, autonomy | Real, form over `constraints.yaml` (saves are commits) |
| Verification | Per-check status with measured value, margin and revision; run history | Real (Rocket Engine evidence) |
| Run console | Logs of Run checks | Real (engine run log) |
| Export | Project archive and verification report | Real |
| Schematic viewer | Parts, nets, ports, sizes, subcircuits | Real, drawn from the project's netlists (`src/schematic/`, tests: `npm test`) |
| Layout viewer | Geometry with layer controls | Real, the project's GDS (empty state when there is none) |
| Plots | Frequency response with targets, before/after overlay | Real, from the engine's AC sweep datasets (needs the engine's dataset change) |
| Terminal | Engine console: Rocket Engine operations by hand | Real; a general shell stays off until isolated, approved execution exists |

## Product boundaries

This repository contains the UI layer. It does not implement physics solvers, physical-design engines, AI model providers, native process isolation, or foundry signoff. Those capabilities are integrated through backend contracts.

See [`PRD.md`](./PRD.md) for the full product requirements and implementation direction.
