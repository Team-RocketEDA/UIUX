// Automatic schematic layout for a parsed circuit. Analog convention: PMOS on top, NMOS stacked below
// by how far their source is from ground, passives in between; columns follow connectivity so stacked
// devices line up. Wires run in channels between rows; supplies and ground are drawn as local symbols.
import type { Circuit, Device } from "./netlist.ts";

export type Side = "top" | "bottom" | "left" | "right";
export type PlacedPin = { name: string; net: string; x: number; y: number; side: Side; hidden?: boolean };
export type Placed = { device: Device; x: number; y: number; row: number; width: number; height: number; pins: PlacedPin[] };
export type Segment = { net: string; x1: number; y1: number; x2: number; y2: number };
export type RailSymbol = { net: string; kind: "supply" | "ground"; x: number; y: number; side: Side };
export type NetLabel = { net: string; x: number; y: number; port: boolean; anchor: "start" | "end" };
export type Layout = {
  width: number;
  height: number;
  devices: Placed[];
  segments: Segment[];
  junctions: { net: string; x: number; y: number }[];
  rails: RailSymbol[];
  labels: NetLabel[];
};

const GROUND = /^(0|gnd|vss|vgnd|agnd|avss|dvss|vssa|vssd|sub)$/i;
const SUPPLY = /^(vdd|vcc|vpwr|avdd|dvdd|vdda|vddd|vccd|vdd\w*)$/i;
const ROW_H = 64; // device band
const TRACK = 14;
const STUB = 16; // side-pin lead length
const MARGIN = 48;

export function railKinds(circuit: Circuit): Map<string, "supply" | "ground"> {
  const rails = new Map<string, "supply" | "ground">();
  for (const device of circuit.devices) {
    for (const pin of device.pins) {
      if (GROUND.test(pin.net)) rails.set(pin.net, "ground");
      else if (SUPPLY.test(pin.net)) rails.set(pin.net, "supply");
    }
  }
  // Unconventional names: a PMOS bulk is the supply, an NMOS bulk is ground.
  for (const device of circuit.devices) {
    const bulk = device.pins.find((pin) => pin.name === "b")?.net;
    if (bulk && !rails.has(bulk)) {
      if (device.kind === "pmos") rails.set(bulk, "supply");
      if (device.kind === "nmos") rails.set(bulk, "ground");
    }
  }
  return rails;
}

type GeoPin = { name: string; net: string; side: Side; dx: number; dy: number; hidden?: boolean };
type Geometry = { width: number; height: number; pins: GeoPin[] };
// A pin's wire: from the pin (plus a short lead for side pins) to a track in one channel.
type Drop = { device: Device; net: string; side: Side; row: number; channel: number; dx: number; dy: number; lead: number };

const pinNet = (device: Device, name: string) => device.pins.find((pin) => pin.name === name)?.net ?? "";
const isMos = (device: Device) => device.kind === "nmos" || device.kind === "pmos";

// How many devices sit between this one and its rail: 0 = source on the rail.
function stackLevels(devices: Device[], kind: "nmos" | "pmos", rail: (net: string) => boolean) {
  const level = new Map<Device, number>();
  const group = devices.filter((device) => device.kind === kind);
  for (const device of group) if (rail(pinNet(device, "s"))) level.set(device, 0);
  for (let pass = 0; pass < group.length; pass += 1) {
    for (const device of group) {
      if (level.has(device)) continue;
      const below = group.find((other) => level.has(other) && pinNet(other, "d") === pinNet(device, "s"));
      if (below) level.set(device, level.get(below)! + 1);
    }
  }
  for (const device of group) if (!level.has(device)) level.set(device, 0);
  return level;
}

