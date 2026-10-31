// ngspice ASCII rawfile reader (the datasets Rocket Engine keeps next to each run's evidence)
// and the Bode view of an AC sweep. Pure functions; the Plots page renders the result.

export type RawVariable = { name: string; type: string };
export type RawPlot = {
  title: string;
  plotname: string;
  complex: boolean;
  variables: RawVariable[];
  // values[variable][point]: [re, im] for complex plots (im = 0 otherwise)
  values: [number, number][][];
};

export function parseRawfile(text: string): RawPlot {
  const lines = text.split(/\r?\n/);
  const header: Record<string, string> = {};
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^Variables:/i.test(line)) break;
    const colon = line.indexOf(":");
    if (colon > 0) header[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  const count = Number(header["no. variables"]);
  const points = Number(header["no. points"]);
  if (!Number.isFinite(count) || !Number.isFinite(points)) throw new Error("Not an ngspice ASCII rawfile (no variable or point count).");
  const variables: RawVariable[] = [];
  for (index += 1; variables.length < count && index < lines.length; index += 1) {
    const [, name, type] = lines[index].trim().split(/\s+/);
    if (name) variables.push({ name, type: type ?? "" });
  }
  while (index < lines.length && !/^Values:/i.test(lines[index])) index += 1;
  // After "Values:", every number on its own token; a point starts with its index.
  const tokens = lines.slice(index + 1).join(" ").trim().split(/\s+/).filter(Boolean);
  const values: [number, number][][] = variables.map(() => []);
  let cursor = 0;
  for (let point = 0; point < points && cursor < tokens.length; point += 1) {
    cursor += 1; // point index
    for (let variable = 0; variable < count; variable += 1) {
      const [re, im = "0"] = (tokens[cursor++] ?? "").split(",");
      values[variable].push([Number(re), Number(im)]);
    }
  }
  return { title: header.title ?? "", plotname: header.plotname ?? "", complex: /complex/i.test(header.flags ?? ""), variables, values };
}

export type BodePoint = { f: number; db: number; phase: number };

// Magnitude in dB and continuous phase in degrees (unwrapped, like ngspice's cph()).
export function bode(plot: RawPlot, vector: string): BodePoint[] {
  const frequency = plot.values[plot.variables.findIndex((v) => v.type === "frequency" || v.name === "frequency")];
  const signal = plot.values[plot.variables.findIndex((v) => v.name === vector)];
  if (!frequency || !signal) return [];
  const out: BodePoint[] = [];
  let previous: number | undefined;
  let offset = 0;
  signal.forEach(([re, im], i) => {
    let phase = (Math.atan2(im, re) * 180) / Math.PI;
    if (previous !== undefined) {
      while (phase + offset - previous > 180) offset -= 360;
      while (phase + offset - previous < -180) offset += 360;
    }
    phase += offset;
    previous = phase;
    out.push({ f: frequency[i][0], db: 20 * Math.log10(Math.hypot(re, im)), phase });
  });
  return out;
}

// First frequency where the gain falls through 0 dB (log-interpolated), if it does.
export function unityGain(points: BodePoint[]): BodePoint | undefined {
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    if (a.db >= 0 && b.db < 0) {
      const t = a.db / (a.db - b.db);
      const f = Math.exp(Math.log(a.f) + t * (Math.log(b.f) - Math.log(a.f)));
      return { f, db: 0, phase: a.phase + t * (b.phase - a.phase) };
    }
  }
  return undefined;
}

// The sweep point nearest a frequency on a log axis.
export function nearest(points: BodePoint[], f: number): BodePoint | undefined {
  let best: BodePoint | undefined;
  for (const point of points) {
    if (!best || Math.abs(Math.log(point.f / f)) < Math.abs(Math.log(best.f / f))) best = point;
  }
  return best;
}
