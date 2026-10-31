import assert from "node:assert/strict";
import { test } from "node:test";
import { flatten, parseGds } from "../src/layout/gds.ts";

// A tiny GDSII writer, enough to build fixtures: records are [type, datatype, payload].
function real8(value: number): number[] {
  if (value === 0) return [0, 0, 0, 0, 0, 0, 0, 0];
  const sign = value < 0 ? 0x80 : 0;
  let v = Math.abs(value);
  let exponent = 64;
  while (v >= 1) {
    v /= 16;
    exponent += 1;
  }
  while (v < 1 / 16) {
    v *= 16;
    exponent -= 1;
  }
  const bytes = [sign | exponent];
  let mantissa = v;
  for (let i = 0; i < 7; i++) {
    mantissa *= 256;
    const byte = Math.floor(mantissa);
    bytes.push(byte);
    mantissa -= byte;
  }
  return bytes;
}

function record(type: number, datatype: number, payload: number[] = []): number[] {
  const length = 4 + payload.length;
  return [length >> 8, length & 0xff, type, datatype, ...payload];
}
const i16 = (...values: number[]) => values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]);
const i32 = (...values: number[]) => values.flatMap((v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
const text = (s: string) => {
  const bytes = [...s].map((c) => c.charCodeAt(0));
  return bytes.length % 2 ? [...bytes, 0] : bytes;
};
const xy = (...points: [number, number][]) => record(0x10, 3, i32(...points.flat()));

function library(): ArrayBuffer {
  const bytes = [
    ...record(0x00, 2, i16(600)),
    ...record(0x01, 2, i16(...new Array(12).fill(0))),
    ...record(0x02, 6, text("TESTLIB")),
    ...record(0x03, 5, [...real8(0.001), ...real8(1e-9)]),
    // unit: a 10 x 5 rectangle on 1/0 and a path on 2/0
    ...record(0x05, 2, i16(...new Array(12).fill(0))),
    ...record(0x06, 6, text("unit")),
    ...record(0x08, 0),
    ...record(0x0d, 2, i16(1)),
    ...record(0x0e, 2, i16(0)),
    ...xy([0, 0], [10, 0], [10, 5], [0, 5], [0, 0]),
    ...record(0x11, 0),
    ...record(0x09, 0),
    ...record(0x0d, 2, i16(2)),
    ...record(0x0e, 2, i16(0)),
    ...record(0x0f, 3, i32(2)),
    ...xy([0, 0], [0, 20]),
    ...record(0x11, 0),
    ...record(0x07, 0),
    // top: the unit rotated 90 degrees at (100, 0), a 3 x 2 array of it, and a label
    ...record(0x05, 2, i16(...new Array(12).fill(0))),
    ...record(0x06, 6, text("top")),
    ...record(0x0a, 0),
    ...record(0x12, 6, text("unit")),
    ...record(0x1a, 1, i16(0)),
    ...record(0x1c, 5, real8(90)),
    ...xy([100, 0]),
    ...record(0x11, 0),
    ...record(0x0b, 0),
    ...record(0x12, 6, text("unit")),
    ...record(0x13, 2, i16(3, 2)),
    ...xy([0, 0], [60, 0], [0, 40]),
    ...record(0x11, 0),
    ...record(0x0c, 0),
    ...record(0x0d, 2, i16(10)),
    ...record(0x16, 2, i16(0)),
    ...xy([5, 5]),
    ...record(0x19, 6, text("out")),
    ...record(0x11, 0),
    ...record(0x07, 0),
    ...record(0x04, 0),
  ];
  return new Uint8Array(bytes).buffer;
}

test("reads cells, units and the top cell", () => {
  const lib = parseGds(library());
  assert.equal(lib.name, "TESTLIB");
  assert.ok(Math.abs(lib.dbuInMeters - 1e-9) < 1e-15);
  assert.deepEqual([...lib.cells.keys()].sort(), ["top", "unit"]);
  assert.deepEqual(lib.tops, ["top"]);
  assert.equal(lib.cells.get("unit")!.polygons[0].points.length, 4);
});

test("flattens references, rotation and arrays", () => {
  const flat = flatten(parseGds(library()), "top");
  // 1 rotated instance + 6 array instances, each with a rectangle and a path.
  assert.equal(flat.instances, 7);
  assert.deepEqual(flat.layers, [
    { id: "1/0", count: 7 },
    { id: "2/0", count: 7 },
  ]);
  // Rotated 90 degrees about the origin, then moved to (100, 0): (10, 5) lands at (95, 10).
  const rotated = flat.shapes.find((shape) => shape.layer === "1/0")!;
  assert.deepEqual(rotated.points.map(([x, y]) => [Math.round(x), Math.round(y)]), [[100, 0], [100, 10], [95, 10], [95, 0]]);
  // The array's last copy sits at column 2 (x 40) and row 1 (y 20).
  const corners = flat.shapes.filter((shape) => shape.layer === "1/0").map((shape) => shape.points[0]);
  assert.ok(corners.some(([x, y]) => x === 40 && y === 20));
  assert.deepEqual(flat.labels.map((label) => label.text), ["out"]);
  assert.equal(flat.bounds[2], 101); // the rotated path's half-width past x = 100
});

test("stops at the shape limit and says so", () => {
  const flat = flatten(parseGds(library()), "top", 5);
  assert.equal(flat.shapes.length, 5);
  assert.equal(flat.truncated, true);
});
