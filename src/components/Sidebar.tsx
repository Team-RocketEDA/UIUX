import { useState } from "react";
import type { ProjectFile, SurfaceId } from "../types";
import { Icon, type IconName } from "./icons";

const pdkLabel = (pdk: string) => (pdk === "none" ? "Generic models (no PDK)" : pdk);

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
      <div className="sidebar-section">
        <div className="sidebar-heading">WORKBENCH</div>
        <nav className="surface-nav" aria-label="Workbench surfaces">
          {surfaces.map((item) => (
            <button
              key={item.id}
              className={`surface-nav-item ${surface === item.id ? "active" : ""}`}
              onClick={() => onNavigate(item.id)}
              aria-current={surface === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
              {item.id === "verification" && issueCount > 0 && (
                <span className="nav-alert" title={`${issueCount} checks need attention`}>
                  {issueCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="sidebar-section files-section">
        <div className="sidebar-heading">
          <span>PROJECT FILES</span>
          <span className="sidebar-count">{files.length}</span>
        </div>
        <div className="file-tree">{renderFolder(tree, 0)}</div>
      </div>

      <button className="sidebar-footer" onClick={() => onNavigate("constraints")}>
        <span className="pdk-mark">{pdk === "none" ? "G" : pdk.charAt(0).toUpperCase()}</span>
        <span className="sidebar-footer-copy">
          <span className="eyebrow">ACTIVE PDK</span>
          <b>{pdkLabel(pdk)}</b>
          <small>{domains.map((domain) => domain[0].toUpperCase() + domain.slice(1)).join(" · ")}</small>
        </span>
        <Icon name="chevronRight" size={14} />
      </button>
    </aside>
  );
}
