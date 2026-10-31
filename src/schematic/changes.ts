// What a proposed netlist diff means for the circuit: parameter changes and the device sizes they move.
// Used by approval cards, so the reviewer sees "M6 L 0.5µm → 1µm", not only a text diff.
import { parseNetlist, showValue, type Device, type Netlist } from "./netlist.ts";

// Apply a unified diff to the current text. Undefined when a hunk doesn't match (the file moved on).
export function applyUnifiedDiff(original: string, diff: string): string | undefined {
  const lines = original.split("\n");
  const hunks: { start: number; before: string[]; after: string[] }[] = [];
  let hunk: (typeof hunks)[number] | undefined;
  for (const line of diff.split("\n")) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (header) {
      hunk = { start: Number(header[1]) - 1, before: [], after: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk || /^(---|\+\+\+|Index:|={5,}|\\ No newline)/.test(line)) continue;
    const body = line.slice(1);
    if (line.startsWith("-")) hunk.before.push(body);
    else if (line.startsWith("+")) hunk.after.push(body);
    else if (line.startsWith(" ") || line === "") {
      hunk.before.push(body);
      hunk.after.push(body);
    }
  }
  if (!hunks.length) return undefined;
  let offset = 0;
  for (const { start, before, after } of hunks) {
    // Trailing blank context can be an artefact of the diff's last newline.
    while (before.length && before[before.length - 1] === "" && after[after.length - 1] === "") {
      before.pop();
      after.pop();
    }
    const at = findBlock(lines, before, start + offset);
    if (at === -1) return undefined;
    lines.splice(at, before.length, ...after);
    offset += after.length - before.length;
  }
  return lines.join("\n");
}

function findBlock(lines: string[], block: string[], hint: number) {
  const matches = (at: number) => block.every((line, i) => lines[at + i] === line);
  for (let distance = 0; distance < lines.length; distance += 1) {
    for (const at of [hint - distance, hint + distance]) {
      if (at >= 0 && at + block.length <= lines.length && matches(at)) return at;
    }
  }
  return block.length === 0 ? Math.min(Math.max(hint, 0), lines.length) : -1;
}

export type CircuitChange =
  | { kind: "param"; name: string; before: string; after: string }
  | { kind: "device"; circuit: string; device: string; fields: { name: string; before: string; after: string }[] }
  | { kind: "added" | "removed"; circuit: string; device: string };

const UNITS: Record<string, string> = { w: "m", l: "m" };
const VALUE_UNIT: Partial<Record<Device["kind"], string>> = { cap: "F", res: "Ω", ind: "H" };

function sizes(device: Device, params: Netlist["params"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(device.params)) out[key.toUpperCase()] = showValue(raw, params, UNITS[key] ?? "");
  if (device.value) out.value = VALUE_UNIT[device.kind] ? showValue(device.value.split(/\s+/)[0], params, VALUE_UNIT[device.kind]) : device.value;
  if (device.model) out.model = device.model;
  device.pins.forEach((pin) => (out[`pin ${pin.name}`] = pin.net));
  return out;
}

// A pending approval's effect on one netlist, shared between the assistant panel and the schematic.
export type Proposal = { file: string; changes: CircuitChange[] };

export function describeChanges(beforeText: string, afterText: string): CircuitChange[] {
  const before = parseNetlist(beforeText);
  const after = parseNetlist(afterText);
  const changes: CircuitChange[] = [];
  for (const name of new Set([...Object.keys(before.params), ...Object.keys(after.params)])) {
    const a = before.params[name]?.value ?? "—";
    const b = after.params[name]?.value ?? "—";
    if (a !== b) changes.push({ kind: "param", name: name.toUpperCase(), before: showValue(a, before.params), after: showValue(b, after.params) });
  }
  const circuits = (netlist: Netlist) => new Map([netlist.top, ...netlist.subckts].map((c) => [c.name, c]));
  const oldCircuits = circuits(before);
  for (const [name, circuit] of circuits(after)) {
    const old = new Map((oldCircuits.get(name)?.devices ?? []).map((d) => [d.name, d]));
    const now = new Map(circuit.devices.map((d) => [d.name, d]));
    for (const [deviceName, device] of now) {
      const previous = old.get(deviceName);
      if (!previous) {
        changes.push({ kind: "added", circuit: name, device: deviceName });
        continue;
      }
      const a = sizes(previous, before.params);
      const b = sizes(device, after.params);
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((key) => a[key] !== b[key])
        .map((key) => ({ name: key, before: a[key] ?? "—", after: b[key] ?? "—" }));
      if (fields.length) changes.push({ kind: "device", circuit: name, device: deviceName, fields });
    }
    for (const deviceName of old.keys()) if (!now.has(deviceName)) changes.push({ kind: "removed", circuit: name, device: deviceName });
  }
  return changes;
}
