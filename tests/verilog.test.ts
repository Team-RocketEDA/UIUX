import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleDiagram, parseVerilog, topModule } from "../src/schematic/verilog.ts";

const LEAF = `
// a comment holding module fake ( input z );
module adder #(parameter W = 8) (
  input  wire [W-1:0] a, b, // two inputs on one line
  input  wire         clk,
  output reg  [W:0]   sum
);
  always @(posedge clk) sum <= a + b;
endmodule
`;
const TOP = `
module top #(parameter W = 8, parameter D = $clog2(W)) (
  input  wire [W-1:0] x,
  input  wire         clk,
  output wire [W:0]   y
);
  wire [W:0] s0;
  adder #(.W(W)) u_a (.a(x), .b(x), .clk(clk), .sum(s0));
  adder u_b (.a(s0[W-1:0]), .b({W{1'b0}}), .clk(clk), .sum(y));
  assign foo = bar (baz);
  if (W > 4) begin end
endmodule
module old(a, b);
  input a;
  output [3:0] b;
endmodule
`;

test("reads ANSI ports, carrying direction and width across a comma", () => {
  const [adder] = parseVerilog(LEAF);
  assert.equal(adder.name, "adder");
  assert.deepEqual(adder.ports, [
    { name: "a", direction: "input", width: "[W-1:0]" },
    { name: "b", direction: "input", width: "[W-1:0]" },
    { name: "clk", direction: "input" },
    { name: "sum", direction: "output", width: "[W:0]" },
  ]);
});

test("comments and parameters don't confuse it", () => {
  assert.deepEqual(parseVerilog(LEAF).map((module) => module.name), ["adder"]);
  assert.equal(parseVerilog(TOP)[0].ports.length, 3);
});

test("reads old-style ports from the body", () => {
  const old = parseVerilog(TOP).find((module) => module.name === "old")!;
  assert.deepEqual(old.ports, [{ name: "a", direction: "input" }, { name: "b", direction: "output", width: "[3:0]" }]);
});

test("finds instances with and without parameters, and nothing that only looks like one", () => {
  const top = parseVerilog(TOP)[0];
  assert.deepEqual(top.instances.map((instance) => `${instance.module} ${instance.name}`), ["adder u_a", "adder u_b"]);
  assert.equal(top.instances[0].connections.sum, "s0");
  assert.equal(top.instances[1].connections.a, "s0[W-1:0]");
});

test("the top is what nothing instantiates and holds the most", () => {
  const modules = [...parseVerilog(LEAF), ...parseVerilog(TOP)];
  assert.equal(topModule(modules)?.name, "top");
});

test("a module named as a top wins over a bigger one", () => {
  const modules = parseVerilog("module big; cell a (.x(1)); cell b (.x(1)); cell c (.x(1)); endmodule\nmodule chip_top; big u (.y(1)); endmodule\nmodule loop; cell a (.x(1)); cell b (.x(1)); endmodule\nmodule cell(input x); endmodule");
  assert.equal(topModule(modules)?.name, "chip_top");
});

test("a testbench isn't the top", () => {
  const modules = parseVerilog("module tb_x; adder u (.a(1)); adder v (.a(1)); endmodule\nmodule chip(input a); endmodule");
  assert.equal(topModule(modules)?.name, "chip");
});

test("draws wires along nets, in order from input to output", () => {
  const modules = [...parseVerilog(LEAF), ...parseVerilog(TOP)];
  const { nodes, edges } = moduleDiagram(modules.find((module) => module.name === "top")!, modules);
  const wire = (from: string, to: string) => edges.find((edge) => edge.from === from && edge.to === to);
  assert.deepEqual(wire("port:x", "inst:u_a")?.nets, ["x"]);
  assert.deepEqual(wire("inst:u_a", "inst:u_b")?.nets, ["s0"]);
  assert.deepEqual(wire("inst:u_b", "port:y")?.nets, ["y"]);
  const layer = (id: string) => nodes.find((node) => node.id === id)!.layer;
  assert.ok(layer("port:x") < layer("inst:u_a") && layer("inst:u_a") < layer("inst:u_b") && layer("inst:u_b") < layer("port:y"));
});

test("can leave out clock and reset, which reach everything", () => {
  const modules = [...parseVerilog(LEAF), ...parseVerilog(TOP)];
  const top = modules.find((module) => module.name === "top")!;
  const without = moduleDiagram(top, modules, { showClocks: false });
  assert.ok(!without.nodes.some((node) => node.id === "port:clk"));
  assert.ok(!without.edges.some((edge) => edge.nets.includes("clk")));
  assert.ok(without.edges.some((edge) => edge.nets.includes("s0")));
  assert.ok(moduleDiagram(top, modules).nodes.some((node) => node.id === "port:clk"));
});

test("a module with nothing inside draws as one block between its ports", () => {
  const modules = parseVerilog(LEAF);
  const { nodes, edges } = moduleDiagram(modules[0], modules, { showClocks: false });
  const block = nodes.find((node) => node.kind === "instance")!;
  assert.equal(block.module, "adder");
  assert.ok(edges.some((edge) => edge.from === "port:a" && edge.to === block.id));
  assert.ok(edges.some((edge) => edge.from === block.id && edge.to === "port:sum"));
  const layer = (id: string) => nodes.find((node) => node.id === id)!.layer;
  assert.ok(layer("port:a") < block.layer && block.layer < layer("port:sum"));
});

test("a feedback loop doesn't hang it", () => {
  const source = `
    module cell(input a, output b); endmodule
    module ring(input x, output y);
      cell c1 (.a(n2), .b(n1));
      cell c2 (.a(n1), .b(n2));
    endmodule`;
  const modules = parseVerilog(source);
  const { edges } = moduleDiagram(modules[1], modules);
  assert.equal(edges.length, 2);
});
