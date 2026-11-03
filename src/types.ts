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
  status: "running" | "passed" | "failed" | "not_run";
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
