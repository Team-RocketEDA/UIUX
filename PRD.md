# RocketEDA — Product Requirements Document

**Version:** 0.3 — UI workbench direction added  
**Dates:** October 26–November 4, 2026  
**Team:** Four people  
**Product:** Open-source AI-native IDE for digital, analog, and photonic integrated circuits  
**Initial deployment:** Electron desktop app; browser deployment planned using the same frontend  
**Tagline:** **Set your constraints. Describe your chip. Watch it get designed, tested, and improved.**

## 1. Product overview

RocketEDA is a Cursor/Replit-like chip-design IDE. The user chooses a PDK, enters measurable constraints, and describes a chip in natural language. An AI agent creates or reuses circuit blocks, builds schematics and layouts, invokes existing electronic and photonic design tools, reads the results, and improves the design. Users inspect the source, verification evidence, and fabrication exports rather than blindly trusting an AI-generated answer.

RocketEDA supports digital electronics, analog electronics, and photonics **within one project**. Mixed-domain assembly and connectivity are product goals; this does **not** mean that unrelated electronic and photonic PDKs can manufacture one monolithic die. Actual co-fabrication requires a compatible process and interface models.

**We build the unified IDE, AI tools, bootstrappable IP ecosystem, and verification feedback loop — not new SPICE, electromagnetic, thermal, or other physics solvers.** All code written by the team should be open source, respecting dependencies and PDK licenses.

**Users:** students, researchers, chip designers, IP-development teams, and developers who want an AI-first chip-design workflow. Beginners should not need to memorize individual EDA commands.

### 1.1 Core product principles

- **Constraints first:** Design goals and required checks are explicit before generation.
- **Evidence-based verification:** A check passes only with real tool output satisfying stated criteria. Unsupported, skipped, and failed checks remain distinct.
- **Backend-agnostic:** AI model providers, agent harnesses, simulation engines, layout engines, and execution locations use replaceable interfaces.
- **Electron first; web-ready:** Use a shared frontend and separate backend services so the application can later be deployed through a browser, in a ChatGPT/Replit-like model.
- **Multi-domain project:** Electronic and photonic blocks may coexist as separate or connected logical components, subject to declared interface and technology compatibility.
- **PDK-agnostic platform, PDK-aware designs:** Many PDKs may be supported, but an implementation is usable only with declared compatible technology and tools.
- **Composable, bootstrappable IP:** The agent can use existing IP and can design, register, and reuse new blocks built from primitives or other blocks.
- **Git-friendly and reproducible:** Readable design/project files and recorded tool evidence can be versioned; generated binary outputs have traceable inputs.

## 2. User workflow and required IDE behavior

1. **Set constraints:** Choose process/PDK and domains; define voltage, clock or frequency, optical wavelength, response limits, power/area targets, and required verification gates as applicable.
2. **Describe the chip:** Prompt the agent in natural language, e.g. “Build a small RISC-V core with GPIO and verify its I/O,” or “Design a transistor-level op-amp with these targets.”
3. **Design and assemble:** The agent searches the IP catalog, creates blocks when needed, configures ports, modifies editable sources, generates schematic/layout views, and connects compatible blocks.
4. **Test and repair:** The agent runs supported simulations and checks. When a check fails, it uses the diagnostic evidence to make a targeted revision and rerun the relevant tests.
5. **Review:** The IDE displays schematic hierarchy, final or available layouts, files, waveforms, optical spectra, reports, errors, and iteration history. **Digital place-and-route does not require continuous visual updates**: displaying LibreLane/OpenROAD's completed layout is sufficient.
6. **Export:** The project, relevant netlists/RTL, schematic and layout files, GDS/OASIS where supported, testbenches, settings, and verification reports are downloadable.

**Autonomy modes:** Users choose between automatic operation and approval at major stages. The sole required stop rule for the MVP is a **configurable maximum number of design-repair iterations**. At the limit, the agent stops and consults the human rather than claiming success. Tool failures and unsupported checks are reported honestly.

### 2.1 Required UI

