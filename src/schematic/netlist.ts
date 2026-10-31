// SPICE netlist parser for the schematic view. Reads what the engine simulates (design/*.cir, tests/*.cir),
// so the drawing is always the real circuit. Read-only: the view never writes netlists.

export type DeviceKind = "nmos" | "pmos" | "cap" | "res" | "ind" | "vsrc" | "isrc" | "diode" | "subckt" | "other";

export type Pin = { name: string; net: string };

export type Device = {
  name: string;
  kind: DeviceKind;
  pins: Pin[];
  model?: string; // MOS/diode model or subckt name
  value?: string; // R/C/L value, source spec
  params: Record<string, string>;
  line: number; // 1-based line in the file
  text: string; // the logical line, continuations joined
};

export type Circuit = { name: string; ports: string[]; devices: Device[]; line: number };

export type Netlist = {
  params: Record<string, { value: string; line: number }>;
  models: Record<string, { type: string; line: number }>;
  subckts: Circuit[];
  top: Circuit;
};

// Logical lines: comments dropped, "+" continuations joined, .control blocks skipped.
function logicalLines(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let inControl = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/;.*$/, "").replace(/\s\$\s.*$/, "").trim();
    if (!line || line.startsWith("*")) return;
    const lower = line.toLowerCase();
    if (lower.startsWith(".control")) inControl = true;
    if (inControl) {
      if (lower.startsWith(".endc")) inControl = false;
      return;
    }
    if (line.startsWith("+") && out.length) out[out.length - 1].text += " " + line.slice(1).trim();
    else out.push({ text: line, line: index + 1 });
  });
  return out;
}

// Whitespace split that keeps {expressions} and 'quoted' values whole, with "a = b" normalised to "a=b".
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  const flat = line.replace(/\s*=\s*/g, "=");
  for (const char of flat) {
    if (char === "'") quoted = !quoted;
    if (!quoted && char === "{") depth += 1;
    if (!quoted && char === "}") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0 && !quoted) {
      if (current) tokens.push(current);
      current = "";
    } else current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function splitParams(tokens: string[]) {
  const positional: string[] = [];
  const params: Record<string, string> = {};
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq > 0 && !token.startsWith("{")) params[token.slice(0, eq).toLowerCase()] = token.slice(eq + 1);
    else if (token.toLowerCase() !== "params:") positional.push(token);
  }
  return { positional, params };
}

const net = (name: string) => name.toLowerCase();

function mosKind(model: string, models: Netlist["models"]): DeviceKind {
  const type = models[model.toLowerCase()]?.type;
  if (type === "pmos" || type === "nmos") return type;
  // PDK models defined elsewhere (sky130_fd_pr__pfet_01v8, pch, ...): go by name.
  return /pfet|pmos|pch|^p/i.test(model) ? "pmos" : "nmos";
}

// `library`: subckts defined in other project files, so an instance there still gets named pins.
export function parseNetlist(text: string, library: Circuit[] = []): Netlist {
  const lines = logicalLines(text);
  const netlist: Netlist = { params: {}, models: {}, subckts: [], top: { name: "(top level)", ports: [], devices: [], line: 1 } };

  // Models first, so a MOS line above its .model still gets the right polarity.
  for (const { text: line, line: number } of lines) {
    const tokens = tokenize(line);
    if (tokens[0]?.toLowerCase() === ".model" && tokens.length >= 3) {
      netlist.models[tokens[1].toLowerCase()] = { type: tokens[2].replace(/\(.*$/, "").toLowerCase(), line: number };
    }
  }

  let circuit = netlist.top;
  for (const { text: line, line: number } of lines) {
    const tokens = tokenize(line);
    const head = tokens[0].toLowerCase();
    if (head === ".param") {
      for (const [key, value] of Object.entries(splitParams(tokens.slice(1)).params)) netlist.params[key] = { value, line: number };
      continue;
    }
    if (head === ".subckt") {
      const { positional } = splitParams(tokens.slice(2));
      circuit = { name: tokens[1], ports: positional.map(net), devices: [], line: number };
      netlist.subckts.push(circuit);
      continue;
    }
    if (head === ".ends") {
      circuit = netlist.top;
      continue;
    }
    if (head.startsWith(".")) continue;

    const name = tokens[0];
    const { positional, params } = splitParams(tokens.slice(1));
    const device = (kind: DeviceKind, pins: Pin[], extra: Partial<Device> = {}): Device => ({
      name, kind, pins, params, line: number, text: line, ...extra,
    });
    switch (head[0]) {
      case "m": {
        const [d, g, s, b, model = ""] = positional;
        if (!b) break;
        circuit.devices.push(device(mosKind(model, netlist.models), [
          { name: "d", net: net(d) }, { name: "g", net: net(g) }, { name: "s", net: net(s) }, { name: "b", net: net(b) },
        ], { model }));
        break;
      }
      case "c":
      case "r":
      case "l": {
        const [a, b, ...rest] = positional;
        if (!b) break;
        const kind = head[0] === "c" ? "cap" : head[0] === "r" ? "res" : "ind";
        circuit.devices.push(device(kind, [{ name: "p", net: net(a) }, { name: "n", net: net(b) }], { value: rest.join(" ") }));
        break;
      }
      case "v":
      case "i": {
        const [a, b, ...rest] = positional;
        if (!b) break;
        circuit.devices.push(device(head[0] === "v" ? "vsrc" : "isrc", [{ name: "+", net: net(a) }, { name: "-", net: net(b) }], { value: rest.join(" ") }));
        break;
      }
      case "d": {
        const [a, k, model] = positional;
        if (!k) break;
        circuit.devices.push(device("diode", [{ name: "a", net: net(a) }, { name: "k", net: net(k) }], { model }));
        break;
      }
      case "x": {
        if (positional.length < 2) break;
        const model = positional[positional.length - 1];
        const nodes = positional.slice(0, -1);
        circuit.devices.push(device("subckt", nodes.map((node, index) => ({ name: String(index + 1), net: net(node) })), { model }));
        break;
      }
      default:
        if (positional.length >= 2) {
          circuit.devices.push(device("other", positional.slice(0, 2).map((node, index) => ({ name: String(index + 1), net: net(node) }))));
        }
    }
  }

  // Subckt instances take their pin names from the definition when this file has it.
  const byName = new Map([...library, ...netlist.subckts].map((sub) => [sub.name.toLowerCase(), sub]));
  for (const circuit of [netlist.top, ...netlist.subckts]) {
    for (const device of circuit.devices) {
      const definition = device.kind === "subckt" ? byName.get((device.model ?? "").toLowerCase()) : undefined;
      if (definition) device.pins = device.pins.map((pin, index) => ({ ...pin, name: definition.ports[index] ?? pin.name }));
    }
  }
  return netlist;
}

// ---- values: evaluate {expressions} with .param values, print with engineering prefixes ----

const SUFFIX: [RegExp, number][] = [
  [/^meg/i, 1e6], [/^mil/i, 25.4e-6], [/^t/i, 1e12], [/^g/i, 1e9], [/^k/i, 1e3], [/^m/i, 1e-3],
  [/^u/i, 1e-6], [/^µ/, 1e-6], [/^n/i, 1e-9], [/^p/i, 1e-12], [/^f/i, 1e-15],
];

export function spiceNumber(text: string): number | undefined {
  const match = text.trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-zµ]*)$/i);
  if (!match) return undefined;
  const scale = SUFFIX.find(([pattern]) => pattern.test(match[2]))?.[1] ?? 1;
  return Number(match[1]) * scale;
}