function geometry(device: Device, rails: Map<string, "supply" | "ground">): Geometry {
  if (isMos(device)) {
    const top = device.kind === "nmos" ? "d" : "s";
    const bottom = device.kind === "nmos" ? "s" : "d";
    const bulk = pinNet(device, "b");
    // A bulk tied to its source or to the matching rail is implied, as in hand-drawn schematics.
    const bulkImplied = bulk === pinNet(device, "s") || rails.get(bulk) === (device.kind === "pmos" ? "supply" : "ground");
    return {
      width: 56,
      height: ROW_H,
      pins: [
        { name: top, net: pinNet(device, top), side: "top", dx: 12, dy: -30 },
        { name: bottom, net: pinNet(device, bottom), side: "bottom", dx: 12, dy: 30 },
        { name: "g", net: pinNet(device, "g"), side: "left", dx: -28, dy: 0 },
        { name: "b", net: bulk, side: "right", dx: 28, dy: 0, hidden: bulkImplied },
      ],
    };
  }
  if (device.kind === "subckt" || device.kind === "other") {
    const top = device.pins.filter((pin) => rails.get(pin.net) === "supply");
    const bottom = device.pins.filter((pin) => rails.get(pin.net) === "ground");
    const rest = device.pins.filter((pin) => !rails.has(pin.net));
    const right = rest.filter((pin) => /out|^o$|^y$|^q$/i.test(pin.name));
    const left = rest.filter((pin) => !right.includes(pin));
    const rows = Math.max(left.length, right.length, 1);
    const height = Math.max(ROW_H, rows * 20 + 16);
    const width = 96;
    const column = (pins: typeof rest, side: Side, dx: number): GeoPin[] =>
      pins.map((pin, index) => ({ ...pin, side, dx, dy: -height / 2 + (height / (pins.length + 1)) * (index + 1) }));
    const edge = (pins: typeof rest, side: Side, dy: number): GeoPin[] =>
      pins.map((pin, index) => ({ ...pin, side, dy, dx: -width / 2 + (width / (pins.length + 1)) * (index + 1) }));
    return {
      width,
      height,
      pins: [...column(left, "left", -width / 2), ...column(right, "right", width / 2), ...edge(top, "top", -height / 2), ...edge(bottom, "bottom", height / 2)],
    };
  }
  // Two-terminal parts stand upright: the ground side down, the supply side up.
  const [a, b] = device.pins;
  const flip = rails.get(a.net) === "ground" || rails.get(b.net) === "supply";
  const [up, down] = flip ? [b, a] : [a, b];
  return {
    width: 44,
    height: ROW_H,
    pins: [
      { ...up, side: "top", dx: 0, dy: -30 },
      { ...down, side: "bottom", dx: 0, dy: 30 },
    ],
  };
}

