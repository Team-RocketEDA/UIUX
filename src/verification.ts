// The numbers behind the Verification page's pictures, all from the engine's recorded runs. Nothing here decides a
// verdict: statuses are the engine's own.
import type { ConstraintCheck, Evidence, FileEntry } from "./api";
import type { VerilogModule } from "./schematic/verilog";

export type Gauge = { min: number; max: number; target: number; value: number; passAbove: boolean; targetAt: number; valueAt: number };

// A scale wide enough to show the target and the measurement with room around them, as percentages along the bar.
export function gauge(check: Pick<ConstraintCheck, "comparison" | "value">, measured: number): Gauge | undefined {
  if (!Number.isFinite(measured) || !Number.isFinite(check.value)) return undefined;
  const passAbove = check.comparison.includes(">");
  const span = Math.max(Math.abs(measured - check.value) * 1.5, Math.abs(check.value) * 0.25, 1e-9);
  const centre = (measured + check.value) / 2;
  const [min, max] = [centre - span, centre + span];
  const at = (value: number) => ((value - min) / (max - min)) * 100;
  return { min, max, target: check.value, value: measured, passAbove, targetAt: at(check.value), valueAt: at(measured) };
}

export type TrendPoint = { value: number; passed: boolean; revision: string; time: string };

// Each metric across the runs that measured it, oldest first.
export function trend(metric: string, evidence: Evidence[], limit = 12): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const run of evidence) {
    const measurement = run.verdict.measurements?.find((item) => item.name === metric);
    if (typeof measurement?.value === "number") points.push({ value: measurement.value, passed: measurement.status === "pass", revision: run.source_commit ?? "?", time: run.finished_at });
    if (points.length === limit) break;
  }
  return points.reverse();
}

export type Coverage = "passed" | "failed" | "stale" | "testbench" | "none";
export type ModuleCoverage = { module: string; file: string; state: Coverage; testbench?: string };

const inTestFolder = /(^|\/)(tb|tests?|testbench)(\/|$)/i;

function findTestbench(name: string, entries: Pick<FileEntry, "path">[]): string | undefined {
  const lower = name.toLowerCase();
  return entries.find(({ path }) => {
    const value = path.toLowerCase();
    if (!/\.(v|sv|cir|sp|spice|py|yml|yaml)$/.test(value) || !inTestFolder.test(value)) return false;
    const base = value.split("/").pop()!;
    return base.includes(`tb_${lower}`) || base.includes(`${lower}_tb`) || value.includes(`/${lower}/`) || value.includes(`/${lower}_stitch/`);
  })?.path;
}

// What's actually been tested: a block counts only if a run simulated its file. Having a testbench is shown separately,
// because a testbench nobody ran proves nothing.
export function moduleCoverage(modules: VerilogModule[], entries: Pick<FileEntry, "path">[], evidence: Evidence[], revision: string): ModuleCoverage[] {
  const order: Coverage[] = ["failed", "passed", "stale", "testbench", "none"];
  return modules
    .map((module) => {
      const run = evidence.find((item) => item.sources?.some((source) => source === module.file || source.endsWith(`/${module.file}`)));
      const testbench = findTestbench(module.name, entries);
      let state: Coverage = testbench ? "testbench" : "none";
      if (run) {
        const current = run.source_commit === revision && !run.source_dirty;
        state = !current ? "stale" : run.verdict.status === "PASS" ? "passed" : run.verdict.status === "FAIL" ? "failed" : state;
      }
      return { module: module.name, file: module.file, state, testbench };
    })
    .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.module.localeCompare(b.module));
}

const TOOLS: Record<string, string> = { run_spice: "ngspice", run_hdl_test: "Icarus Verilog", run_optical: "SAX", run_drc: "Magic / KLayout", run_lvs: "Netgen", run_digital_flow: "LibreLane" };
export const toolFor = (operation?: string) => (operation ? (TOOLS[operation] ?? operation.replace(/^run_/, "").replace(/_/g, " ")) : "The engine");

export function splitSources(sources: string[]): { design: string[]; tests: string[] } {
  const isTest = (source: string) => inTestFolder.test(source) || /(^|\/)tb_|_tb\./i.test(source);
  return { design: sources.filter((source) => !isTest(source)), tests: sources.filter(isTest) };
}
