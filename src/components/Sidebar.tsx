import { useState } from "react";
import type { ProjectFile, SurfaceId } from "../types";
import { pdkLabel } from "../data";
import { Icon, type IconName } from "./icons";

const surfaces: { id: SurfaceId; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "schematic", label: "Schematic", icon: "schematic" },
  { id: "layout", label: "Layout", icon: "layout" },
  { id: "constraints", label: "Constraints", icon: "constraints" },
  { id: "verification", label: "Verification", icon: "verification" },
  { id: "plots", label: "Plots", icon: "plot" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "export", label: "Export", icon: "export" },
];

type FolderNode = {
  name: string;
  path: string;
  folders: FolderNode[];
  files: ProjectFile[];
};

function buildTree(files: ProjectFile[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.slice(0, -1).forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let child = node.folders.find((folder) => folder.path === path);
      if (!child) {
        child = { name: part, path, folders: [], files: [] };
        node.folders.push(child);
      }
      node = child;
    });
    node.files.push(file);
  }
  return root;
}

function countFiles(node: FolderNode): number {
  return (
    node.files.length +
    node.folders.reduce((total, folder) => total + countFiles(folder), 0)
  );
}

export function Sidebar({
  files,
  dirtyFiles,
  openFilePath,
  surface,
  issueCount,
  onNavigate,
  onOpenFile,
  pdk,
  domains,
  width,
  hidden,
}: {
  files: ProjectFile[];
  dirtyFiles: Set<string>;
  openFilePath: string | null;
  surface: SurfaceId;
  issueCount: number;
  onNavigate: (surface: SurfaceId) => void;
  onOpenFile: (path: string) => void;
  pdk: string;
  domains: string[];
  width: number;
  hidden: boolean;
}) {
  const [mode, setMode] = useState<"explorer" | "library">("explorer");
  const [library, setLibrary] = useState<"standard" | "pdk">("standard");
  const [query, setQuery] = useState("");
  const components = library === "pdk" ? [
    ["sky130_fd_pr__nfet_01v8", "NMOS · 1.8 V"],
    ["sky130_fd_pr__pfet_01v8", "PMOS · 1.8 V"],
    ["sky130_fd_pr__res_high_po", "High-resistance poly"],
    ["sky130_fd_pr__cap_mim_m3_1", "MIM capacitor · M3"],
  ] : [
    ["ota_5t", "5-transistor OTA · reference"],
    ["rv32i_core", "RISC-V · digital IP"],
    ["mzi_1550", "Mach-Zehnder · 1550 nm"],
    ["opamp_2stage", "Two-stage op-amp"],
    ["gpio_controller", "GPIO · digital IP"],
    ["resistor", "Passive · R"], ["capacitor", "Passive · C"],
  ];
  const visibleComponents = components.filter((entry) => entry.join(" ").toLowerCase().includes(query.toLowerCase()));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = buildTree(files);

  const toggleFolder = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderFolder = (node: FolderNode, depth: number) => {
    const isCollapsed = collapsed.has(node.path);
    return (
      <div key={node.path}>
        <button
          className="tree-folder"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => toggleFolder(node.path)}
          aria-expanded={!isCollapsed}
        >
          <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={12} />
          <span>{node.name}</span>
          <small>{countFiles(node)}</small>
        </button>
        {!isCollapsed && (
          <>
            {node.files.map((file) => (
              <button
                key={file.path}
                className={`tree-file ${openFilePath === file.path ? "selected" : ""}`}
                style={{ paddingLeft: 27 + depth * 12 }}
                onClick={() => onOpenFile(file.path)}
                title={file.path}
              >
                <Icon
                  name={file.readOnly ? "lock" : "file"}
                  size={12}
                  className={`file-icon ${file.kind}`}
                />
                <span>{file.path.split("/").pop()}</span>
                {dirtyFiles.has(file.path) && (
                  <i className="dirty-dot" title="Unsaved changes" />
                )}
              </button>
            ))}
            {node.folders.map((folder) => renderFolder(folder, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar" style={{ width }} hidden={hidden}>
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar mode">
        {(["explorer", "library"] as const).map((tab) => <button key={tab} role="tab" aria-selected={mode === tab} className={mode === tab ? "active" : ""} onClick={() => setMode(tab)}>{tab === "explorer" ? "Files" : "Components"}</button>)}
      </div>
      {mode === "library" ? <section className="library-browser" aria-label="Component library">
        <div className="library-tabs" role="tablist" aria-label="Library collection">
          <button role="tab" aria-selected={library === "standard"} className={library === "standard" ? "active" : ""} onClick={() => setLibrary("standard")}>Standard</button>
          <button role="tab" aria-selected={library === "pdk"} className={library === "pdk" ? "active" : ""} onClick={() => setLibrary("pdk")}>PDK (sky130A)</button>
        </div>
        <input className="library-search" aria-label="Search components" placeholder="Filter symbols / cells…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="library-list">{visibleComponents.map(([name, detail]) => <button className="library-component" key={name} title={`${name} — open schematic`} onClick={() => onNavigate("schematic")}>
          <Icon name={name.includes("rv32") || name.includes("gpio") ? "code" : "schematic"} size={14} />
          <span><b>{name}</b><small>{detail}</small></span>
        </button>)}</div>
        {!visibleComponents.length && <p className="library-empty">No matching symbols.</p>}
      </section> : <>
      <div className="sidebar-section files-section">
        <div className="file-tree">{renderFolder(tree, 0)}</div>
      </div>

      </>}
    </aside>
  );
}
