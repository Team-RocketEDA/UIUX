import { useRef, useState } from "react";
import type { ProjectFile } from "../types";
import { downloadText } from "../utils";
import { Icon } from "./icons";
import { SurfaceHeader } from "./ui";

export function SourceSurface({
  file,
  dirty,
  onChange,
  onSave,
}: {
  file: ProjectFile;
  dirty: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const lineCount = file.content.split("\n").length;

  const updateCursor = () => {
    const position = textareaRef.current?.selectionStart ?? 0;
    const before = file.content.slice(0, position);
    const lines = before.split("\n");
    setCursor({ line: lines.length, column: lines[lines.length - 1].length + 1 });
  };

  return (
    <div className="fill-surface source-surface">
      <SurfaceHeader
        eyebrow={`SOURCE / ${file.kind.toUpperCase()}`}
        title={file.path.split("/").pop() ?? file.path}
        subtitle={file.path}
        actions={
          <>
            {dirty && <span className="unsaved-pill">UNSAVED</span>}
            {file.readOnly && (
              <span className="readonly-pill">
                <Icon name="lock" size={11} />
                READ ONLY
              </span>
            )}
            <button
              className="secondary-button"
              onClick={() =>
                downloadText(file.path.split("/").pop() ?? "source.txt", file.content)
              }
            >
              <Icon name="download" size={13} />
              Download
            </button>
            <button
              className="primary-button"
              onClick={onSave}
              disabled={!dirty || file.readOnly}
              title={file.readOnly ? "Evidence artifacts are read-only" : "Save file (Ctrl+S)"}
            >
              <Icon name="save" size={13} />
              Save
            </button>
          </>
        }
      />

      <div className="panel code-panel">
        <div className="code-panel-bar">
          <span className="code-language">{file.language}</span>
          <span>{lineCount} lines</span>
          <span>UTF-8</span>
          <span className="code-path">{file.path}</span>
        </div>
        <div className="code-editor">
          <div className="code-gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="code-textarea"
            value={file.content}
            readOnly={file.readOnly}
            spellCheck={false}
            aria-label={`Edit ${file.path}`}
            onChange={(event) => onChange(event.target.value)}
            onScroll={() => {
              if (gutterRef.current && textareaRef.current) {
                gutterRef.current.scrollTop = textareaRef.current.scrollTop;
              }
            }}
            onSelect={updateCursor}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                if (dirty && !file.readOnly) onSave();
              }
            }}
          />
        </div>
        <div className="code-statusbar">
          <span>Ln {cursor.line}, Col {cursor.column}</span>
          <span>Spaces: 2</span>
          <span>LF</span>
          <span className="code-status-note">
            {file.readOnly
              ? "Evidence artifact produced by the runner — not editable."
              : dirty
                ? "Unsaved edits live in the project working tree until saved."
                : "Source-backed project file."}
          </span>
        </div>
      </div>
    </div>
  );
}
