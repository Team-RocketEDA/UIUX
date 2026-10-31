# RocketEDA UI

RocketEDA UI is a React-based workbench for an AI-native chip-design IDE. It is designed for an Electron desktop application while keeping the frontend reusable for a future browser deployment.

## What it is now

Everything on screen is real; there is no sample data.

- **Start screen:** create a project from a template (two-stage op-amp on generic models, or empty) or open one.
  Each project is its own git repository under `~/RocketEDA/projects` (override with `ROCKET_PROJECTS_DIR`).
- **Explorer and editor:** the project's real files. Saving commits to the project's git, so revisions are real.
  `results/` (engine evidence) and `ip/manifest.yaml` are read-only.
- **Constraints:** read from the project's `constraints.yaml` (targets, how each metric is measured, repair limit,
  autonomy); edit the file itself.
- **Verification:** every status comes from a Rocket Engine run recorded in `results/engine-runs/`, whether you
  pressed Run checks or the assistant ran it. Runs on an older revision are marked stale.
- **Run checks / toolbelt:** runs ngspice through Rocket Engine with the targets from `constraints.yaml`. Tools are
  enabled only when installed *and* wired to an engine operation (today: ngspice).
- **Assistant:** the project's own agent (opencode + Rocket Fuel), started when the project opens: chat, approval
  cards with real diffs, tool activity, Stop.
- **Export:** project archive (`.tar.gz`) and a markdown verification report.
- **Schematic:** drawn automatically from the project's SPICE netlists (`design/`, `tests/`): PMOS on top, NMOS
  stacked below, wires routed between rows, supplies and ground as symbols. Sizes like `W={40*L2*1e-6}` are
  evaluated from `.param`, so an edit by you or the assistant redraws with the new values. Hover a wire to trace its
  net; click a part for its model, sizes, connections and netlist line. Read-only: change the netlist to change it.
- **Plots:** the frequency response (gain and phase on one frequency axis) from the AC sweep the engine keeps
  with each run (`results/engine-runs/<run_id>-ac.raw`), with the targets from `constraints.yaml`, the 0 dB crossing
  and phase margin marked, a hover readout, and an earlier run overlaid for before/after.
- **Layout, terminal:** honest empty states until the engine produces those views; the previous sample-data viewers
  are in git history for when it does.

## Getting started

Clone the repos side by side, then:

```bash
# rocket_fuel: the agent (pinned opencode)
cd rocket_fuel && npm install && cp .env.example .env    # set ROCKET_MODEL / MODEL_API_KEY in .env

# rocket-engine: branch with the MCP server and fixes (PR #3), plus ngspice on PATH
cd rocket-engine && git checkout fuel-mcp-fixes && uv sync

# this repo
cd UIUX && npm install
ROCKET_ENGINE_HOME=../rocket-engine npm run dev          # http://localhost:5173
```

| Variable | Default | What |
|---|---|---|
| `ROCKET_FUEL_HOME` | `../rocket_fuel` | the agent harness |
| `ROCKET_ENGINE_HOME` | `../rocket-engine` | Rocket Engine checkout (simulations, evidence) |
| `ROCKET_PROJECTS_DIR` | `~/RocketEDA/projects` | where projects live |
| `ROCKET_AGENT_URL` | unset | with `VITE_ROCKET_AGENT=replay`, stream a recording from rocket_fuel's `evals/replay_server.py` instead |

The workspace server (`server/workspace.ts`) runs inside the Vite dev server: projects, files, git, checks through
the engine, and the project's agent, proxied at `/agent` with its password added server-side, so no password or
model key reaches browser code. Electron main is meant to host the same module.

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
| Constraints | Targets, measurement definitions, repair limit, autonomy | Real, read from `constraints.yaml`; edit the file |
| Verification | Per-check status with measured value, margin and revision; run history | Real (Rocket Engine evidence) |
| Run console | Logs of Run checks | Real (engine run log) |
| Export | Project archive and verification report | Real |
| Schematic viewer | Parts, nets, ports, sizes, subcircuits | Real, drawn from the project's netlists (`src/schematic/`, tests: `npm test`) |
| Layout viewer | Geometry with layer controls | Empty state until a layout flow runs |
| Plots | Frequency response with targets, before/after overlay | Real, from the engine's AC sweep datasets (needs the engine's dataset change) |
| Terminal | Python/tool jobs | Disabled until isolated, approved execution exists |

## Product boundaries

This repository contains the UI layer. It does not implement physics solvers, physical-design engines, AI model providers, native process isolation, or foundry signoff. Those capabilities are integrated through backend contracts.

See [`PRD.md`](./PRD.md) for the full product requirements and implementation direction.
