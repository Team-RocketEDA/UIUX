import type {
  Check,
  CircuitSymbolDef,
  ConstraintSet,
  ProjectFile,
  SchematicSheet,
  ToolDefinition,
} from "./types";

export const project = {
  name: "rocket-demo",
  branch: "main",
  title: "Mixed-domain RISC-V, op-amp and MZI demonstrator",
};

export const initialRevision = "8f3c1a2";

export const pdkOptions = [
  { id: "sky130", label: "SkyWater SKY130", note: "Digital + analog" },
  { id: "gf180", label: "GlobalFoundries GF180MCU", note: "Digital + analog" },
  { id: "cspdk", label: "CORNERSTONE cspdk", note: "Photonic" },
];

export const pdkLabel = (id: string) =>
  pdkOptions.find((pdk) => pdk.id === id)?.label ?? id;

const file = (
  path: string,
  language: string,
  kind: ProjectFile["kind"],
  content: string,
  readOnly = false,
): ProjectFile => ({ path, language, kind, content, readOnly });

export const initialFiles: ProjectFile[] = [
  file(
    "rocket.yaml",
    "YAML",
    "config",
    `project: rocket-demo
version: 0.3.0
pdk: sky130
domains:
  - digital
  - analog
  - photonic

blocks:
  - ip: rv32i_core
    view: rtl
  - ip: gpio_controller
    view: schematic
  - ip: sky130_opamp
    view: spice
  - ip: cspdk_mzi
    view: python

runner:
  interface: local
  isolation: process
  artifacts: runner-storage
`,
  ),
  file(
    "constraints.yaml",
    "YAML",
    "config",
    `pdk: sky130
domains: [digital, analog, photonic]

targets:
  supply_v: 1.8
  clock_mhz: 125
  max_power_mw: 50
  max_area_mm2: 0.25
  wavelength_nm: 1550
  extinction_db: 15

verification:
  required:
    - rtl-functional
    - synthesis-pnr
    - static-timing
    - drc-lvs
    - opamp-gain
    - opamp-phase-margin
    - mzi-insertion-loss
    - mzi-extinction
    - power
  max_iterations: 10
  autonomy: approve
`,
  ),
  file(
    "design/schematic.yaml",
    "YAML",
    "source",
    `sheet: top
instances:
  - ref: u_core
    block: ip://rv32i_core
    view: schematic
  - ref: u_gpio
    block: design://gpio
    view: sheet
  - ref: u_sram
    block: ip://sky130_sram_2k
    view: macro

nets:
  - name: clk
    connects: [u_core.clk]
  - name: bus
    connects: [u_core.bus, u_gpio.bus]
  - name: irq
    connects: [u_gpio.irq, u_core.irq]
  - name: mem
    connects: [u_core.mem, u_sram.mem]
  - name: gpio
    connects: [u_gpio.gpio, top.gpio]
`,
  ),
  file(
    "design/layout.yaml",
    "YAML",
    "source",
    `die:
  width_um: 1640
  height_um: 880
  units: um

core:
  origin: [200, 200]
  size: [1320, 600]
  utilization: 0.62

macros:
  - ref: u_sram
    block: sky130_sram_2k
    origin: [1080, 240]
    size: [240, 160]
  - ref: u_opamp
    block: sky130_opamp
    origin: [1080, 440]
  - ref: u_mzi
    block: cspdk_mzi
    origin: [1080, 640]

io:
  ring: true
  pads: 48
`,
  ),
  file(
    "design/digital/top.sv",
    "SystemVerilog",
    "source",
    `module top (
  input  logic       clk,
  input  logic       rst_n,
  inout  logic [7:0] gpio
);

  logic [31:0] instr;
  logic [31:0] data;
  logic        irq;
  logic [7:0]  gpio_in;
  logic [7:0]  gpio_out;
  logic        gpio_oe;

  rv32i_core u_core (
    .clk    (clk),
    .rst_n  (rst_n),
    .instr  (instr),
    .data   (data),
    .irq    (irq)
  );

  gpio_controller u_gpio (
    .clk     (clk),
    .rst_n   (rst_n),
    .bus_data(data[7:0]),
    .gpio_in (gpio_in),
    .gpio_out(gpio_out),
    .gpio_oe (gpio_oe),
    .irq     (irq)
  );

  sky130_sram_2k u_sram (
    .clk   (clk),
    .addr  (data[12:1]),
    .wdata (data),
    .rdata (instr)
  );

  assign gpio = gpio_oe ? gpio_out : 8'bz;

endmodule
`,
  ),
  file(
    "design/digital/gpio.sv",
    "SystemVerilog",
    "source",
    `module gpio_controller (
  input  logic       clk,
  input  logic       rst_n,
  input  logic [7:0] bus_data,
  input  logic [7:0] gpio_in,
  output logic [7:0] gpio_out,
  output logic       gpio_oe,
  output logic       irq
);

  logic [7:0] readback;
  logic       read_pending;

  // Readback mux is the critical path reported by OpenSTA.
  always_comb begin
    readback = read_pending ? bus_data : gpio_in;
  end

  // Repair candidate: register the readback selection one level earlier.
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      read_pending <= 1'b0;
      gpio_out     <= 8'h00;
      gpio_oe      <= 1'b0;
      irq          <= 1'b0;
    end else begin
      read_pending <= bus_data[7];
      gpio_out     <= bus_data;
      gpio_oe      <= bus_data[6];
      irq          <= bus_data[5] | gpio_in[0];
    end
  end

endmodule
`,
  ),
  file(
    "design/analog/opamp.spice",
    "SPICE",
    "source",
    `* Two-stage SKY130 CMOS op-amp
.subckt opamp vinp vinn vout vdd vss
xm1  n1   vinp  n3   vss sky130_fd_pr__nfet_01v8 w=8 l=1
xm2  n2   vinn  n3   vss sky130_fd_pr__nfet_01v8 w=8 l=1
xm3  n1   n1    vdd  vdd sky130_fd_pr__pfet_01v8 w=16 l=1
xm4  n2   n1    vdd  vdd sky130_fd_pr__pfet_01v8 w=16 l=1
xm5  vout n2    vdd  vdd sky130_fd_pr__pfet_01v8 w=32 l=1
xm6  vout n3    vss  vss sky130_fd_pr__nfet_01v8 w=4 l=1
cc   n2   vout  3p
ibias n3 vss 40u
.ends opamp

.include ../pdk/sky130/models/tt.spice
vdd vdd 0 1.8
vinp vinp 0 dc 0.9 ac 1
vinn vinn 0 dc 0.9
xo vout vinp vinn vdd 0 opamp
.ac dec 20 1 100meg
.meas ac gain_db max vdb(vout)
.meas ac pm find vp(vout) when vdb(vout)=0
`,
  ),
  file(
    "design/photonic/mzi.py",
    "Python",
    "source",
    `import gdsfactory as gf
import sax

PDK = "cspdk"
WAVELENGTH_NM = 1550


def mzi_wavelength_filter() -> gf.Component:
    c = gf.Component("mzi_filter")
    splitter = gf.get_component("mmi_1x2", pdk=PDK)
    combiner = gf.get_component("mmi_2x1", pdk=PDK)
    s1 = c << splitter
    s2 = c << combiner
    s2.movex(220)
    c << gf.get_component("straight", length=180, pdk=PDK)
    c.add_ports(s1.ports)
    c.add_ports(s2.ports)
    return c


if __name__ == "__main__":
    component = mzi_wavelength_filter()
    component.write_gds("exports/mzi.gds")
`,
  ),
  file(
    "tests/tb_top.sv",
    "SystemVerilog",
    "test",
    `module tb_top;
  logic clk = 0;
  logic rst_n = 0;
  wire [7:0] gpio;

  top dut (.clk(clk), .rst_n(rst_n), .gpio(gpio));

  always #4 clk = ~clk;

  initial begin
    repeat (4) @(posedge clk);
    rst_n = 1;
    repeat (128) @(posedge clk);
    if (dut.u_gpio.irq !== 1'b0) $fatal(1, "unexpected irq");
    $display("PASS: 128 / 128 tests");
    $finish;
  end
endmodule
`,
  ),
  file(
    "ip/manifest.yaml",
    "YAML",
    "ip",
    `blocks:
  - name: gpio_controller
    status: verified
    pdk: sky130
    domains: [digital]
    ports:
      - { name: clk, direction: input, width: 1 }
      - { name: bus_data, direction: input, width: 8 }
      - { name: gpio_out, direction: output, width: 8 }
    views: [rtl, schematic, layout]
    evidence: results/verilator.log

  - name: sky130_opamp
    status: verified
    pdk: sky130
    domains: [analog]
    ports:
      - { name: vinp, direction: input }
      - { name: vinn, direction: input }
      - { name: vout, direction: output }
    views: [spice, schematic]
    evidence: results/opamp_ac.csv

  - name: cspdk_mzi
    status: unverified
    pdk: cspdk
    domains: [photonic]
    ports:
      - { name: o1, direction: input }
      - { name: o2, direction: output }
    views: [python, gds]
    evidence: results/mzi_spectrum.csv
`,
  ),
  file(
    "workflows/digital.yaml",
    "YAML",
    "workflow",
    `flow: librelane
pdk: sky130
clock:
  port: clk
  period_ns: 8.0
stages:
  - verilator
  - yosys
  - openroad
  - opensta
  - klayout-export
max_iterations: 10
`,
  ),
  file(
    "results/verilator.log",
    "Log",
    "result",
    `$ verilator --binary --timing tb_top.sv top.sv gpio.sv
- Verilator 5.028
- Compiling 14 modules
- tb_top: 128 tests, 0 failures
- PASS rtl-functional (2.4s)
`,
    true,
  ),
  file(
    "results/timing.rpt",
    "Report",
    "result",
    `OpenSTA 2.6.0 -- sky130_fd_sc_hd__tt_025C_1v80

Startpoint: u_gpio.readback[7]
Endpoint:   u_core.irq
Path group: clk
Path type:   max

  data arrival time   9.12 ns
  data required time  8.00 ns
  slack              -1.12 ns  VIOLATED

WNS -1.12 ns
TNS -4.48 ns
`,
    true,
  ),
  file(
    "results/opamp_ac.csv",
    "CSV",
    "result",
    `frequency_hz,gain_db,phase_deg
1.0,61.4,-0.2
1000.0,61.4,-0.4
1000000.0,41.2,-28.6
4800000.0,0.0,-116.9
100000000.0,-32.1,-240.4
`,
    true,
  ),
  file(
    "results/mzi_spectrum.csv",
    "CSV",
    "result",
    `wavelength_nm,transmission_db
1540.0,-1.20
1548.0,-1.24
1549.5,-3.60
1550.0,-18.60
1550.5,-3.80
1552.0,-1.22
1560.0,-1.20
`,
    true,
  ),
];

