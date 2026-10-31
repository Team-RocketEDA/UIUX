// GDSII stream reader for the layout viewer: cells, polygons, paths, references and labels,
// flattened from a top cell into layer-sorted shapes in database units. Pure functions.

export type Point = [number, number];
type Transform = [number, number, number, number, number, number]; // x' = a x + c y + e, y' = b x + d y + f

type Ref = { cell: string; transform: Transform; cols: number; rows: number; colStep: Point; rowStep: Point };
export type Cell = {
  name: string;
  polygons: { layer: number; datatype: number; points: Point[] }[];
  paths: { layer: number; datatype: number; width: number; points: Point[] }[];
  labels: { layer: number; text: string; at: Point }[];
  refs: Ref[];
};

export type Library = {
  name: string;
  dbuInMeters: number; // size of one database unit in metres
  cells: Map<string, Cell>;
  tops: string[]; // cells nothing references, largest first
};

const IDENTITY: Transform = [1, 0, 0, 1, 0, 0];

// GDS 8-byte real: sign, base-16 exponent excess 64, 56-bit mantissa.
function real8(view: DataView, at: number): number {
  const first = view.getUint8(at);
  const sign = first & 0x80 ? -1 : 1;
  const exponent = (first & 0x7f) - 64;
  let mantissa = 0;
  for (let i = 1; i < 8; i++) mantissa = mantissa * 256 + view.getUint8(at + i);
  return sign * (mantissa / 2 ** 56) * 16 ** exponent;
}