- Project/file explorer with editable files and configuration.
- Constraints panel, natural-language chat, agent steps, and model/provider settings.
- **Hierarchical schematic editor**, with subcircuits and a KiCad-inspired interaction model (reference: <https://docs.kicad.org/doxygen/understand_hierarchical_schematics.html>).
- Layout editor/viewer showing actual available chip geometry and final routed layouts. KLayout (<https://www.klayout.de/>) is the primary reference and backend integration target for layout operations; the first implementation may restrict editing to operations that can be saved back to the source layout.
- KiCad-inspired toolbelt containing every tool exposed by the engine's tool registry. Tools must be generated from the registry rather than maintained as a second hard-coded UI list, and unavailable tools must show an explicit disabled or unsupported state.
- Dedicated workbench windows/panels for the schematic editor, layout editor, terminal, plots, assistant, project files and verification output. Users may arrange or resize these surfaces without losing project context.
- Terminal window for Python scripting and parametrically defining circuits, using the same project files, tool registry and execution jobs as the assistant.
- Chatbot/assistant window showing prompts, generated changes, tool calls, approvals, logs and evidence. The UI may use assistant-ui or a maintained OpenCode UI integration as an implementation reference; the product must preserve RocketEDA's project and verification context.
- Run console with commands, progress, logs and errors; waveforms/plots and per-check PASS/FAIL/UNSUPPORTED status.
- Project export, output artifacts, and verification reports.

### 2.2 React/Electron workbench direction

The initial UI implementation should use **React** in a shared frontend and **Electron** as the desktop shell. The same React application must remain usable in a future browser deployment; Electron-specific filesystem, process and native-tool access belongs behind service interfaces rather than inside reusable UI components.

The visual language should take inspiration from KiCad: persistent project context, discoverable toolbars/toolbelts, dockable work areas, clear active-tool state, and dense but readable engineering data. This is inspiration for information architecture and interaction patterns, not a requirement to copy KiCad's implementation or branding.

The proposed frontend foundation is a **shadcn/ui monorepo** with reusable shadcn components and shared design tokens. Final package and workspace layout remain an implementation decision. The main workbench should support these surfaces:

| Surface | Initial responsibility | Priority |
|---|---|---|
| Layout editor | Display and, where supported, edit KLayout-backed geometry and routing | MVP |
| Schematic editor | Create and inspect hierarchical connectivity and component instances | MVP |
| Assistant | Natural-language design requests, approvals, tool activity and evidence | MVP |
| Terminal | Python scripts for parametric circuits and direct tool execution | MVP |
| Plots | Waveforms, spectra, simulation metrics and pass/fail thresholds | MVP |
| 3D layout viewer | Optional three.js or react-three-fiber visualization of available geometry | Stretch |

The UI is responsible for orchestration, presentation and source-backed edits. It must not reimplement layout, simulation or physical-design engines. Engine tools are integrated through the backend/tool-adapter contracts already defined in this document.

**Staged editing rule:** schematic and layout surfaces may begin as source-backed viewers with selected editing operations. A capability may be labeled an editor only when its changes can be validated and saved to the authoritative project representation. Real-time layout painting and full KiCad-equivalent editing remain outside the hackathon MVP.

## 3. Project source of truth and design representation

RocketEDA should use a **KiCad-like, file-based design model**: an editable **schematic file** describing component instances, hierarchy and connectivity, plus an editable **layout file** describing physical placement, geometry and routing. The schematic and layout are first-class project artifacts, rather than a proprietary opaque database. A mapping between their instances and connections must be maintained so the system can detect mismatches.

Different domains have additional authoritative inputs:

- **Digital:** Verilog/SystemVerilog RTL defines the portable digital logic. Synthesis maps it to a chosen **supported** PDK; the mapped cells, technology netlist, placements and layout are PDK-specific. The schematic can represent hierarchical block connectivity and the compiled block can be placed/routed with other supported macros, such as SRAM, GPIO or an analog macro. Do not claim that RTL can be physically implemented in *every* PDK without suitable digital libraries and flow support.
- **Analog:** A transistor-level circuit/netlist is bound to PDK devices; schematic, transistor sizing, physical implementation and extracted results must remain traceable.
- **Photonics:** Circuit connectivity and parametric geometry reference PDK cells, with design and optical models kept in sync.

**Source precedence must be explicit:** If an auto-generated layout conflicts with the schematic/RTL, RocketEDA flags the mismatch rather than silently changing its source of truth. For the MVP, it is acceptable to store an editable design description and generate the physical layout file from it, as long as the regeneration and the relevant mappings are reproducible.

Illustrative versionable project tree (final schema is an early engineering decision):

```text
rocket-project/
  rocket.yaml                 # Project, PDKs, domains, block references
  constraints.yaml            # Numerical targets and required checks
  design/
    schematic.yaml            # Hierarchical instances, ports, nets
    layout.yaml               # Physical placement/routing definitions
    digital/                  # RTL and synthesized technology views
    analog/                   # SPICE and related circuit definitions
    photonic/                 # Python / GDSFactory and optical definitions
  ip/
    manifest.yaml             # Registered blocks and compatibility
  tests/                      # Testbenches and assertions
  workflows/                  # Tool configurations
  results/                    # Logs, measurements, evidence manifests
  exports/                    # GDS/OASIS and packaged deliverables
```

Large binary/generated artifacts may be stored outside Git, but checks must record which source revision, PDK, and tool settings produced them. The illustrative YAML format is **not** a promise to implement an entirely new schematic format; reuse existing open formats where practical.

## 4. Bootstrappable IP and PDK libraries

An **IP block** is a predesigned, configurable functional unit with a named interface. Like an IC used in PCB design, it can be instantiated, parameterized within supported limits, and connected without reopening all of its internals. Supported examples:

- **Digital:** RISC-V processor, SRAM controller/interface, UART, GPIO, digital PID, memory blocks. Portable RTL can be synthesized for compatible PDKs; mapped layouts cannot simply be reused across processes.
- **Analog:** Transistor-level op-amp, bias generator, comparator, ADC, analog control block; implementations are tied to device models, operating conditions, and typically a PDK.
- **Photonic:** Waveguide, splitter, coupler, ring resonator, phase shifter, MZI, optical filter; geometry and compact models depend on the photonic PDK.

**Bootstrappability is mandatory:** The agent can create a block from PDK primitives or other registered blocks; simulate and optimize it; package implementation, interfaces, parameters and tests; register it in a project library or **PDK-specific extension library**; and instantiate it again in higher-level designs. New blocks must be visible to the AI's search/discovery tools **and** exposed through an imperative code API. Do not modify the foundry's original PDK files.

Each block records: purpose/usage instructions, typed ports and parameter bounds, implementation views (RTL, SPICE, Python geometry, schematic, layout or black-box as relevant), dependency graph, compatible PDK/process versions and conditions, testbenches, verification evidence/status, source, license, and version. An unverified block may be saved and reused with a clear **UNVERIFIED** status; registration does not imply fabrication readiness.

Possible user-facing API (**illustrative, not implemented**):

```python
cpu = rocket.ip.riscv_core(name="small_rv32")
amp = rocket.ip.opamp(pdk="sky130", target_gain_db=60)
filter_ = rocket.ip.optical_filter(pdk="public_photonics", filter_type="ring")
```

**Hackathon acceptance:** Have the agent generate at least one new reusable block, register it, and instantiate it in a second design without rewriting its internals. In the long term, block composition enables progressively larger circuit designs.

## 5. Agent, tool adapters, and verification

### 5.1 AI and orchestration

- **Bring your own key (BYOK):** Support configurable provider APIs, including services exposing Meta-family models, other hosted models and compatible local models. Initial provider breadth depends on the chosen harness.
- **Replaceable agent harness:** Evaluate existing open-source coding agents; do not hard-code one as a permanent dependency. However, we still have to ship our own harness in the app today AND use the ***Meta Models API for the hackathon***
- **Tools for agents:** File read/write/search, IP search and registration, PDK discovery, tool execution, simulation-report parsing, and bounded design revision.
- **Security:** Credentials must not be committed to Git or printed in logs; avoid exposing them in client bundles. Run generated designs/scripts through an isolated execution service with appropriate limits.
- **Iteration rule:** A configurable **max-iteration count** is sufficient for the MVP; on reaching it, present the failures and ask the user what to do next.

### 5.2 Checks and trusted evidence

Select checks relevant to the design and to available PDK/tool support, not a one-size-fits-all list. Store **target, measured value, status, source revision, PDK, tool/version, and log/artifact reference** for each check.

| Check | Domain/use | Candidate existing tools | Demo expectation |
|---|---|---|---|
| RTL/functional tests | Digital | Verilator, testbenches, optional cocotb | Required for digital |
| Synthesis, place-and-route, area | Digital | Yosys, LibreLane, OpenROAD | Required for digital |
| Static timing | Digital | OpenSTA/OpenROAD | Report where supported |
| DRC / LVS | Physical layout | KLayout, Magic, Netgen, PDK decks | Applicable checks in primary flow |
| SPICE characterization | Analog/mixed | ngspice, CACE, PDK models | Required for analog partial |
| Optical circuit response | Photonics | SAX, PDK compact models | Required for photonic partial |
| Parasitic extraction | Post-layout circuits | OpenRCX, available decks | Stretch beyond primary supported flow |
| Post-layout simulation | Analog/mixed | Extracted netlist + ngspice | Stretch |
| Power/performance/area | Appropriate domains | Tool reports and testbenches | Available measured metrics |
| Corner/Monte Carlo | Analog robustness | Existing PDK-supported flows | Future, unless already easy |
| EM / optical FEM-FDTD | Relevant geometry | Existing OSS tools | Future/optional integration |
| Thermal simulations | Heated structures | Existing FEM/multiphysics tools | Future/optional integration |
| Signal/power integrity, EM/IR, DFM | Advanced signoff | Existing supported tools | Future |

A check is **PASS** only if an actual run meets the specified acceptance criteria. Failed, not run, and unsupported checks are not green. If a check fails, the agent reads its logs, edits the relevant source, and reruns; a broader verification set is repeated before the user exports a final result. GDS output is not automatically a foundry-approved tapeout.

## 6. Implementation options and deployment

### 6.1 Two explicit integration paths

**Path A — Build on open-source GDSFactory (hackathon default).** Reuse GDSFactory/KFactory for PDK geometry, ports, component composition, photonic layout and GDS/OASIS output. Add our own IDE, agent orchestration, source format, IP registry, and verification UI. Connect analog and digital design flows through separate adapters. **Advantage:** shorter path to a demonstrable system. **Tradeoff:** GDSFactory is not itself a universal analog/digital compiler. GDSFactory themselves offer the follwoing interesting open source simulators that we can use: [MEOW](https://gdsfactory.github.io/meow/), [SAX](https://gdsfactory.github.io/sax/), [GSIM](https://gdsfactory.github.io/gsim/), and [Circulax](https://gdsfactory.github.io/circulax/)

**Path B — Own the integration layer.** Make RocketEDA's project schema, components, adapters, runner and tool registry the platform core. Treat GDSFactory as one replaceable backend alongside LibreLane, KLayout, ngspice and others. **Advantage:** clearer long-term independence. **Tradeoff:** more systems integration during the hackathon.

**Decision:** Use Path A to ship quickly unless a blocker forces a change. Keep adapter boundaries compatible with Path B. Research both approaches; don't promise to fully build both in one week.

### 6.2 Electron-first, backend-independent architecture

**Initial deliverable is an Electron desktop app.** Its UI must be reusable in a browser build later, like ChatGPT/Replit, without rewriting the chip-design product. The UI talks to stable service interfaces rather than directly invoking local native tools.

- **Shared frontend:** React workbench with project explorer, constraints, assistant, schematic/layout editors, terminal, plots, logs and exports. Use shadcn/ui components and shared design tokens; Monaco or Theia remain candidates for the embedded source editor.
- **Project service:** Files, Git integration, sessions/workspaces, source revisions, schema and artifact tracking.
- **Agent service:** BYOK models, replaceable coding-agent harness, tool discovery and repair loop.
- **EDA runners:** Isolated processes for native tools; start with a local runner, later support hosted or remote heavy jobs using the same job interface.
- **Tool adapters:** Return structured results from GDSFactory, LibreLane, ngspice, KLayout, SAX and others.
- **Tool registry:** The engine's existing tool definitions are the source of truth for tool IDs, labels, capabilities, inputs, execution status and output artifacts. The React toolbelt and assistant tool listings consume this registry so every engine tool has one consistent user-facing entry point.

**Local-first execution** means the simulations may run on the user's machine even if a browser deployment is added. A judge/demo build may use a preconfigured runner. Credentials, permissions, and outputs must be handled safely.

## 7. Hackathon demonstrations — October 26 to November 4

**Scope rule:** Deliver one complete physical implementation flow (**digital**) and narrower real AI design/simulation demonstrations for analog and photonics. Never present partial physical verification as complete tapeout signoff.

### 7.1 Main complete demo — digital RISC-V on SKY130

Start with a small public RISC-V RTL core and the open SKY130 PDK. Optionally add **one manageable GPIO or UART peripheral**; SRAM controllers, SRAM macros and additional I/O are stretch additions, not prerequisites.

The live demonstration must show: user constraints → agent selects/assembles RTL IP → functional testbench and simulation (e.g. Verilator) → Yosys/LibreLane/OpenROAD synthesis and place-and-route → actual **final GDS layout** → relevant timing, area, routing, and DRC/LVS reports → export of source and evidence. Include one genuine problem diagnosed and repaired by the agent, followed by a rerun. When available, the agent can place and connect the completed digital macro to other blocks through declared ports and physical views, rather than pretending digital layout streams live during place-and-route.

**Definition of complete:** A reproducible real RTL-to-GDS flow plus applicable supported checks; no substitute mockup or claim of unsupported signoff.

### 7.2 Partial demo — transistor-level SKY130 op-amp

From natural-language performance requirements (e.g. gain, gain-bandwidth, phase margin, supply, power, slew rate and output load), the agent creates a **simple transistor-level op-amp from SKY130 primitive MOSFETs**, rather than merely loading a finished op-amp macro. It picks a manageable reference topology, sizes devices, sets bias/compensation, emits a SPICE netlist, runs **ngspice** (and optionally CACE), displays measured performance versus targets, and revises sizing/biasing until the tests pass or the iteration limit is hit.

**Reference:** Two-stage CMOS SKY130 op-amp project, <https://github.com/rohinthram/avsd_opamp> (verify current license, files and model compatibility during setup). Arbitrary user-entered **targets** are allowed; the supported topology, physical limits and feasible parameter ranges are not arbitrary.

**Required:** Real generated netlist and analog simulation/optimization evidence, shown alongside the generated schematic. **Stretch:** automated transistor layout, DRC/LVS, parasitics and post-layout optimization. Generic synthesis of every possible op-amp topology is explicitly not an MVP claim.

### 7.3 Partial demo — photonic MZI or wavelength filter

From natural-language optical targets (operating wavelength, extinction ratio, insertion loss, spectral response, footprint and phase-shifter settings), the agent assembles reusable **PDK primitives** (waveguides, couplers/splitters, bends and phase shifters), routes an MZI, generates GDS with **GDSFactory**, and uses **SAX** plus available PDK compact models to simulate transmission and tune supported geometry/control parameters. Display optical spectra, actual layout, PASS/FAIL metrics, and iteration evidence.

**Reference:** CORNERSTONE silicon-photonics PDK, <https://github.com/gdsfactory/cspdk>; its available MZI/heater cells and models can accelerate the demo. Use component cells, not a hardcoded finished circuit, where possible.

**Primary decision still to freeze:** a **thermo-optically tunable MZI** as the simplest focused demo, with a wavelength-filter response as its measurable result. A true cascaded optical filter, optical DRC, thermal and electromagnetic simulation, and a high-speed electro-optic MZM remain stretch/future items.

### 7.4 Shared-IP demonstration

Within one RocketEDA project, register digital, analog and photonic components with typed ports, PDK affiliations and implementation views. Show the agent **bootstrapping at least one new block**, saving it and reusing it. A mixed-domain project and block-level composition are required; physical co-fabrication of unrelated SKY130 and photonic PDKs is **not** claimed.

### 7.5 Optional integrated microcontroller stretch

Investigate the public 12-bit SKY130 SAR ADC at <https://github.com/iic-jku/SKY130_SAR-ADC1>; check license, models, ports, physical/abstract views and integration readiness. If practical, connect an available ADC macro to the RISC-V core with control logic and I/O tests, aiming at a small mixed-signal microcontroller. Physical integration requires correctly compatible macros, timing/power/interface models and routing. This is an **optional stretch**, not a blocker for the core demo.

## 8. Acceptance criteria, schedule and ownership

### 8.1 Demo-day acceptance checklist

- [ ] Electron desktop IDE opens and operates against the separated backend/runner interfaces.
- [ ] User can enter constraints and a natural-language design request.
- [ ] Agent can read, create and modify actual versioned project files; schematic and layout data are traceable.
- [ ] Hierarchical schematic and real available layout are viewable in source-backed editor surfaces; supported edits can be saved and validated.
- [ ] React/Electron workbench provides project context, assistant, terminal, plots, logs and a registry-driven toolbelt for every defined engine tool.
- [ ] Python terminal can run a project script through the same job/tool interfaces used by the assistant.
- [ ] BYOK access and open-source team code are demonstrated.
- [ ] At least one new IP block is created, registered and reused, with explicit PDK/port metadata and verification status.
- [ ] A RISC-V/SKY130 digital design completes a **real** RTL-to-GDS flow with applicable reports.
- [ ] The agent diagnoses, changes, and reruns at least one failed check; maximum iterations trigger human consultation.
- [ ] Op-amp flow produces generated transistor-level SPICE and measured simulation results.
- [ ] Photonic MZI/filter flow produces actual GDS and optical response simulation.
- [ ] Failures and unsupported checks are labeled honestly; artifacts and reports can be exported.

**Demo story:** Set limits → describe a chip → generate/assemble source → watch a real check fail → let the agent fix it → inspect the final chip layout and verification evidence.

### 8.2 Work plan

| Window | Focus | Deliverable |
|---|---|---|
| Oct 26–27 | Research, install tools, choose references and interfaces | Compatibility matrix; frozen demo PDK/designs; architecture choice |
| Oct 28–29 | React/Electron workbench and job runner | Constraints/chat, project files, registry-driven toolbelt, terminal, logs, schematic/layout previews |
| Oct 28–31 | Digital complete path | RISC-V tests and SKY130 RTL-to-GDS with reports |
| Oct 30–Nov 1 | Agent/verification and IP schema | Real fail→fix→rerun trace; bootstrapped IP registry |
| Nov 1–2 | Analog and photonic partials | Op-amp SPICE results; MZI layout and optical spectrum |
| Nov 3 | Integration and demo resilience | Reliable walkthrough and saved fallback evidence |
| Nov 4 | Demo and release | Published open-source code, README, outputs and presentation |

**Suggested division of labor (pair as needed):** (1) Electron UI/UX, schematic and layout views; (2) agent, BYOK, file/project model and IP registry; (3) digital flow and verification evidence; (4) op-amp, photonics and simulator adapters. Freeze selected repo revisions, PDK models and tool versions early.

## 9. Research backlog and unresolved decisions

This is a **research list**, not a promise to implement every item by November 4. Record findings, feasibility, licenses, owners and decisions as GitHub Issues.

### 9.1 GDSFactory+ and architecture research

- Review **publicly documented** GDSFactory+ capabilities in digital, analog and photonics: schematic/layout editing, agent tools, simulations, automatic checks, PDK management, visualization and reusable cells.
- Explore implementing equivalent features with open-source components and public interfaces. Do **not** copy closed source, bypass paid access controls or redistribute restricted PDK data. Premium feature parity is an exploration target.
- Prototype the smallest GDSFactory-first adapter and assess if an independent RocketEDA core is a better long-term design.
- Compare Monaco versus Theia for a shared Electron/browser frontend and choose early.
- Freeze the React workspace/monorepo structure, shadcn component strategy and dockable workbench layout.
- Define the tool registry contract and generate the toolbelt from it; confirm every currently defined engine tool has a visible state.
- Choose assistant-ui versus an OpenCode UI integration after checking license, maintenance and project-context extensibility.
- Decide whether the optional 3D viewer uses three.js directly or react-three-fiber based on the geometry data available from KLayout.
- Decide the schematic/layout serialization, edit/sync rules, and instance/port mapping; test whether an existing open format can be reused instead of inventing a new one.

### 9.2 Candidate EDA tools and optional integrations

- Layout and PDK: GDSFactory (<https://github.com/gdsfactory/gdsfactory>), KFactory (<https://gdsfactory.github.io/kfactory/>), GDSFactory plugins (<https://github.com/gdsfactory/gplugins>), KLayout, Magic.
- Digital: Yosys, Verilator, LibreLane (<https://librelane.readthedocs.io/en/stable/>), OpenROAD (<https://openroad-flow-scripts.readthedocs.io/>), OpenSTA, cocotb.
- Analog: ngspice, CACE, Netgen, supported SKY130 model decks; evaluate parasitic extraction and post-layout simulation where ready.
- Photonic: GDSFactory, CORNERSTONE CSPDK, SAX; survey maintained open-source FEM/FDTD/thermal alternatives without committing to implementing physics engines. **Do not assume Meep is required for the MVP**; investigate its maintenance/status before adding it.
- Advanced future verification: PDK-dependent DRC/LVS, extraction, process corners/Monte Carlo, EM/IR, signal/power integrity, DFM, heat and optical/electromagnetic multiphysics.
- Remote/cloud runner, collaborative workspaces, shared IP marketplace, advanced visual editing, regression dashboards and compatible electro-photonic co-design.

### 9.3 Reference projects and next decisions

- SKY130 RISC-V example: <https://github.com/TheAsaf/RISC-V-SoC-Sky130> — choose and freeze a small core, clock constraint and I/O test.
- SKY130 op-amp reference: <https://github.com/rohinthram/avsd_opamp> and op-amp/CACE library example <https://github.com/RTimothyEdwards/sky130_ef_ip__opamp> — validate license, model compatibility and chosen topology.
- Photonic PDK: <https://github.com/gdsfactory/cspdk> — freeze exact MZI components, compact models, operating wavelength and measurable optical targets.
- SKY130 12-bit SAR ADC: <https://github.com/iic-jku/SKY130_SAR-ADC1> — check available deliverables, licensing and real mixed-signal integration feasibility.
- GDSFactory+ public reference: <https://gdsfactory.com/plus/> and PDK management reference <https://gdsfactory.com/plus/v2/pdk-management/>.
- Monaco: <https://microsoft.github.io/monaco-editor/>; Theia: <https://theia-ide.org/>.
- Decide numerical pass/fail constraints for the RISC-V, op-amp and MZI demos; choose an explicit max-iteration default.
- Define the minimum macro interface for later digital/analog/SRAM placement and connection (logical ports vs. physical shapes/abstract views).

## 10. Explicit boundaries and longer-term roadmap

**Not in the hackathon MVP:** writing any original physics simulator; guaranteed foundry signoff; a full KiCad-equivalent schematic/layout editor; real-time layout painting; a required 3D viewer; physical co-fabrication across unrelated PDKs; arbitrary topology synthesis in every domain; full commercial GDSFactory+ parity; broad cloud compute or advanced signoff where existing flows are missing.

**Beyond the hackathon:** more compatible PDK adapters; true multi-physics and post-layout verification; corners/yield/DFM/EM-IR signoff; composable larger digital/analog/photonic systems; robust source-to-layout synchronization and visual editing; richer KLayout-backed editing; 3D inspection; hosted compute and collaboration; a Cursor-like AI harness for chip design; shared searchable/versioned IP ecosystem; and eventually compatible electrical-photonic fabrication workflows.

**Design caveat:** IP or circuit verification is specific to its models, tests, versions and conditions; even a green simulation dashboard is not automatically proof of manufacturing readiness.