export const initialConstraints: ConstraintSet = {
  pdk: "sky130",
  domains: ["digital", "analog", "photonic"],
  supplyV: "1.8",
  clockMhz: "125",
  maxPowerMw: "50",
  maxAreaMm2: "0.25",
  wavelengthNm: "1550",
  extinctionDb: "15",
  maxIterations: 10,
  autonomy: "approve",
  requiredChecks: [
    "rtl-functional",
    "synthesis-pnr",
    "static-timing",
    "drc-lvs",
    "opamp-gain",
    "opamp-phase-margin",
    "mzi-insertion-loss",
    "mzi-extinction",
    "power",
  ],
};

export const initialChecks: Check[] = [
  {
    id: "rtl-functional",
    name: "RTL functional tests",
    domain: "digital",
    tool: "Verilator 5.028",
    target: "128 / 128 tests pass",
    measured: "128 / 128 pass",
    status: "passed",
    artifact: "results/verilator.log",
    log: "tb_top: 128 tests, 0 failures, 2.4s",
    revision: initialRevision,
    updated: "4 min ago",
  },
  {
    id: "synthesis-pnr",
    name: "Synthesis & place-and-route",
    domain: "digital",
    tool: "LibreLane 2.4 / OpenROAD",
    target: "Area ≤ 0.25 mm²",
    measured: "0.184 mm², 0 routing violations",
    status: "passed",
    artifact: "exports/riscv_top.gds",
    log: "Detailed routing complete; final GDS written by KLayout export.",
    revision: initialRevision,
    updated: "6 min ago",
  },
  {
    id: "static-timing",
    name: "Static timing",
    domain: "digital",
    tool: "OpenSTA 2.6",
    target: "WNS ≥ 0.00 ns at 125 MHz",
    measured: "−1.12 ns (9.12 ns critical path)",
    status: "failed",
    artifact: "results/timing.rpt",
    log: "u_gpio.readback[7] → u_core.irq violates setup by 1.12 ns.",
    revision: initialRevision,
    updated: "6 min ago",
  },
  {
    id: "drc-lvs",
    name: "DRC / LVS",
    domain: "digital",
    tool: "KLayout / Netgen",
    target: "0 DRC violations, LVS clean",
    measured: "PDK deck not configured",
    status: "unsupported",
    artifact: "—",
    log: "No SKY130 DRC deck is registered in the runner adapter. This is not a pass.",
    revision: initialRevision,
    updated: "6 min ago",
  },
  {
    id: "opamp-gain",
    name: "Op-amp open-loop gain",
    domain: "analog",
    tool: "ngspice 44",
    target: "Gain ≥ 60 dB",
    measured: "61.4 dB",
    status: "passed",
    artifact: "results/opamp_ac.csv",
    log: "AC sweep 1 Hz–100 MHz, nominal TT, 1.8 V, 27 °C.",
    revision: initialRevision,
    updated: "11 min ago",
  },
  {
    id: "opamp-phase-margin",
    name: "Op-amp phase margin",
    domain: "analog",
    tool: "ngspice 44",
    target: "Phase margin ≥ 60°",
    measured: "63.1°",
    status: "passed",
    artifact: "results/opamp_ac.csv",
    log: "Unity-gain crossing at 4.8 MHz; phase margin 63.1°.",
    revision: initialRevision,
    updated: "11 min ago",
  },
  {
    id: "mzi-insertion-loss",
    name: "MZI insertion loss",
    domain: "photonic",
    tool: "SAX / cspdk",
    target: "Insertion loss ≤ 2.0 dB",
    measured: "1.2 dB at 1550 nm",
    status: "passed",
    artifact: "results/mzi_spectrum.csv",
    log: "Passband transmission −1.20 dB across the C-band target window.",
    revision: initialRevision,
    updated: "9 min ago",
  },
  {
    id: "mzi-extinction",
    name: "MZI extinction ratio",
    domain: "photonic",
    tool: "SAX / cspdk",
    target: "Extinction ratio ≥ 15 dB",
    measured: "18.6 dB",
    status: "passed",
    artifact: "results/mzi_spectrum.csv",
    log: "Notch at 1550.0 nm; extinction computed from simulated spectrum.",
    revision: initialRevision,
    updated: "9 min ago",
  },
  {
    id: "power",
    name: "Power analysis",
    domain: "digital",
    tool: "OpenROAD",
    target: "Total power ≤ 50 mW",
    measured: "No power report",
    status: "unsupported",
    artifact: "—",
    log: "The runner has no activity-annotated power report for this flow.",
    revision: initialRevision,
    updated: "6 min ago",
  },
];

