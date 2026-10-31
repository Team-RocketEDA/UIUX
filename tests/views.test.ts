// Run: node --test tests/  (Node 22.18+ runs TypeScript directly)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { layoutCircuit } from "../src/schematic/layout.ts";
import { evaluate, formatEng, parseNetlist, showValue } from "../src/schematic/netlist.ts";

const OPAMP = readFileSync(new URL("./fixtures/opamp.cir", import.meta.url), "utf8");
const TB = readFileSync(new URL("./fixtures/tb_opamp.cir", import.meta.url), "utf8");

test("parses subckts, params, models and MOS polarity", () => {
  const netlist = parseNetlist(OPAMP);
  assert.deepEqual(Object.keys(netlist.params), ["l2", "cc"]);
  assert.equal(netlist.subckts.length, 1);
  const opamp = netlist.subckts[0];
  assert.deepEqual(opamp.ports, ["inp", "inn", "out", "vdd", "vss", "bias"]);
  assert.deepEqual(opamp.devices.map((d) => `${d.name}:${d.kind}`), [
    "M1:nmos", "M2:nmos", "M3:pmos", "M4:pmos", "M5:nmos", "M6:pmos", "M7:nmos", "CC:cap",
  ]);
  assert.equal(opamp.devices[5].params.l, "{L2*1e-6}");
  assert.equal(opamp.devices[5].line, 16);
});

test("evaluates sizes from .param values", () => {
  const { params } = parseNetlist(OPAMP);
  assert.equal(showValue("{L2*1e-6}", params, "m"), "0.5µm");
  assert.equal(showValue("{40*L2*1e-6}", params, "m"), "20µm");
  assert.equal(showValue("4u", params, "m"), "4µm");
  assert.equal(formatEng(evaluate("{CC*1e-12}", params)!, "F"), "1pF");
  assert.equal(evaluate("{0.08/L2}", params), 0.16);
  assert.equal(formatEng(0.5), "0.5");
  assert.equal(evaluate("{sqrt(L2)}", params), undefined);
  assert.equal(showValue("2p", params, "F"), "2pF");
  assert.equal(showValue("1G", params, "Ω"), "1GΩ");
});

test("subckt instances take pin names from the definition; testbench sources parse", () => {
  const netlist = parseNetlist(OPAMP + "\n" + TB);
  const x = netlist.top.devices.find((d) => d.name === "XOA")!;
  assert.equal(x.kind, "subckt");
  assert.deepEqual(x.pins.map((p) => `${p.name}=${p.net}`), ["inp=inp", "inn=inn", "out=out", "vdd=vdd", "vss=0", "bias=bias"]);
  assert.equal(netlist.top.devices.find((d) => d.name === "VCM")!.value, "0.9 AC 1");
});

test("op-amp layout: PMOS on top, diff pair above the tail, stacks aligned", () => {
  const layout = layoutCircuit(parseNetlist(OPAMP).subckts[0]);
  const at = Object.fromEntries(layout.devices.map((p) => [p.device.name, p]));
  assert.ok(at.M3.y < at.CC.y && at.CC.y < at.M1.y && at.M1.y < at.M5.y, "rows: PMOS, passives, diff pair, tail");
  assert.equal(at.M1.y, at.M2.y);
  assert.equal(at.M5.y, at.M7.y);
  assert.ok(Math.abs(at.M3.x - at.M1.x) < 40, "M3 sits over M1");
  assert.ok(Math.abs(at.M6.x - at.M7.x) < 40, "M6 sits over M7");
  assert.ok(at.M1.x < at.M6.x, "first stage left of the second");
  // Supplies and ground are local symbols, never routed wires.
  assert.ok(!layout.segments.some((s) => s.net === "vdd" || s.net === "vss"));
  assert.equal(layout.rails.filter((r) => r.net === "vdd").length, 3);
  // Every routed net is one connected piece.
  for (const net of new Set(layout.segments.map((s) => s.net))) assert.ok(connected(layout.segments.filter((s) => s.net === net)), net);
});

test("testbench layout places every device", () => {
  const netlist = parseNetlist(OPAMP + "\n" + TB);
  const layout = layoutCircuit(netlist.top);
  assert.equal(layout.devices.length, 7);
  assert.ok(layout.width > 0 && layout.height > 0);
});

function connected(segments: { x1: number; y1: number; x2: number; y2: number }[]) {
  const onSegment = (s: (typeof segments)[number], x: number, y: number) =>
    x >= Math.min(s.x1, s.x2) && x <= Math.max(s.x1, s.x2) && y >= Math.min(s.y1, s.y2) && y <= Math.max(s.y1, s.y2);
  const touches = (a: (typeof segments)[number], b: (typeof segments)[number]) =>
    onSegment(a, b.x1, b.y1) || onSegment(a, b.x2, b.y2) || onSegment(b, a.x1, a.y1) || onSegment(b, a.x2, a.y2);
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.pop()!;
    segments.forEach((s, j) => {
      if (!seen.has(j) && touches(segments[i], s)) {
        seen.add(j);
        queue.push(j);
      }
    });
  }
  return seen.size === segments.length;
}

// ---- plots: ngspice rawfile from a real engine run (every 10th point of the op-amp AC sweep) ----
import { bode, nearest, parseRawfile, unityGain } from "../src/plots/rawfile.ts";

test("reads an ngspice ASCII rawfile and derives the Bode view", () => {
  const plot = parseRawfile(readFileSync(new URL("./fixtures/opamp-ac.raw", import.meta.url), "utf8"));
  assert.equal(plot.plotname, "AC Analysis");
  assert.ok(plot.complex);
  assert.ok(plot.variables.some((v) => v.name === "v(out)"));
  const points = bode(plot, "v(out)");
  assert.equal(points.length, plot.values[0].length);
  // Same numbers the engine measured on this run: 55.73 dB DC gain, UGBW ~33.6 MHz, PM ~67.8 deg.
  assert.ok(Math.abs(points[0].db - 55.73) < 0.05, `dc gain ${points[0].db}`);
  const ugbw = unityGain(points)!;
  assert.ok(Math.abs(ugbw.f / 1e6 - 33.57) < 1.5, `ugbw ${ugbw.f}`);
  assert.ok(Math.abs(180 + ugbw.phase - 67.76) < 2, `pm ${180 + ugbw.phase}`);
  assert.equal(nearest(points, 1)!.f, points[0].f);
});
