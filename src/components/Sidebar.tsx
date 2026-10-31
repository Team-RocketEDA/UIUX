import { useState } from "react";
import type { ProjectFile } from "../types";
import { Icon } from "./icons";

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

// File explorer: the project's real files. Navigation lives in the rail.
export function Sidebar({
  files,
  dirtyFiles,
  openFilePath,
  onOpenFile,
  width,
  pdk,
  domains,
  onOpenConstraints,
}: {
  files: ProjectFile[];
  dirtyFiles: Set<string>;
  openFilePath: string | null;
  onOpenFile: (path: string) => void;
  width: number;
  pdk?: string;
  domains?: string[];
  onOpenConstraints: () => void;
}) {
  // Engine run files are noise most of the time; start with results/ folded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["results"]));
  const tree = buildTree(files);
  const noPdk = !pdk || pdk === "none";

  const toggle = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderFiles = (node: FolderNode, depth: number) =>
    node.files.map((file) => (
      <button
        key={file.path}
        className={`tree-row ${openFilePath === file.path ? "selected" : ""}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => onOpenFile(file.path)}
        title={file.path}
      >
        <Icon name={file.readOnly ? "lock" : "file"} size={13} />
        <span>{file.path.split("/").pop()}</span>
        {dirtyFiles.has(file.path) && <i className="dirty-dot" title="Unsaved changes" />}
      </button>
    ));

  const renderFolder = (node: FolderNode, depth: number) => {
    const isCollapsed = collapsed.has(node.path);
    return (
      <div key={node.path}>
        <button className="tree-row folder" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => toggle(node.path)} aria-expanded={!isCollapsed}>
          <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={13} />
          <span>{node.name}</span>
        </button>
        {!isCollapsed && (
          <>
            {node.folders.map((folder) => renderFolder(folder, depth + 1))}
            {renderFiles(node, depth + 1)}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="explorer" style={{ width }}>
      <header className="explorer-header">
        <b>Project files</b>
        <span>{files.length}</span>
      </header>
      <div className="explorer-tree">
        {tree.folders.map((folder) => renderFolder(folder, 0))}
        {renderFiles(tree, 0)}
      </div>
      <button className="pdk-footer" onClick={onOpenConstraints} title="Set in constraints.yaml">
        <span className="pdk-mark">{noPdk ? "–" : pdk!.slice(0, 1).toUpperCase()}</span>
        <span className="pdk-text">
          <span className="eyebrow">Active PDK</span>
          <b>{noPdk ? "None" : pdk}</b>
          <small>{[noPdk ? "Generic models" : "", ...(domains ?? []).map((d) => d[0].toUpperCase() + d.slice(1))].filter(Boolean).join(" · ")}</small>
        </span>
        <Icon name="chevronRight" size={13} />
      </button>
    </aside>
  );
}
