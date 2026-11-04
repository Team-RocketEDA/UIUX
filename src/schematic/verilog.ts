// Reads the structure of Verilog sources, enough to draw a block diagram: each module's ports and which modules it
// instantiates, wired how. It reads text only, and never elaborates, so it stays fast on a whole chip.
export type Direction = "input" | "output" | "inout";
export type Port = { name: string; direction: Direction; width?: string };
export type Instance = { module: string; name: string; connections: Record<string, string> };
export type VerilogModule = { name: string; file: string; ports: Port[]; instances: Instance[] };

const NOT_A_MODULE = new Set([
  "module", "endmodule", "if", "else", "for", "while", "case", "casez", "casex", "endcase", "assign", "always", "initial", "begin", "end",
  "wire", "reg", "logic", "input", "output", "inout", "parameter", "localparam", "integer", "genvar", "generate", "endgenerate", "function",
  "endfunction", "task", "endtask", "posedge", "negedge", "or", "and", "not", "return", "default",
]);

function clean(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/^\s*`[^\n]*$/gm, " ");
}

// The text inside the parenthesis at `open`, and the index just after its closing one.
function balanced(text: string, open: number): { inner: string; end: number } | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  return undefined;
}

function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const DECLARATION = /^(?:(input|output|inout)\b)?\s*(?:(?:wire|reg|logic|signed|unsigned|tri)\s+)*(\[[^\]]*\])?\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?$/;

function parsePorts(header: string, body: string): Port[] {
  const ports: Port[] = [];
  let direction: Direction | undefined;
  let width: string | undefined;
  const bare: string[] = [];
  for (const item of splitTop(header)) {
    const match = DECLARATION.exec(item.trim());
    if (!match) continue;
    if (match[1]) {
      direction = match[1] as Direction;
      width = match[2];
    } else if (match[2]) width = match[2];
    if (direction) ports.push({ name: match[3], direction, ...(width ? { width } : {}) });
    else bare.push(match[3]);
  }
  // module m(a, b); input a; output b;
  for (const name of bare) {
    const declared = new RegExp(`\\b(input|output|inout)\\b([^;]*\\b${name}\\b[^;]*);`).exec(body);
    if (declared) ports.push({ name, direction: declared[1] as Direction, ...(/\[[^\]]*\]/.exec(declared[2]) ? { width: /\[[^\]]*\]/.exec(declared[2])![0] } : {}) });
  }
  return ports;
}

function parseConnections(inner: string): Record<string, string> {
  const connections: Record<string, string> = {};
  for (const item of splitTop(inner)) {
    const match = /^\s*\.\s*([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*$/.exec(item);
    if (match) connections[match[1]] = match[2].trim();
  }
  return connections;
}

function parseInstances(body: string): Instance[] {
  const instances: Instance[] = [];
  const start = /\b([A-Za-z_]\w*)(\s*#\s*\(|\s+[A-Za-z_]\w*\s*(?:\[[^\]]*\]\s*)?\()/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(body))) {
    const module = match[1];
    if (NOT_A_MODULE.has(module)) {
      start.lastIndex = match.index + module.length;
      continue;
    }
    let cursor = match.index + match[0].length - 1;
    let label = match[2].trim();
    if (label.startsWith("#")) {
      const parameters = balanced(body, cursor);
      if (!parameters) continue;
      const named = /^\s*([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?\(/.exec(body.slice(parameters.end));
      if (!named) continue;
      label = named[1];
      cursor = parameters.end + named[0].length - 1;
    }
    const name = /^[A-Za-z_]\w*/.exec(label)?.[0];
    const ports = balanced(body, cursor);
    if (!name || !ports || NOT_A_MODULE.has(name)) continue;
    if (/^\s*;/.test(body.slice(ports.end))) instances.push({ module, name, connections: parseConnections(ports.inner) });
    start.lastIndex = ports.end;
  }
  return instances;
}

export function parseVerilog(source: string, file = ""): VerilogModule[] {
  const text = clean(source);
  const modules: VerilogModule[] = [];
  const opening = /\bmodule\s+([A-Za-z_]\w*)/g;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(text))) {
    let cursor = match.index + match[0].length;
    const skip = () => {
      while (/\s/.test(text[cursor] ?? "")) cursor++;
    };
    skip();
    if (text[cursor] === "#") {
      cursor++;
      skip();
      const parameters = balanced(text, cursor);
      if (!parameters) continue;
      cursor = parameters.end;
      skip();
    }
    let header = "";
    if (text[cursor] === "(") {
      const ports = balanced(text, cursor);
      if (!ports) continue;
      header = ports.inner;
      cursor = ports.end;
    }
    const close = text.indexOf("endmodule", cursor);
    const body = text.slice(cursor, close < 0 ? undefined : close).replace(/^\s*;/, "");
    modules.push({ name: match[1], file, ports: parsePorts(header, body), instances: parseInstances(body) });
    opening.lastIndex = close < 0 ? text.length : close;
  }
  return modules;
}

// The module to show first: nothing instantiates it. One named as a top wins, then whichever has the most inside.
export function topModule(modules: VerilogModule[]): VerilogModule | undefined {
  const used = new Set(modules.flatMap((module) => module.instances.map((instance) => instance.module)));
  const size = (module: VerilogModule) => module.instances.length;
  const candidates = modules.filter((module) => !used.has(module.name) && !/^tb_|_tb$/i.test(module.name));
  const named = (module: VerilogModule) => (/(^|_)top$/i.test(module.name) && module.instances.length ? 1 : 0);
  return [...(candidates.length ? candidates : modules)].sort((a, b) => named(b) - named(a) || size(b) - size(a))[0];
}

// They reach almost every block, so showing them hides the wiring that says what the design does.
const CLOCK_OR_RESET = /^(clk|clock|rst|reset|arst|srst)(_?n|_i|_ni)?$/i;

export type DiagramNode = { id: string; label: string; kind: "input" | "output" | "instance"; module?: string; known?: boolean; layer: number; width?: string };
export type DiagramEdge = { from: string; to: string; nets: string[] };

// One module's insides: its ports and instances as nodes, and a wire wherever a net joins an output to an input.
export function moduleDiagram(module: VerilogModule, modules: VerilogModule[], { showClocks = true } = {}): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const byName = new Map(modules.map((item) => [item.name, item]));
  const drivers = new Map<string, string[]>();
  const sinks = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, net: string, id: string) => map.set(net, [...(map.get(net) ?? []), id]);
  const hidden = (net: string) => !showClocks && CLOCK_OR_RESET.test(net);
  const nets = (expression: string) => (expression.match(/\b[A-Za-z_]\w*\b/g) ?? []).filter((word) => !/^\d/.test(word) && !hidden(word));

  const nodes: DiagramNode[] = [];
  for (const port of module.ports) {
    if (hidden(port.name)) continue;
    const id = `port:${port.name}`;
    if (port.direction === "output") {
      nodes.push({ id, label: port.name, kind: "output", layer: 0, width: port.width });
      add(sinks, port.name, id);
    } else {
      nodes.push({ id, label: port.name, kind: "input", layer: 0, width: port.width });
      add(drivers, port.name, id);
    }
  }
  for (const instance of module.instances) {
    const id = `inst:${instance.name}`;
    const definition = byName.get(instance.module);
    nodes.push({ id, label: instance.name, kind: "instance", module: instance.module, known: Boolean(definition), layer: 0 });
    for (const [portName, expression] of Object.entries(instance.connections)) {
      const direction = definition?.ports.find((port) => port.name === portName)?.direction ?? "input";
      for (const net of nets(expression)) add(direction === "output" ? drivers : sinks, net, id);
    }
  }

  const wires = new Map<string, DiagramEdge>();
  for (const [net, from] of drivers) {
    for (const source of from) {
      for (const target of sinks.get(net) ?? []) {
        if (source === target) continue;
        const key = `${source}>${target}`;
        const edge = wires.get(key) ?? { from: source, to: target, nets: [] };
        if (!edge.nets.includes(net)) edge.nets.push(net);
        wires.set(key, edge);
      }
    }
  }
  // A module with nothing inside is its own logic: one block between its inputs and outputs, not loose ports.
  if (!module.instances.length && nodes.length) {
    const id = `self:${module.name}`;
    nodes.push({ id, label: "logic", kind: "instance", module: module.name, known: false, layer: 1 });
    for (const node of nodes) {
      if (node.kind === "input") wires.set(`${node.id}>${id}`, { from: node.id, to: id, nets: [node.label] });
      if (node.kind === "output") wires.set(`${id}>${node.id}`, { from: id, to: node.id, nets: [node.label] });
    }
  }
  const edges = [...wires.values()];

  // Left to right by longest path from the inputs, ignoring wires that loop back.
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const layers = new Map<string, number>();
  const visit = (id: string, layer: number, path: Set<string>) => {
    if (path.has(id) || (layers.get(id) ?? -1) >= layer) return;
    layers.set(id, layer);
    const next = new Set(path).add(id);
    for (const target of outgoing.get(id) ?? []) visit(target, layer + 1, next);
  };
  for (const node of nodes) if (node.kind === "input") visit(node.id, 0, new Set());
  for (const node of nodes) if (!layers.has(node.id)) visit(node.id, node.kind === "instance" ? 1 : 0, new Set());
  const last = Math.max(1, ...nodes.filter((node) => node.kind === "instance").map((node) => layers.get(node.id) ?? 1)) + 1;
  for (const node of nodes) node.layer = node.kind === "input" ? 0 : node.kind === "output" ? last : Math.max(1, layers.get(node.id) ?? 1);
  return { nodes, edges };
}