export const toolRegistry: ToolDefinition[] = [
  {
    id: "klayout",
    label: "KLayout",
    detail: "Layout viewer and GDS export",
    category: "Layout",
    icon: "K",
    available: true,
    logs: [
      "klayout -b -r scripts/export_gds.py",
      "Loaded exports/riscv_top.gds (1,284 cells, 2.1 MB)",
      "Rendering top cell rocket_top at 0.184 mm²",
      "Layout view ready",
    ],
  },
  {
    id: "magic",
    label: "Magic DRC / LVS",
    detail: "Deck-driven physical verification",
    category: "Layout",
    icon: "M",
    available: false,
    unavailableReason: "No SKY130 DRC deck is registered in the runner",
    logs: [],
  },
  {
    id: "openrcx",
    label: "OpenRCX",
    detail: "Parasitic extraction",
    category: "Layout",
    icon: "RCX",
    available: false,
    unavailableReason: "Extraction deck unavailable for this flow",
    logs: [],
  },
  {
    id: "verilator",
    label: "Verilator",
    detail: "RTL simulation",
    category: "Digital",
    icon: "V",
    available: true,
    logs: [
      "verilator --binary --timing tests/tb_top.sv",
      "Compiling 14 modules",
      "tb_top: 128 tests, 0 failures",
      "PASS rtl-functional",
    ],
  },
  {
    id: "yosys",
    label: "Yosys",
    detail: "RTL synthesis",
    category: "Digital",
    icon: "Y",
    available: true,
    logs: [
      "yosys -p synth -top top -liberty sky130_fd_sc_hd.lib",
      "Mapped 4,112 cells to sky130_fd_sc_hd",
      "Synthesis report written to results/synthesis.rpt",
    ],
  },
  {
    id: "librelane",
    label: "LibreLane",
    detail: "Place-and-route flow",
    category: "Digital",
    icon: "LL",
    available: true,
    logs: [
      "librelane workflows/digital.yaml",
      "Floorplan, placement and detailed routing queued",
      "Utilization 62%, core area 0.184 mm²",
      "GDS written to exports/riscv_top.gds",
    ],
  },
  {
    id: "opensta",
    label: "OpenSTA",
    detail: "Static timing analysis",
    category: "Digital",
    icon: "STA",
    available: true,
    logs: [
      "read_liberty sky130_fd_sc_hd__tt_025C_1v80.lib",
      "report_checks -path_delay max",
      "Timing report written to results/timing.rpt",
    ],
  },
  {
    id: "ngspice",
    label: "ngspice",
    detail: "Analog circuit simulation",
    category: "Analog",
    icon: "nG",
    available: true,
    logs: [
      "ngspice -b design/analog/opamp.spice",
      "AC analysis complete: 1 Hz–100 MHz",
      "Measured gain 61.4 dB, phase margin 63.1°",
      "Waveforms written to results/opamp_ac.csv",
    ],
  },
  {
    id: "cace",
    label: "CACE",
    detail: "Analog characterization",
    category: "Analog",
    icon: "C",
    available: false,
    unavailableReason: "CACE is not installed in the local runner",
    logs: [],
  },
  {
    id: "gdsfactory",
    label: "GDSFactory",
    detail: "Photonic layout generation",
    category: "Photonic",
    icon: "GF",
    available: true,
    logs: [
      "python design/photonic/mzi.py",
      "Building cspdk mmi_1x2 and mmi_2x1 cells",
      "MZI routed with two 90° bends",
      "GDS written to exports/mzi.gds",
    ],
  },
  {
    id: "sax",
    label: "SAX",
    detail: "Photonic circuit simulation",
    category: "Photonic",
    icon: "SAX",
    available: true,
    logs: [
      "sax.circuit from cspdk compact models",
      "Sweeping 1540–1560 nm",
      "Insertion loss 1.2 dB, extinction ratio 18.6 dB",
      "Spectrum written to results/mzi_spectrum.csv",
    ],
  },
  {
    id: "meep",
    label: "Meep FDTD",
    detail: "Full-wave optical simulation",
    category: "Photonic",
    icon: "FDTD",
    available: false,
    unavailableReason: "Not part of the MVP verification flow",
    logs: [],
  },
  {
    id: "ip-registry",
    label: "IP registry",
    detail: "Search and register IP blocks",
    category: "Project",
    icon: "IP",
    available: true,
    logs: [
      "Searching project and PDK libraries",
      "Found rv32i_core, gpio_controller, sky130_opamp, cspdk_mzi",
      "gpio_controller registered with verified evidence",
    ],
  },
  {
    id: "export-bundle",
    label: "Export bundle",
    detail: "Package sources and reports",
    category: "Project",
    icon: "PKG",
    available: true,
    logs: [
      "Collecting project sources and constraints",
      "Attaching verification report and evidence references",
      "Binary GDS remains in runner artifact storage",
    ],
  },
  {
    id: "three-d",
    label: "3D geometry",
    detail: "3D layout inspection",
    category: "Project",
    icon: "3D",
    available: false,
    unavailableReason: "Stretch surface, not implemented in this build",
    logs: [],
  },
];