// Arithmetic on numbers and .param names; undefined for anything else (functions, unknown names).
export function evaluate(expression: string, params: Netlist["params"], depth = 0): number | undefined {
  const source = expression.trim().replace(/^\{(.*)\}$/s, "$1").replace(/^'(.*)'$/s, "$1");
  const direct = spiceNumber(source);
  if (direct !== undefined || depth > 8) return direct;
  const tokens = source.match(/(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?[a-zµ]*|[a-z_][\w.]*|[-+*/()]/gi);
  if (!tokens || tokens.join("") !== source.replace(/\s+/g, "")) return undefined;
  let index = 0;
  const peek = () => tokens[index];
  const atom = (): number | undefined => {
    const token = tokens[index++];
    if (token === undefined) return undefined;
    if (token === "(") {
      const inner = sum();
      return tokens[index++] === ")" ? inner : undefined;
    }
    if (token === "-") {
      const value = atom();
      return value === undefined ? undefined : -value;
    }
    if (token === "+") return atom();
    const number = spiceNumber(token);
    if (number !== undefined) return number;
    const param = params[token.toLowerCase()];
    return param ? evaluate(param.value, params, depth + 1) : undefined;
  };
  const product = (): number | undefined => {
    let value = atom();
    while (value !== undefined && (peek() === "*" || peek() === "/")) {
      const op = tokens[index++];
      const right = atom();
      value = right === undefined ? undefined : op === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number | undefined => {
    let value = product();
    while (value !== undefined && (peek() === "+" || peek() === "-")) {
      const op = tokens[index++];
      const right = product();
      value = right === undefined ? undefined : op === "+" ? value + right : value - right;
    }
    return value;
  };
  const result = sum();
  return index === tokens.length ? result : undefined;
}

const PREFIXES: [number, string][] = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"]];

export function formatEng(value: number, unit = ""): string {
  if (value === 0) return `0${unit}`;
  // Plain numbers (a .param like L2=0.5) stay plain unless they are very large or small.
  if (!unit && Math.abs(value) >= 1e-3 && Math.abs(value) < 1e4) return String(Number(value.toPrecision(4)));
  // Below one, prefer 0.5µ over 500n, as sizes are usually written.
  const fits = ([scale]: [number, string]) => Math.abs(value) >= (scale < 1 ? scale * 0.1 : scale) * 0.9995;
  const [scale, prefix] = PREFIXES.find(fits) ?? PREFIXES[PREFIXES.length - 1];
  const scaled = value / scale;
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${Number(scaled.toFixed(digits))}${prefix}${unit}`;
}

// "4u" -> "4µ", "{L2*1e-6}" with L2=0.5 -> "0.5µ"; unevaluable expressions come back as written.
export function showValue(raw: string, params: Netlist["params"], unit = ""): string {
  const value = evaluate(raw, params);
  return value === undefined ? raw : formatEng(value, unit);
}
