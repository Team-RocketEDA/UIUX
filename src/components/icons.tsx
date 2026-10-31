import {
  House, Circuitry, GridFour, SlidersHorizontal, ShieldCheck, ChartLine,
  TerminalWindow, Export, FileCode, Folder, CaretDown, CaretRight, X, Play,
  Plus, Cpu, Gear, ArrowsClockwise, Warning, ClockCountdown, ClockCounterClockwise,
  Stack, MagnifyingGlassPlus, MagnifyingGlassMinus, CornersOut, ArrowSquareOut,
  FloppyDisk, DownloadSimple, Check, Lock, Code, GitDiff, Waveform, WaveSine,
  CubeFocus, Package, SelectionAll, Graph, Timer, type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

export type IconName =
  | "home"
  | "schematic"
  | "layout"
  | "constraints"
  | "verification"
  | "plot"
  | "terminal"
  | "export"
  | "file"
  | "folder"
  | "chevronDown"
  | "chevronRight"
  | "close"
  | "play"
  | "plus"
  | "sparkles"
  | "settings"
  | "sync"
  | "warning"
  | "clock"
  | "history"
  | "refresh"
  | "layers"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "external"
  | "save"
  | "download"
  | "check"
  | "x"
  | "lock"
  | "code"
  | "sliders";

const icons: Record<IconName, PhosphorIcon> = {
  home: House, schematic: Circuitry, layout: GridFour, constraints: SlidersHorizontal,
  verification: ShieldCheck, plot: ChartLine, terminal: TerminalWindow, export: Export,
  file: FileCode, folder: Folder, chevronDown: CaretDown, chevronRight: CaretRight,
  close: X, play: Play, plus: Plus, sparkles: Cpu, settings: Gear,
  sync: ArrowsClockwise, warning: Warning, clock: ClockCountdown,
  history: ClockCounterClockwise, refresh: ArrowsClockwise, layers: Stack,
  zoomIn: MagnifyingGlassPlus, zoomOut: MagnifyingGlassMinus, fit: CornersOut,
  external: ArrowSquareOut, save: FloppyDisk, download: DownloadSimple,
  check: Check, x: X, lock: Lock, code: Code, sliders: SlidersHorizontal,
};

export function Icon({ name, size = 16, className }: {
  name: IconName; size?: number; className?: string;
}) {
  const Glyph = icons[name];
  return <Glyph size={size} weight="regular" className={className} aria-hidden="true" />;
}

const toolIcons: Record<string, PhosphorIcon> = {
  klayout: GridFour, gds: SelectionAll, magic: ShieldCheck, drc: ShieldCheck,
  lvs: GitDiff, netgen: GitDiff, openrcx: Graph, verilator: Waveform,
  sim: Waveform, yosys: Cpu, librelane: Circuitry, openroad: Circuitry,
  pnr: Circuitry, opensta: Timer, timing: ClockCountdown, ngspice: ChartLine,
  ac: ChartLine, cace: SlidersHorizontal, gdsfactory: SelectionAll,
  sax: WaveSine, optical: WaveSine, meow: CubeFocus, fde: CubeFocus,
  meep: CubeFocus, "ip-registry": Package, "ip-catalog": Package,
  "export-bundle": Export, export: Export, "three-d": CubeFocus,
};

export function ToolIcon({ toolId, fallback }: { toolId: string; fallback?: string }) {
  const Glyph = toolIcons[toolId.toLowerCase()] ?? icons[fallback as IconName] ?? Cpu;
  return <Glyph size={17} weight="regular" aria-hidden="true" />;
}
