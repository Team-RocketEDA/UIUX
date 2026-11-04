// Turns the assistant's tool calls into scenes for the Live build page: code appearing line by line, a drawing being made,
// a check running. Pure, so it can be tested. Text only ever reaches the page as React text nodes.
import type { ToolStep } from "./fuel";

export type StepKind = "edit" | "run" | "read" | "other";

export function stepKind(step: ToolStep): StepKind {
  const tool = step.tool;
  if (/^(edit|write|patch|multiedit)$/i.test(tool) || /apply_revision/.test(tool)) return "edit";
  if (/run_|run$|_run|run_job/.test(tool)) return "run";
  if (/^(read|glob|grep|list)$/i.test(tool) || /_(get|list|read)_/.test(tool)) return "read";
  return "other";
}

// The step's file, relative to the project. Outside the project there's nothing here to show.
export function stepFile(step: ToolStep, projectDir: string): string | undefined {
  const input = step.input as Record<string, unknown>;
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const raw = [input.filePath, input.file, input.path, sources[0]].find((value): value is string => typeof value === "string" && value.length > 0);
  if (!raw) return undefined;
  const root = projectDir.replace(/\/+$/, "") + "/";
  if (raw.startsWith(root)) return raw.slice(root.length);
  return raw.startsWith("/") || raw.startsWith("..") ? undefined : raw.replace(/^\.\//, "");
}

export type DiffLine = { kind: "add" | "remove" | "same"; text: string; oldNumber?: number; newNumber?: number };
export type TokenKind = "plain" | "keyword" | "comment" | "number" | "string" | "name" | "heading";
export type Token = { text: string; kind: TokenKind };
export type Language = "verilog" | "spice" | "yaml" | "markdown" | "plain";

// Line by line, keeping what didn't change. Very large files skip the comparison, which grows with the square of their size.
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  const lines: DiffLine[] = [];
  if (a.length * b.length > 400_000) {
    a.forEach((text, index) => lines.push({ kind: "remove", text, oldNumber: index + 1 }));
    b.forEach((text, index) => lines.push({ kind: "add", text, newNumber: index + 1 }));
    return lines;
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) lines.push({ kind: "same", text: a[i++], oldNumber: i, newNumber: ++j });
    else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) lines.push({ kind: "remove", text: a[i++], oldNumber: i });
    else lines.push({ kind: "add", text: b[j++], newNumber: j });
  }
  return lines;
}

// Only the changed lines and a little around them, the way a reviewer reads a change.
export function aroundChanges(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) keep.add(k);
  });
  return keep.size ? lines.filter((_, index) => keep.has(index)) : lines;
}

export function languageOf(path: string): Language {
  if (/\.(v|sv|vh)$/i.test(path)) return "verilog";
  if (/\.(cir|sp|spice|net|ckt)$/i.test(path)) return "spice";
  if (/\.ya?ml$/i.test(path)) return "yaml";
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  return "plain";
}

const VERILOG_WORDS = /^(module|endmodule|input|output|inout|wire|reg|logic|parameter|localparam|always|always_ff|always_comb|initial|begin|end|if|else|assign|posedge|negedge|or|case|casez|endcase|default|for|generate|endgenerate|genvar|integer|function|endfunction|signed|task|endtask)$/;

function scan(line: string, rules: [RegExp, TokenKind][]): Token[] {
  const tokens: Token[] = [];
  let rest = line;
  while (rest) {
    let best: { index: number; text: string; kind: TokenKind } | undefined;
    for (const [rule, kind] of rules) {
      const match = rule.exec(rest);
      if (match && (!best || match.index < best.index)) best = { index: match.index, text: match[0], kind };
    }
    if (!best || !best.text) {
      tokens.push({ text: rest, kind: "plain" });
      break;
    }
    if (best.index) tokens.push({ text: rest.slice(0, best.index), kind: "plain" });
    tokens.push({ text: best.text, kind: best.kind });
    rest = rest.slice(best.index + best.text.length);
  }
  return tokens;
}