export function layoutCircuit(circuit: Circuit): Layout {
  const rails = railKinds(circuit);
  const isRail = (net: string) => rails.has(net);
  const devices = circuit.devices;

  // ---- rows ----
  const nLevel = stackLevels(devices, "nmos", (net) => rails.get(net) === "ground");
  const pLevel = stackLevels(devices, "pmos", (net) => rails.get(net) === "supply");
  const maxP = Math.max(-1, ...pLevel.values());
  const maxN = Math.max(-1, ...nLevel.values());
  const rowKey = new Map<Device, number>();
  for (const device of devices) {
    if (device.kind === "pmos") rowKey.set(device, pLevel.get(device)!);
    else if (device.kind === "nmos") rowKey.set(device, maxP + 2 + (maxN - nLevel.get(device)!));
    else {
      const nets = device.pins.map((pin) => rails.get(pin.net));
      if (nets.includes("ground")) rowKey.set(device, maxP + 2 + maxN + (maxN >= 0 ? 0 : 1));
      else if (nets.includes("supply") && maxP >= 0) rowKey.set(device, 0);
      else rowKey.set(device, maxP + 1);
    }
  }
  const keys = [...new Set(rowKey.values())].sort((a, b) => a - b);
  const rowOf = new Map(devices.map((device) => [device, keys.indexOf(rowKey.get(device)!)]));
  const rowCount = keys.length;
  const geo = new Map(devices.map((device) => [device, geometry(device, rails)]));

  // ---- columns: barycentric ordering, so stacked and connected devices line up ----
  const neighbours = new Map<Device, { device: Device; weight: number }[]>(devices.map((device) => [device, []]));
  const series = (device: Device, pin: string) => !isMos(device) || pin === "d" || pin === "s";
  for (const a of devices) {
    for (const b of devices) {
      if (a === b) continue;
      for (const pa of a.pins) {
        if (isRail(pa.net) || pa.name === "b") continue;
        for (const pb of b.pins) {
          if (pb.net !== pa.net || pb.name === "b") continue;
          neighbours.get(a)!.push({ device: b, weight: series(a, pa.name) && series(b, pb.name) ? 3 : 1 });
        }
      }
    }
  }
  const x = new Map<Device, number>();
  const rows: Device[][] = Array.from({ length: rowCount }, () => []);
  for (const device of devices) rows[rowOf.get(device)!].push(device);
  const gap = (a: Device, b: Device) => (geo.get(a)!.width + geo.get(b)!.width) / 2 + 64;
  for (const row of rows) {
    let cursor = 0;
    row.forEach((device, index) => {
      if (index) cursor += gap(row[index - 1], device);
      x.set(device, cursor);
    });
  }
  for (let pass = 0; pass < 24; pass += 1) {
    const target = new Map<Device, number>();
    for (const device of devices) {
      const links = neighbours.get(device)!;
      if (!links.length) {
        // Only rails (a supply source, say): join the row's cluster instead of anchoring far away.
        const others = rows[rowOf.get(device)!].filter((other) => other !== device);
        target.set(device, others.length ? others.reduce((total, other) => total + x.get(other)!, 0) / others.length : x.get(device)!);
        continue;
      }
      let sum = x.get(device)!;
      let weight = 1;
      for (const link of links) {
        sum += x.get(link.device)! * link.weight;
        weight += link.weight;
      }
      target.set(device, sum / weight);
    }
    for (const row of rows) {
      row.sort((a, b) => target.get(a)! - target.get(b)! || a.line - b.line);
      // Closest spacing-respecting positions without drift: average a left-to-right and a right-to-left pass.
      const forward = row.map((device) => target.get(device)!);
      for (let i = 1; i < row.length; i += 1) forward[i] = Math.max(forward[i], forward[i - 1] + gap(row[i - 1], row[i]));
      const backward = row.map((device) => target.get(device)!);
      for (let i = row.length - 2; i >= 0; i -= 1) backward[i] = Math.min(backward[i], backward[i + 1] - gap(row[i], row[i + 1]));
      row.forEach((device, i) => x.set(device, (forward[i] + backward[i]) / 2));
    }
  }
  const minX = Math.min(...devices.map((device) => x.get(device)! - geo.get(device)!.width / 2));
  for (const device of devices) x.set(device, Math.round((x.get(device)! - minX + MARGIN + 60) / 4) * 4);

  // ---- which channel each pin's wire uses (channel k is above row k, k+1 below it) ----
  const visible = devices.flatMap((device) => geo.get(device)!.pins.filter((pin) => !pin.hidden).map((pin) => ({ device, pin })));
  const netRows = new Map<string, number[]>();
  for (const { device, pin } of visible) {
    const at = rowOf.get(device)! + (pin.side === "bottom" ? 1 : pin.side === "top" ? 0 : 0.5);
    netRows.set(pin.net, [...(netRows.get(pin.net) ?? []), at]);
  }
  const drops: Drop[] = visible.map(({ device, pin }) => {
    const row = rowOf.get(device)!;
    let channel = pin.side === "top" ? row : row + 1;
    if (pin.side === "left" || pin.side === "right") {
      // Side pins go to whichever neighbouring channel the rest of the net is closer to.
      const others = netRows.get(pin.net)!.filter((value) => value !== row + 0.5);
      const mean = others.length ? others.reduce((a, b) => a + b, 0) / others.length : row + 1;
      channel = mean < row + 0.5 ? row : row + 1;
    }
    const lead = pin.side === "left" ? -STUB : pin.side === "right" ? STUB : 0;
    return { device, net: pin.net, side: pin.side, row, channel, dx: pin.dx, dy: pin.dy, lead };
  });

  // ---- channel heights from track counts, then row y positions ----
  const tracksNeeded = new Array(rowCount + 1).fill(0);
  const routed = new Map<string, Drop[]>();
  for (const drop of drops) {
    if (isRail(drop.net)) continue;
    if (!routed.has(drop.net)) routed.set(drop.net, []);
    routed.get(drop.net)!.push(drop);
  }
  // Provisional x for track assignment (y is not needed for that).
  const dropX = (drop: Drop) => x.get(drop.device)! + drop.dx + drop.lead;
  type Track = { net: string; channel: number; x1: number; x2: number; index: number; xs: number[] };
  const tracks: Track[] = [];
  const spines: { net: string; x: number; from: number; to: number }[] = [];
  for (const [net, drops] of routed) {
    if (drops.length < 2) continue;
    const channels = [...new Set(drops.map((drop) => drop.channel))].sort((a, b) => a - b);
    let spineX: number | undefined;
    if (channels.length > 1) {
      // A vertical spine joins the channels; prefer an x that crosses no device in the rows between.
      const between = (c: number) => c >= channels[0] && c < channels[channels.length - 1];
      const candidates = drops.map(dropX);
      const blocked = (cx: number) =>
        devices.filter((device) => between(rowOf.get(device)!) && Math.abs(x.get(device)! - cx) < geo.get(device)!.width / 2 + 6).length;
      candidates.sort((a, b) => blocked(a) - blocked(b) || Math.abs(a - median(candidates)) - Math.abs(b - median(candidates)));
      spineX = candidates[0];
      spines.push({ net, x: spineX, from: channels[0], to: channels[channels.length - 1] });
    }
    for (const channel of channels) {
      const xs = drops.filter((drop) => drop.channel === channel).map(dropX);
      if (spineX !== undefined) xs.push(spineX);
      tracks.push({ net, channel, x1: Math.min(...xs), x2: Math.max(...xs), index: 0, xs });
    }
  }
  for (let channel = 0; channel <= rowCount; channel += 1) {
    const inChannel = tracks.filter((track) => track.channel === channel).sort((a, b) => a.x1 - b.x1);
    const ends: number[] = [];
    for (const track of inChannel) {
      let index = ends.findIndex((end) => end < track.x1 - 12);
      if (index === -1) {
        index = ends.length;
        ends.push(0);
      }
      ends[index] = track.x2;
      track.index = index;
    }
    tracksNeeded[channel] = ends.length;
  }
  const channelHeight = (channel: number) => Math.max(40, tracksNeeded[channel] * TRACK + 26);
  const rowY: number[] = [];
  const channelTop: number[] = [];
  let cursor = MARGIN / 2;
  for (let row = 0; row <= rowCount; row += 1) {
    channelTop[row] = cursor;
    cursor += channelHeight(row);
    if (row < rowCount) {
      const half = Math.max(ROW_H, ...rows[row].map((device) => geo.get(device)!.height)) / 2;
      rowY[row] = cursor + half;
      cursor += half * 2;
    }
  }
  const trackY = (channel: number, index: number) => {
    const count = tracksNeeded[channel];
    const middle = channelTop[channel] + channelHeight(channel) / 2;
    return Math.round(middle + (index - (count - 1) / 2) * TRACK);
  };

  // ---- final geometry ----
  const placed: Placed[] = devices.map((device) => {
    const g = geo.get(device)!;
    const cx = x.get(device)!;
    const cy = rowY[rowOf.get(device)!];
    return {
      device, x: cx, y: cy, row: rowOf.get(device)!, width: g.width, height: g.height,
      pins: g.pins.map((pin) => ({ name: pin.name, net: pin.net, side: pin.side, hidden: pin.hidden, x: cx + pin.dx, y: cy + pin.dy })),
    };
  });
  const segments: Segment[] = [];
  const junctions: { net: string; x: number; y: number }[] = [];
  const symbols: RailSymbol[] = [];
  const labels: NetLabel[] = [];
  const ports = new Set(circuit.ports);

  for (const drop of drops) {
    const px = x.get(drop.device)! + drop.dx;
    const py = rowY[drop.row] + drop.dy;
    const lx = dropX(drop);
    if (lx !== px) segments.push({ net: drop.net, x1: px, y1: py, x2: lx, y2: py });
    if (isRail(drop.net)) {
      symbols.push({ net: drop.net, kind: rails.get(drop.net)!, x: lx, y: py, side: drop.side });
      continue;
    }
    const track = tracks.find((t) => t.net === drop.net && t.channel === drop.channel);
    if (!track) {
      // A net with a single pin: label it at the lead.
      labels.push({ net: drop.net, x: lx + (drop.side === "right" ? 4 : -4), y: py - 4, port: ports.has(drop.net), anchor: drop.side === "right" ? "start" : "end" });
      continue;
    }
    const ty = trackY(track.channel, track.index);
    segments.push({ net: drop.net, x1: lx, y1: py, x2: lx, y2: ty });
  }
  for (const track of tracks) {
    const ty = trackY(track.channel, track.index);
    if (track.x2 > track.x1) segments.push({ net: track.net, x1: track.x1, y1: ty, x2: track.x2, y2: ty });
    for (const tx of track.xs) if (tx > track.x1 && tx < track.x2) junctions.push({ net: track.net, x: tx, y: ty });
  }
  for (const spine of spines) {
    const ends = tracks.filter((t) => t.net === spine.net && (t.channel === spine.from || t.channel === spine.to));
    const [y1, y2] = ends.map((t) => trackY(t.channel, t.index)).sort((a, b) => a - b);
    segments.push({ net: spine.net, x1: spine.x, y1, x2: spine.x, y2 });
    // In a middle channel the spine runs on past the track's end: that is a T, so it gets a dot.
    for (const track of tracks.filter((t) => t.net === spine.net && t.channel > spine.from && t.channel < spine.to)) {
      const ty = trackY(track.channel, track.index);
      if (spine.x === track.x1 || spine.x === track.x2) junctions.push({ net: spine.net, x: spine.x, y: ty });
    }
  }
  // One label per routed net, at the left end of its first track.
  for (const [net] of routed) {
    const track = tracks.filter((t) => t.net === net).sort((a, b) => a.channel - b.channel)[0];
    if (!track) continue;
    labels.push({ net, x: track.x1 - 6, y: trackY(track.channel, track.index) + 4, port: ports.has(net), anchor: "end" });
  }

  const xs = [...placed.flatMap((p) => [p.x - p.width / 2 - STUB, p.x + p.width / 2 + STUB]), ...segments.flatMap((s) => [s.x1, s.x2])];
  const width = Math.max(...xs, 200) + MARGIN;
  return { width, height: cursor + MARGIN / 2, devices: placed, segments, junctions, rails: symbols, labels };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
