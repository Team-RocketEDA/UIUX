export type CheckStatus = "passed" | "failed" | "running" | "unsupported" | "skipped";

export type Domain = "digital" | "analog" | "photonic";

export type ToolCategory = "Layout" | "Digital" | "Analog" | "Photonic" | "Project";

export type ToolDefinition = {
  id: string;
  label: string;
  detail: string;
  category: ToolCategory;
  icon: string;
  available: boolean;
  unavailableReason?: string;
  logs: string[];
};

export type Check = {
  id: string;
  name: string;
  domain: Domain;
  tool: string;
  target: string;
  measured: string;
  status: CheckStatus;
  artifact: string;
  log: string;
  revision: string;
  updated: string;
};

export type ConstraintSet = {
  pdk: string;
  domains: Domain[];
  supplyV: string;
  clockMhz: string;
  maxPowerMw: string;
  maxAreaMm2: string;
  wavelengthNm: string;
  extinctionDb: string;
  maxIterations: number;
  autonomy: "auto" | "approve";
  requiredChecks: string[];
};

export type ProjectFile = {
  path: string;
  language: string;
  kind: "config" | "source" | "test" | "result" | "ip" | "workflow";
  content: string;
  readOnly?: boolean;
};

export type Job = {
  id: string;
  title: string;
  tool: string;
  status: "running" | "passed" | "failed";
  progress: number;
  logs: string[];
  startedAt: string;
};

export type SurfaceId =
  | "overview"
  | "schematic"
  | "layout"
  | "constraints"
  | "verification"
  | "plots"
  | "terminal"
  | "export";

export type ActiveView = { kind: "surface"; id: SurfaceId } | { kind: "file"; path: string };

export type SchematicPort = {
  name: string;
  side: "left" | "right" | "top" | "bottom";
  offset: number;
};

export type SchematicInstance = {
  id: string;
  label: string;
  block: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: "blue" | "green" | "purple" | "amber";
  badge: "IP" | "SHEET" | "MACRO";
  sheet?: string;
  params: { name: string; value: string }[];
  ports: SchematicPort[];
};

export type SchematicWire = {
  points: [number, number][];
  label?: string;
  dashed?: boolean;
};

export type SchematicBoundaryPort = {
  name: string;
  x: number;
  y: number;
  side: "left" | "right";
};

export type SchematicSheet = {
  id: string;
  name: string;
  path: string;
  instances: SchematicInstance[];
  wires: SchematicWire[];
  boundaryPorts: SchematicBoundaryPort[];
  note: string;
};