export function highlight(line: string, language: Language): Token[] {
  if (!line) return [];
  if (language === "verilog") {
    const tokens = scan(line, [
      [/\/\/.*$/, "comment"],
      [/"[^"]*"/, "string"],
      [/\b\d+'[bdhoBDHO][0-9a-fA-FxzXZ_]+|\b\d+\b/, "number"],
      [/\$[a-zA-Z_]\w*/, "name"],
      [/\b[A-Za-z_]\w*\b/, "plain"],
    ]);
    return tokens.map((token) => (token.kind === "plain" && VERILOG_WORDS.test(token.text) ? { ...token, kind: "keyword" as const } : token));
  }
  if (language === "spice") {
    if (/^\s*\*/.test(line)) return [{ text: line, kind: "comment" }];
    return scan(line, [
      [/;.*$/, "comment"],
      [/^\s*\.[a-zA-Z]+/, "keyword"],
      [/^\s*[A-Za-z]\w*/, "name"],
      [/\{[^}]*\}/, "string"],
      [/\b\d+(\.\d+)?(e-?\d+)?(meg|[fpnumkgt])?\b/i, "number"],
    ]);
  }
  if (language === "yaml") {
    return scan(line, [
      [/#.*$/, "comment"],
      [/^\s*(-\s+)?[A-Za-z_][\w.-]*(?=:)/, "keyword"],
      [/"[^"]*"|'[^']*'/, "string"],
      [/\b-?\d+(\.\d+)?\b/, "number"],
    ]);
  }
  if (language === "markdown") {
    if (/^#{1,6}\s/.test(line)) return [{ text: line, kind: "heading" }];
    return scan(line, [
      [/`[^`]*`/, "string"],
      [/\*\*[^*]+\*\*/, "keyword"],
    ]);
  }
  return [{ text: line, kind: "plain" }];
}

export type Drawing = "blocks" | "schematic" | "svg" | "picture" | "page";
export type Scene = {
  id: string;
  stepId: string;
  kind: "code" | "drawing" | "run";
  title: string;
  file?: string;
  language?: Language;
  lines?: DiffLine[];
  added?: number;
  removed?: number;
  drawing?: Drawing;
  source?: string;
  tool?: string;
  ready: boolean;
};

export function titleFor(path: string): string {
  if (/(^|\/)constraints\.ya?ml$/.test(path)) return "Setting the targets";
  if (/(^|\/)readme(\.md)?$/i.test(path)) return "Writing the README";
  if (/\.(svg|png|jpe?g|webp|gif|html?)$/i.test(path)) return "Drawing the diagram";
  if (/(^|\/)(tests?|tb|testbench)\/|(^|\/)tb_/i.test(path)) return "Writing the test";
  if (/\.(v|sv|cir|sp|spice|net|ckt)$/i.test(path)) return "Writing the design";
  return "Writing a file";
}

const DRAWING_TITLE: Record<string, string> = { blocks: "Drawing the block diagram", schematic: "Drawing the schematic" };
const TOOLS: Record<string, string> = { spice: "ngspice", hdl: "Icarus Verilog", optical: "SAX", drc: "Magic", lvs: "Netgen", digital: "LibreLane" };

function drawingFor(path: string): Drawing | undefined {
  if (/\.(v|sv)$/i.test(path) && !/(^|\/)(tests?|tb)\/|(^|\/)tb_/i.test(path)) return "blocks";
  if (/\.(cir|sp|spice|net|ckt)$/i.test(path) && !/(^|\/)(tests?|tb)\/|(^|\/)tb_/i.test(path)) return "schematic";
  if (/\.svg$/i.test(path)) return "svg";
  if (/\.(png|jpe?g|webp|gif)$/i.test(path)) return "picture";
  if (/\.html?$/i.test(path)) return "page";
  return undefined;
}

// In the order they happened. A file written again shows what changed since the session last wrote it.
export function scenesFromSteps(steps: ToolStep[], projectDir: string): Scene[] {
  const scenes: Scene[] = [];
  const written = new Map<string, string>();
  for (const step of [...steps].sort((a, b) => a.time - b.time)) {
    const kind = stepKind(step);
    if (step.status === "error") continue;
    const ready = step.status === "completed";
    if (kind === "run") {
      const tool = Object.entries(TOOLS).find(([key]) => step.tool.includes(key))?.[1] ?? "the engine";
      scenes.push({ id: `${step.id}:run`, stepId: step.id, kind: "run", title: `Simulating with ${tool}`, tool, ready });
      continue;
    }
    if (kind !== "edit") continue;
    const path = stepFile(step, projectDir);
    if (!path) continue;
    const input = step.input as Record<string, unknown>;
    const name = path.split("/").pop();
    const drawing = drawingFor(path);
    let lines: DiffLine[] | undefined;
    let after: string | undefined;
    if (typeof input.content === "string") {
      after = input.content;
      lines = lineDiff(written.get(path) ?? "", after);
    } else if (typeof input.oldString === "string" && typeof input.newString === "string") {
      const known = written.get(path);
      if (known !== undefined && known.includes(input.oldString)) {
        after = known.replace(input.oldString, input.newString);
        lines = lineDiff(known, after);
      } else lines = lineDiff(input.oldString, input.newString);
    }
    if (after !== undefined) written.set(path, after);
    if (lines) lines = written.size && lines.some((line) => line.kind === "same") ? aroundChanges(lines) : lines;
    // An SVG reads better drawn than as markup.
    if (lines && drawing !== "svg" && drawing !== "picture") {
      scenes.push({
        id: `${step.id}:code`,
        stepId: step.id,
        kind: "code",
        title: titleFor(path),
        file: name,
        language: languageOf(path),
        lines,
        added: lines.filter((line) => line.kind === "add").length,
        removed: lines.filter((line) => line.kind === "remove").length,
        ready: true,
      });
    }
    if (drawing) {
      scenes.push({ id: `${step.id}:draw`, stepId: step.id, kind: "drawing", title: DRAWING_TITLE[drawing] ?? "Drawing the diagram", file: path, drawing, source: after, ready });
    }
  }
  return scenes;
}

// Fewer lines still take a moment, and long files don't hold everything up. With work queued behind it, it goes faster.
export function lineDelay(count: number, waiting: number): number {
  const base = Math.min(90, Math.max(14, 3800 / Math.max(1, count)));
  return waiting > 1 ? base / Math.min(4, waiting) : base;
}