function compose(outer: Transform, inner: Transform): Transform {
  const [a, b, c, d, e, f] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

const apply = ([a, b, c, d, e, f]: Transform, [x, y]: Point): Point => [a * x + c * y + e, b * x + d * y + f];

// Reference placement: reflect about x first, then magnify, rotate, translate (GDS order).
function placement(reflect: boolean, mag: number, angle: number, at: Point): Transform {
  const r = (angle * Math.PI) / 180;
  const cos = Math.round(Math.cos(r) * 1e12) / 1e12;
  const sin = Math.round(Math.sin(r) * 1e12) / 1e12;
  const sy = reflect ? -1 : 1;
  return [mag * cos, mag * sin, -mag * sin * sy, mag * cos * sy, at[0], at[1]];
}

export function parseGds(buffer: ArrayBuffer): Library {
  const view = new DataView(buffer);
  const cells = new Map<string, Cell>();
  let libName = "";
  let dbuInMeters = 1e-9;
  let cell: Cell | undefined;
  // The element being read.
  let kind = "";
  let layer = 0;
  let datatype = 0;
  let width = 0;
  let points: Point[] = [];
  let sname = "";
  let reflect = false;
  let mag = 1;
  let angle = 0;
  let cols = 1;
  let rows = 1;
  let text = "";

  const ascii = (at: number, length: number) => {
    let out = "";
    for (let i = 0; i < length; i++) {
      const code = view.getUint8(at + i);
      if (code) out += String.fromCharCode(code);
    }
    return out;
  };

  let at = 0;
  while (at + 4 <= view.byteLength) {
    const length = view.getUint16(at);
    const record = view.getUint8(at + 2);
    if (length < 4) break;
    const data = at + 4;
    const size = length - 4;
    switch (record) {
      case 0x02: // LIBNAME
        libName = ascii(data, size);
        break;
      case 0x03: // UNITS: user units per dbu, metres per dbu
        dbuInMeters = real8(view, data + 8);
        break;
      case 0x05: // BGNSTR
        cell = { name: "", polygons: [], paths: [], labels: [], refs: [] };
        break;
      case 0x06: // STRNAME
        if (cell) {
          cell.name = ascii(data, size);
          cells.set(cell.name, cell);
        }
        break;
      case 0x07: // ENDSTR
        cell = undefined;
        break;
      case 0x08: // BOUNDARY
      case 0x2d: // BOX
      case 0x09: // PATH
      case 0x0a: // SREF
      case 0x0b: // AREF
      case 0x0c: // TEXT
        kind = record === 0x2d ? "boundary" : { 0x08: "boundary", 0x09: "path", 0x0a: "sref", 0x0b: "aref", 0x0c: "text" }[record]!;
        layer = datatype = width = 0;
        points = [];
        sname = text = "";
        reflect = false;
        mag = 1;
        angle = 0;
        cols = rows = 1;
        break;
      case 0x0d: // LAYER
        layer = view.getInt16(data);
        break;
      case 0x0e: // DATATYPE
      case 0x16: // TEXTTYPE
      case 0x2e: // BOXTYPE
        datatype = view.getInt16(data);
        break;
      case 0x0f: // WIDTH
        width = Math.abs(view.getInt32(data));
        break;
      case 0x10: // XY
        for (let i = 0; i + 8 <= size; i += 8) points.push([view.getInt32(data + i), view.getInt32(data + i + 4)]);
        break;
      case 0x12: // SNAME
        sname = ascii(data, size);
        break;
      case 0x13: // COLROW
        cols = view.getInt16(data);
        rows = view.getInt16(data + 2);
        break;
      case 0x19: // STRING
        text = ascii(data, size);
        break;
      case 0x1a: // STRANS
        reflect = (view.getUint16(data) & 0x8000) !== 0;
        break;
      case 0x1b: // MAG
        mag = real8(view, data);
        break;
      case 0x1c: // ANGLE
        angle = real8(view, data);
        break;
      case 0x11: // ENDEL
        if (cell && points.length) {
          if (kind === "boundary") cell.polygons.push({ layer, datatype, points: points.slice(0, -1).length >= 3 ? points.slice(0, -1) : points });
          else if (kind === "path") cell.paths.push({ layer, datatype, width, points });
          else if (kind === "text") cell.labels.push({ layer, text, at: points[0] });
          else if (kind === "sref") cell.refs.push({ cell: sname, transform: placement(reflect, mag, angle, points[0]), cols: 1, rows: 1, colStep: [0, 0], rowStep: [0, 0] });
          else if (kind === "aref" && points.length >= 3) {
            const [origin, colEnd, rowEnd] = points;
            cell.refs.push({
              cell: sname,
              transform: placement(reflect, mag, angle, origin),
              cols,
              rows,
              colStep: [(colEnd[0] - origin[0]) / cols, (colEnd[1] - origin[1]) / cols],
              rowStep: [(rowEnd[0] - origin[0]) / rows, (rowEnd[1] - origin[1]) / rows],
            });
          }
        }
        kind = "";
        break;
      case 0x04: // ENDLIB
        at = view.byteLength;
        continue;
    }
    at += length;
  }

  const referenced = new Set([...cells.values()].flatMap((c) => c.refs.map((r) => r.cell)));
  const weight = (name: string) => {
    const c = cells.get(name)!;
    return c.polygons.length + c.paths.length + c.refs.length * 10;
  };
  const tops = [...cells.keys()].filter((name) => !referenced.has(name)).sort((a, b) => weight(b) - weight(a));
  return { name: libName, dbuInMeters, cells, tops };
}

export type Shape = { layer: string; points: Point[]; width?: number }; // width set for paths
export type Flat = {
  shapes: Shape[];
  labels: { layer: string; text: string; at: Point }[];
  layers: { id: string; count: number }[];
  bounds: [number, number, number, number]; // minX, minY, maxX, maxY in dbu
  truncated: boolean;
  instances: number;
};

// Every shape of a cell with its references expanded, up to a limit so a huge layout stays responsive.
export function flatten(library: Library, top: string, limit = 150_000): Flat {
  const shapes: Shape[] = [];
  const labels: Flat["labels"] = [];
  const counts = new Map<string, number>();
  let instances = 0;
  let truncated = false;
  const bounds: Flat["bounds"] = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = ([x, y]: Point, pad = 0) => {
    bounds[0] = Math.min(bounds[0], x - pad);
    bounds[1] = Math.min(bounds[1], y - pad);
    bounds[2] = Math.max(bounds[2], x + pad);
    bounds[3] = Math.max(bounds[3], y + pad);
  };
  const add = (layer: number, datatype: number, points: Point[], width?: number) => {
    if (shapes.length >= limit) {
      truncated = true;
      return;
    }
    const id = `${layer}/${datatype}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    shapes.push({ layer: id, points, width });
    points.forEach((p) => grow(p, width ? width / 2 : 0));
  };
  const walk = (name: string, transform: Transform, depth: number) => {
    const cell = library.cells.get(name);
    if (!cell || depth > 64 || truncated) return;
    const scale = Math.hypot(transform[0], transform[1]);
    for (const polygon of cell.polygons) add(polygon.layer, polygon.datatype, polygon.points.map((p) => apply(transform, p)));
    for (const path of cell.paths) add(path.layer, path.datatype, path.points.map((p) => apply(transform, p)), path.width * scale || 1);
    for (const label of cell.labels) labels.push({ layer: `${label.layer}/0`, text: label.text, at: apply(transform, label.at) });
    for (const ref of cell.refs) {
      for (let col = 0; col < ref.cols; col++) {
        for (let row = 0; row < ref.rows; row++) {
          const offset: Transform = [1, 0, 0, 1, col * ref.colStep[0] + row * ref.rowStep[0], col * ref.colStep[1] + row * ref.rowStep[1]];
          instances += 1;
          walk(ref.cell, compose(transform, compose(offset, ref.transform)), depth + 1);
        }
      }
    }
  };
  walk(top, IDENTITY, 0);
  if (!Number.isFinite(bounds[0])) bounds.splice(0, 4, 0, 0, 1, 1);
  const layers = [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => {
      const [la, da] = a.id.split("/").map(Number);
      const [lb, db] = b.id.split("/").map(Number);
      return la - lb || da - db;
    });
  return { shapes, labels, layers, bounds, truncated, instances };
}