export const schematicSheets: Record<string, SchematicSheet> = {
  top: {
    id: "top",
    name: "top",
    path: "top",
    note: "Top-level mixed-domain assembly. Double-click GPIO or SKY130 Op-Amp to descend into their hierarchical sheets.",
    boundaryPorts: [
      { name: "clk", x: 40, y: 110, side: "left" },
      { name: "rst_n", x: 40, y: 140, side: "left" },
      { name: "vinp / vinn", x: 40, y: 365, side: "left" },
      { name: "gpio[7:0]", x: 900, y: 100, side: "right" },
      { name: "instr[31:0]", x: 900, y: 242, side: "right" },
      { name: "opt_out (1550nm)", x: 900, y: 385, side: "right" },
    ],
    instances: [
      {
        id: "u_core",
        label: "RV32I core",
        block: "ip://rv32i_core",
        x: 110,
        y: 115,
        width: 230,
        height: 175,
        tone: "blue",
        badge: "IP",
        sourceFile: "design/digital/top.sv",
        params: [
          { name: "PDK", value: "sky130" },
          { name: "ISA", value: "RV32I" },
          { name: "Clock", value: "125 MHz" },
        ],
        ports: [
          { name: "clk", side: "left", offset: 0.25 },
          { name: "rst_n", side: "left", offset: 0.5 },
          { name: "bus", side: "right", offset: 0.3 },
          { name: "mem", side: "right", offset: 0.5 },
          { name: "irq", side: "right", offset: 0.7 },
        ],
      },
      {
        id: "u_gpio",
        label: "GPIO controller",
        block: "design://gpio",
        x: 430,
        y: 115,
        width: 200,
        height: 165,
        tone: "purple",
        badge: "SHEET",
        sheet: "gpio",
        sourceFile: "design/digital/gpio.sv",
        params: [
          { name: "PDK", value: "sky130" },
          { name: "Width", value: "8 bit" },
          { name: "Status", value: "timing violation" },
        ],
        ports: [
          { name: "bus", side: "left", offset: 0.3 },
          { name: "irq", side: "left", offset: 0.7 },
          { name: "gpio", side: "right", offset: 0.5 },
        ],
      },
      {
        id: "u_sram",
        label: "SRAM 2 KB",
        block: "ip://sky130_sram_2k",
        x: 690,
        y: 115,
        width: 150,
        height: 165,
        tone: "green",
        badge: "MACRO",
        sourceFile: "design/layout.yaml",
        params: [
          { name: "PDK", value: "sky130" },
          { name: "Capacity", value: "2 KB" },
          { name: "View", value: "hard macro" },
        ],
        ports: [
          { name: "mem", side: "left", offset: 0.4 },
          { name: "clk", side: "left", offset: 0.7 },
          { name: "rdata", side: "right", offset: 0.4 },
        ],
      },
      {
        id: "u_opamp",
        label: "SKY130 2-stage Op-Amp",
        block: "design://opamp",
        x: 430,
        y: 315,
        width: 200,
        height: 140,
        tone: "amber",
        badge: "SHEET",
        sheet: "opamp",
        symbol: "opamp",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "PDK", value: "sky130 / level-1" },
          { name: "DC Gain", value: "61.4 dB (≥60 dB)" },
          { name: "Phase Margin", value: "63.1° (≥60°)" },
        ],
        ports: [
          { name: "vinp", side: "left", offset: 0.35 },
          { name: "vinn", side: "left", offset: 0.7 },
          { name: "vout", side: "right", offset: 0.5 },
        ],
      },
      {
        id: "u_mzi",
        label: "CSPDK MZI Filter",
        block: "ip://cspdk_mzi",
        x: 690,
        y: 315,
        width: 150,
        height: 140,
        tone: "green",
        badge: "IP",
        symbol: "mzi",
        sourceFile: "design/photonic/mzi.py",
        params: [
          { name: "PDK", value: "cspdk" },
          { name: "Wavelength", value: "1550 nm" },
          { name: "Extinction", value: "18.6 dB" },
        ],
        ports: [
          { name: "drive", side: "left", offset: 0.5 },
          { name: "o2", side: "right", offset: 0.5 },
        ],
      },
    ],
    wires: [
      { points: [[40, 110], [75, 110], [75, 159], [110, 159]], label: "clk" },
      { points: [[40, 140], [90, 140], [90, 202], [110, 202]], label: "rst_n" },
      { points: [[340, 165], [430, 165]], label: "bus" },
      { points: [[430, 230], [340, 230]], label: "irq" },
      {
        points: [[340, 202], [385, 202], [385, 292], [665, 292], [665, 181], [690, 181]],
        label: "addr / wdata",
      },
      { points: [[630, 198], [660, 198], [660, 100], [900, 100]], label: "gpio[7:0]" },
      { points: [[840, 181], [900, 181], [900, 242]], label: "instr[31:0]" },
      { points: [[40, 365], [430, 365]], label: "vinp / vinn" },
      { points: [[630, 385], [690, 385]], label: "vout" },
      { points: [[840, 385], [900, 385]], label: "opt_out" },
    ],
  },
  gpio: {
    id: "gpio",
    name: "GPIO controller",
    path: "top/gpio",
    note: "Sub-sheet of top. The readback mux is the failing setup path reported by OpenSTA.",
    boundaryPorts: [
      { name: "bus_in", x: 40, y: 220, side: "left" },
      { name: "addr", x: 40, y: 390, side: "left" },
      { name: "gpio[7:0]", x: 900, y: 215, side: "right" },
      { name: "irq", x: 900, y: 310, side: "right" },
    ],
    instances: [
      {
        id: "u_busif",
        label: "Bus interface",
        block: "rtl://gpio_busif",
        x: 90,
        y: 150,
        width: 180,
        height: 130,
        tone: "purple",
        badge: "IP",
        params: [
          { name: "PDK", value: "sky130" },
          { name: "Bus", value: "wishbone-lite" },
        ],
        ports: [
          { name: "bus", side: "left", offset: 0.5 },
          { name: "wdata", side: "right", offset: 0.35 },
          { name: "sel", side: "right", offset: 0.7 },
        ],
      },
      {
        id: "u_regs",
        label: "Register file",
        block: "rtl://gpio_regs",
        x: 340,
        y: 130,
        width: 210,
        height: 170,
        tone: "blue",
        badge: "IP",
        params: [
          { name: "PDK", value: "sky130" },
          { name: "Registers", value: "4 × 8 bit" },
          { name: "Status", value: "critical path" },
        ],
        ports: [
          { name: "wdata", side: "left", offset: 0.35 },
          { name: "sel", side: "left", offset: 0.7 },
          { name: "gpio", side: "right", offset: 0.4 },
          { name: "irq", side: "right", offset: 0.8 },
          { name: "decode", side: "bottom", offset: 0.5 },
        ],
      },
      {
        id: "u_decode",
        label: "Address decode",
        block: "rtl://gpio_decode",
        x: 340,
        y: 340,
        width: 210,
        height: 100,
        tone: "amber",
        badge: "IP",
        params: [
          { name: "PDK", value: "sky130" },
          { name: "Bank", value: "0x1002_0000" },
        ],
        ports: [
          { name: "addr", side: "left", offset: 0.5 },
          { name: "sel", side: "top", offset: 0.5 },
        ],
      },
      {
        id: "u_pads",
        label: "GPIO pads",
        block: "ip://gpio_pads_8",
        x: 660,
        y: 150,
        width: 180,
        height: 130,
        tone: "green",
        badge: "MACRO",
        params: [
          { name: "PDK", value: "sky130" },
          { name: "Pads", value: "8" },
        ],
        ports: [
          { name: "gpio", side: "left", offset: 0.35 },
          { name: "pad", side: "right", offset: 0.5 },
        ],
      },
    ],
    wires: [
      { points: [[40, 220], [90, 220]], label: "bus_in" },
      { points: [[270, 195], [340, 189]], label: "wdata" },
      { points: [[270, 241], [340, 249]], label: "sel" },
      { points: [[445, 300], [445, 340]], label: "sel" },
      { points: [[40, 390], [340, 390]], label: "addr" },
      { points: [[550, 198], [660, 195]], label: "gpio" },
      { points: [[840, 215], [900, 215]], label: "gpio[7:0]" },
      {
        points: [[550, 266], [600, 266], [600, 310], [900, 310]],
        label: "irq",
        dashed: true,
      },
    ],
  },
  opamp: {
    id: "opamp",
    name: "Two-stage Miller op-amp",
    path: "top/opamp",
    note: "Transistor-level CMOS schematic (design/analog/opamp.spice · opamp.cir). Stage-2 length L2 = 0.5 µm → 1.0 µm raises DC gain from 55.73 dB to 61.18 dB in ngspice.",
    boundaryPorts: [
      { name: "vdd (1.8V)", x: 40, y: 78, side: "left" },
      { name: "inn", x: 40, y: 235, side: "left" },
      { name: "inp", x: 40, y: 300, side: "left" },
      { name: "bias (0.75V)", x: 40, y: 425, side: "left" },
      { name: "vout", x: 900, y: 245, side: "right" },
      { name: "vss (GND)", x: 900, y: 445, side: "right" },
    ],
    instances: [
      {
        id: "M3",
        label: "PMOS active load (diode)",
        block: "sky130_fd_pr__pfet_01v8",
        x: 150,
        y: 95,
        width: 145,
        height: 98,
        tone: "purple",
        badge: "IP",
        symbol: "pmos",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "Model", value: "pch / pfet_01v8" },
          { name: "W / L", value: "16 µm / 1.0 µm" },
          { name: "Topology", value: "diode-connected" },
        ],
        ports: [
          { name: "S (vdd)", side: "top", offset: 0.5 },
          { name: "G (n1)", side: "right", offset: 0.5 },
          { name: "D (n1)", side: "bottom", offset: 0.5 },
        ],
      },
      {
        id: "M4",
        label: "PMOS mirror load",
        block: "sky130_fd_pr__pfet_01v8",
        x: 345,
        y: 95,
        width: 145,
        height: 98,
        tone: "purple",
        badge: "IP",
        symbol: "pmos",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "Model", value: "pch / pfet_01v8" },
          { name: "W / L", value: "16 µm / 1.0 µm" },
          { name: "Node", value: "drives stage-2 gate n2" },
        ],
        ports: [
          { name: "S (vdd)", side: "top", offset: 0.5 },
          { name: "G (n1)", side: "left", offset: 0.5 },
          { name: "D (n2)", side: "bottom", offset: 0.5 },
        ],
      },
      {
        id: "M1",
        label: "Diff pair NMOS (−)",
        block: "sky130_fd_pr__nfet_01v8",
        x: 150,
        y: 225,
        width: 145,
        height: 98,
        tone: "blue",
        badge: "IP",
        symbol: "nmos",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "Model", value: "nch / nfet_01v8" },
          { name: "W / L", value: "8 µm / 1.0 µm" },
          { name: "Gate", value: "inn" },
        ],
        ports: [
          { name: "D (n1)", side: "top", offset: 0.5 },
          { name: "G (inn)", side: "left", offset: 0.5 },
          { name: "S (tail)", side: "bottom", offset: 0.5 },
        ],
      },
      {
        id: "M2",
        label: "Diff pair NMOS (+)",
        block: "sky130_fd_pr__nfet_01v8",
        x: 345,
        y: 225,
        width: 145,
        height: 98,
        tone: "blue",
        badge: "IP",
        symbol: "nmos",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "Model", value: "nch / nfet_01v8" },
          { name: "W / L", value: "8 µm / 1.0 µm" },
          { name: "Gate", value: "inp" },
        ],
        ports: [
          { name: "D (n2)", side: "top", offset: 0.5 },
          { name: "G (inp)", side: "left", offset: 0.5 },
          { name: "S (tail)", side: "bottom", offset: 0.5 },
        ],
      },
      {
        id: "M5",
        label: "Tail current sink",
        block: "sky130_fd_pr__nfet_01v8",
        x: 248,
        y: 365,
        width: 145,
        height: 95,
        tone: "green",
        badge: "IP",
        symbol: "isource",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "Bias current", value: "40 µA" },
          { name: "W / L", value: "4 µm / 1.0 µm" },
          { name: "Node", value: "tail → vss" },
        ],
        ports: [
          { name: "D (tail)", side: "top", offset: 0.5 },
          { name: "G (bias)", side: "left", offset: 0.5 },
          { name: "S (vss)", side: "bottom", offset: 0.5 },
        ],
      },
      {
        id: "CC",
        label: "Miller compensation cap",
        block: "sky130_fd_pr__cap_mim_m3_1",
        x: 530,
        y: 195,
        width: 125,
        height: 86,
        tone: "amber",
        badge: "IP",
        symbol: "capacitor",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "C (CC)", value: "1.0 pF / 3.0 pF" },
          { name: "Phase margin", value: "65.64° (PASS ≥ 60°)" },
          { name: "Nodes", value: "n2 ↔ vout" },
        ],
        ports: [
          { name: "n2", side: "left", offset: 0.5 },
          { name: "vout", side: "right", offset: 0.5 },
        ],
      },
      {
        id: "M6",
        label: "Stage-2 gain PMOS (L2)",
        block: "sky130_fd_pr__pfet_01v8",
        x: 695,
        y: 105,
        width: 160,
        height: 105,
        tone: "amber",
        badge: "IP",
        symbol: "pmos",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "Param L2", value: "0.5 µm → 1.0 µm" },
          { name: "W / L", value: "40·L2 / L2" },
          { name: "DC Gain", value: "55.73 → 61.18 dB" },
        ],
        ports: [
          { name: "S (vdd)", side: "top", offset: 0.5 },
          { name: "G (n2)", side: "left", offset: 0.5 },
          { name: "D (vout)", side: "bottom", offset: 0.5 },
        ],
      },
      {
        id: "M7",
        label: "Stage-2 active sink",
        block: "sky130_fd_pr__nfet_01v8",
        x: 695,
        y: 315,
        width: 160,
        height: 105,
        tone: "blue",
        badge: "IP",
        symbol: "nmos",
        sourceFile: "design/analog/opamp.spice",
        params: [
          { name: "Param L2", value: "0.5 µm → 1.0 µm" },
          { name: "W / L", value: "20·L2 / L2" },
          { name: "UGBW", value: "34.06 MHz (≥10 MHz)" },
        ],
        ports: [
          { name: "D (vout)", side: "top", offset: 0.5 },
          { name: "G (bias)", side: "left", offset: 0.5 },
          { name: "S (vss)", side: "bottom", offset: 0.5 },
        ],
      },
    ],
    wires: [
      { points: [[40, 78], [775, 78], [775, 105]], label: "vdd" },
      { points: [[222, 193], [222, 225]], label: "n1" },
      { points: [[295, 144], [345, 144]], label: "n1 (mirror)" },
      { points: [[417, 193], [417, 225]], label: "n2" },
      { points: [[417, 210], [505, 210], [505, 157], [695, 157]], label: "n2 (stage-2 gate)" },
      { points: [[505, 210], [505, 238], [530, 238]], label: "n2" },
      { points: [[40, 235], [120, 235], [120, 274], [150, 274]], label: "inn" },
      { points: [[40, 300], [320, 300], [320, 274], [345, 274]], label: "inp" },
      { points: [[222, 323], [222, 345], [417, 345], [417, 323]], label: "tail" },
      { points: [[320, 345], [320, 365]], label: "tail" },
      { points: [[40, 425], [248, 412]], label: "bias" },
      { points: [[248, 412], [655, 412], [655, 367], [695, 367]], label: "bias" },
      { points: [[655, 238], [775, 238]], label: "cc_out" },
      { points: [[775, 210], [775, 315]], label: "vout" },
      { points: [[775, 245], [900, 245]], label: "vout" },
      { points: [[320, 460], [775, 460], [775, 420]], label: "vss" },
      { points: [[775, 445], [900, 445]], label: "vss" },
    ],
  },
};

