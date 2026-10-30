# RocketEDA UI

RocketEDA UI is a React-based workbench for an AI-native chip-design IDE. It is designed for an Electron desktop application while keeping the frontend reusable for a future browser deployment.

## Current implementation

The workbench UI is implemented in [`src/`](./src/):

- Dark, KiCad-inspired workbench shell with a registry-driven engine toolbelt
- Resizable project explorer, assistant panel, and run console
- Source-backed project files with an editable code view and save/download actions
- Hierarchical schematic viewer and KLayout-style layout viewer with layer controls
- Constraints editor for PDK, domains, numeric targets, required gates, autonomy, and the repair-iteration limit
- Verification evidence with distinct `PASS`, `FAIL`, `RUNNING`, and `UNSUPPORTED` states
- Waveforms, optical spectra, and analog/photonic metrics rendered from stored evidence
- Python/tool terminal sharing the job interface used by the assistant and toolbelt
- Assistant with approvals, diff preview, tool activity, repair history, and BYOK settings (Meta Models API default)
- Export of text sources, verification reports, and a project bundle; binary GDS stays in runner storage

The project, engine, and verification data are local mock state. Runner jobs are simulated through shared interfaces; backend services can replace these sources incrementally. Unsupported checks are never shown as passes, and the UI does not claim foundry signoff.

## Getting started

Requirements:

- Node.js 20 or newer
- npm

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
```

## Connecting the assistant to Rocket Fuel

The assistant panel has three modes, picked with `VITE_ROCKET_AGENT`:

| Mode | What drives the panel |
| --- | --- |
| unset (default) | the built-in mock, as before (header shows `MOCK`) |
| `replay` | a recorded real session from [rocket_fuel](https://github.com/Team-RocketEDA/rocket_fuel) `evals/replay_server.py` (header and banner show `REPLAY`; read-only) |
| `live` | the real agent: opencode with Rocket Fuel's config, through the dev-server proxy at `/agent` |

In live and replay modes the chat, approval cards (file, hypothesis, diff), activity steps, iteration count and
pass count come from the agent's event stream. Approve and Reject answer the agent's real permission requests.

```bash
# replay (no model, no key): run from the rocket_fuel repo, then start the UI
python3 -I evals/replay_server.py evals/recordings/opamp-fix-and-register-free.jsonl --port 4199 --pause-at permission.asked
VITE_ROCKET_AGENT=replay ROCKET_AGENT_URL=http://127.0.0.1:4199 npm run dev

# live: start the agent from the rocket_fuel repo, then the UI with the same password
OPENCODE_SERVER_PASSWORD=dev scripts/dev.sh "$(scripts/new-demo.sh)" serve --port 4097
VITE_ROCKET_AGENT=live OPENCODE_SERVER_PASSWORD=dev npm run dev
```

The proxy in `vite.config.ts` adds the opencode password on the dev server, so no password or model key reaches
browser code; Electron main should play the same role. `src/agent/fuel/` is copied from `rocket_fuel/client/src`;
change it there and copy it back. The live agent works on the Fuel demo project (an op-amp), not on the mock
project shown in the other surfaces; those still use mock data.

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
| Layout viewer | Inspect KLayout-backed geometry with layer controls | Implemented as a source-backed viewer |
| Schematic viewer | Inspect hierarchy, instances, ports, and connectivity | Implemented as a source-backed viewer |
| Assistant | Handle design requests, approvals, tool activity, and evidence | Implemented with a local harness |
| Terminal | Run Python scripts and direct tool jobs through the shared runner interface | Implemented (simulated jobs) |
| Plots | Display waveforms, spectra, simulation metrics, and targets | Implemented from stored evidence |
| Project explorer | Browse source, constraints, and artifacts | Implemented |
| Verification panel | Display progress, logs, artifacts, and per-check status | Implemented |
| Constraints | Edit targets, gates, autonomy, and max iterations | Implemented |
| Export | Download sources, reports, and a project bundle | Implemented for text state; GDS remains runner-owned |
| 3D layout viewer | Inspect available geometry | Not implemented |

## Product boundaries

This repository contains the UI layer. It does not implement physics solvers, physical-design engines, AI model providers, native process isolation, or foundry signoff. Those capabilities are integrated through backend contracts.

See [`PRD.md`](./PRD.md) for the full product requirements and implementation direction.