export const initialSymbolLibrary: CircuitSymbolDef[] = [
  {
    id: "nmos_4t",
    name: "NMOS_4T",
    referencePrefix: "M",
    domain: "analog",
    shape: "nmos",
    pdkCell: "sky130_fd_pr__nfet_01v8",
    description: "1.8 V 4-terminal N-channel MOSFET symbol with gate, drain, source and bulk pins.",
    defaultParams: [
      { name: "W", value: "4u" },
      { name: "L", value: "1u" },
      { name: "M", value: "1" },
    ],
    pins: [
      { number: "1", name: "D", side: "top", electricalType: "passive", offset: 0.5 },
      { number: "2", name: "G", side: "left", electricalType: "input", offset: 0.5 },
      { number: "3", name: "S", side: "bottom", electricalType: "passive", offset: 0.5 },
      { number: "4", name: "B", side: "right", electricalType: "power", offset: 0.5 },
    ],
  },
  {
    id: "pmos_4t",
    name: "PMOS_4T",
    referencePrefix: "M",
    domain: "analog",
    shape: "pmos",
    pdkCell: "sky130_fd_pr__pfet_01v8",
    description: "1.8 V 4-terminal P-channel MOSFET symbol (used for active mirror loads M3/M4 and stage-2 M6).",
    defaultParams: [
      { name: "W", value: "40u" },
      { name: "L", value: "1.0u" },
      { name: "M", value: "1" },
    ],
    pins: [
      { number: "1", name: "S", side: "top", electricalType: "power", offset: 0.5 },
      { number: "2", name: "G", side: "left", electricalType: "input", offset: 0.5 },
      { number: "3", name: "D", side: "bottom", electricalType: "passive", offset: 0.5 },
      { number: "4", name: "B", side: "right", electricalType: "power", offset: 0.5 },
    ],
  },
  {
    id: "cap_mim",
    name: "CAP_MIM",
    referencePrefix: "C",
    domain: "analog",
    shape: "capacitor",
    pdkCell: "sky130_fd_pr__cap_mim_m3_1",
    description: "Metal-insulator-metal capacitor symbol for Miller compensation (CC) and decoupling.",
    defaultParams: [
      { name: "C", value: "1.0p" },
      { name: "W", value: "10u" },
      { name: "L", value: "10u" },
    ],
    pins: [
      { number: "1", name: "P1", side: "left", electricalType: "passive", offset: 0.5 },
      { number: "2", name: "P2", side: "right", electricalType: "passive", offset: 0.5 },
    ],
  },
  {
    id: "res_poly",
    name: "RES_POLY",
    referencePrefix: "R",
    domain: "analog",
    shape: "resistor",
    pdkCell: "sky130_fd_pr__res_high_po",
    description: "High-sheet-resistance polysilicon resistor symbol for bias dividers and feedback networks.",
    defaultParams: [
      { name: "R", value: "10k" },
      { name: "W", value: "1.4u" },
      { name: "L", value: "20u" },
    ],
    pins: [
      { number: "1", name: "P1", side: "left", electricalType: "passive", offset: 0.5 },
      { number: "2", name: "P2", side: "right", electricalType: "passive", offset: 0.5 },
    ],
  },
  {
    id: "isource_dc",
    name: "IBIAS_SINK",
    referencePrefix: "I",
    domain: "analog",
    shape: "isource",
    pdkCell: "sky130_fd_pr__nfet_01v8_tail",
    description: "Reference current sink / tail bias source symbol for differential amplifiers.",
    defaultParams: [
      { name: "I", value: "40u" },
      { name: "Vbias", value: "0.75V" },
    ],
    pins: [
      { number: "1", name: "TAIL", side: "top", electricalType: "passive", offset: 0.5 },
      { number: "2", name: "BIAS", side: "left", electricalType: "input", offset: 0.5 },
      { number: "3", name: "VSS", side: "bottom", electricalType: "power", offset: 0.5 },
    ],
  },
  {
    id: "opamp_2stage",
    name: "OPAMP_2STAGE",
    referencePrefix: "X",
    domain: "analog",
    shape: "opamp",
    pdkCell: "design://opamp",
    description: "Hierarchical IEEE triangle symbol for the two-stage CMOS operational amplifier subcircuit.",
    defaultParams: [
      { name: "Gain", value: "≥60 dB" },
      { name: "UGBW", value: "≥10 MHz" },
      { name: "PM", value: "≥60°" },
    ],
    pins: [
      { number: "1", name: "INP", side: "left", electricalType: "input", offset: 0.35 },
      { number: "2", name: "INN", side: "left", electricalType: "input", offset: 0.68 },
      { number: "3", name: "VDD", side: "top", electricalType: "power", offset: 0.5 },
      { number: "4", name: "VSS", side: "bottom", electricalType: "power", offset: 0.5 },
      { number: "5", name: "OUT", side: "right", electricalType: "output", offset: 0.5 },
    ],
  },
  {
    id: "logic_dff",
    name: "DFF_READBACK",
    referencePrefix: "U",
    domain: "digital",
    shape: "dff",
    pdkCell: "sky130_fd_sc_hd__dfxtp_1",
    description: "Standard-cell positive-edge D flip-flop used to register the GPIO readback timing path.",
    defaultParams: [
      { name: "Drive", value: "1x" },
      { name: "Setup", value: "0.14 ns" },
      { name: "Width", value: "8 bit" },
    ],
    pins: [
      { number: "1", name: "D", side: "left", electricalType: "input", offset: 0.35 },
      { number: "2", name: "CLK", side: "left", electricalType: "input", offset: 0.7 },
      { number: "3", name: "RST_N", side: "bottom", electricalType: "input", offset: 0.5 },
      { number: "4", name: "Q", side: "right", electricalType: "output", offset: 0.5 },
    ],
  },
  {
    id: "photonic_mzi",
    name: "MZI_FILTER",
    referencePrefix: "P",
    domain: "photonic",
    shape: "mzi",
    pdkCell: "cspdk.mzi_wavelength_filter",
    description: "Mach-Zehnder interferometer optical wavelength filter (MMI 1x2 + 180 µm delay arm + MMI 2x1).",
    defaultParams: [
      { name: "Lambda", value: "1550 nm" },
      { name: "dL", value: "180 µm" },
      { name: "ER", value: "18.6 dB" },
    ],
    pins: [
      { number: "1", name: "O1_IN", side: "left", electricalType: "input", offset: 0.5 },
      { number: "2", name: "V_HEAT", side: "top", electricalType: "input", offset: 0.5 },
      { number: "3", name: "O2_OUT", side: "right", electricalType: "output", offset: 0.5 },
    ],
  },
];

export const activityFeed = [
  {
    title: "OpenSTA reported a setup violation",
    detail: "u_gpio.readback[7] → u_core.irq · −1.12 ns at 125 MHz",
    status: "failed" as const,
    time: "6 min ago",
  },
  {
    title: "LibreLane completed the digital flow",
    detail: "Routed GDS produced for sky130 · 0.184 mm² · revision 8f3c1a2",
    status: "passed" as const,
    time: "6 min ago",
  },
  {
    title: "SAX finished the MZI spectrum",
    detail: "Insertion loss 1.2 dB · extinction ratio 18.6 dB · 1540–1560 nm",
    status: "passed" as const,
    time: "9 min ago",
  },
  {
    title: "ngspice characterized the SKY130 op-amp",
    detail: "Gain 61.4 dB · phase margin 63.1° · nominal TT, 1.8 V",
    status: "passed" as const,
    time: "11 min ago",
  },
  {
    title: "IP block registered",
    detail: "gpio_controller verified with typed ports and schematic view",
    status: "passed" as const,
    time: "18 min ago",
  },
];

export const spectrum = Array.from({ length: 81 }, (_, index) => {
  const wavelength = 1540 + index * 0.25;
  const detune = (wavelength - 1550) / 1.15;
  const transmission = 0.758 - 0.747 * Math.exp(-(detune * detune) * 2.4);
  return { wavelength, transmission };
});

export const waveformSignals = [
  {
    name: "clk",
    bits: Array.from({ length: 32 }, (_, index) => (index % 2 === 0 ? 1 : 0)),
  },
  {
    name: "valid",
    bits: [0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    name: "gpio[7]",
    bits: [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  },
  {
    name: "irq",
    bits: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
];
