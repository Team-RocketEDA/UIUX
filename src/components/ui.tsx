import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import type { CheckStatus, Domain } from "../types";

type PillStatus = CheckStatus | "ready" | "unavailable" | "active";

const pillLabels: Record<PillStatus, string> = {
  passed: "PASS",
  failed: "FAIL",
  running: "RUNNING",
  not_run: "NOT RUN",
  unsupported: "UNSUPPORTED",
  skipped: "NOT RUN",
  ready: "READY",
  unavailable: "UNAVAILABLE",
  active: "ACTIVE",
};

export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  return (
    <span className={`status-pill ${status}`}>
      <span className="status-dot" />
      {label ?? pillLabels[status]}
    </span>
  );
}

export function DomainTag({ domain }: { domain: Domain }) {
  return <span className={`domain-tag ${domain}`}>{domain}</span>;
}

export function SurfaceHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="surface-header">
      <div className="surface-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="surface-actions">{actions}</div>}
    </header>
  );
}

export function ResizeHandle({
  orientation,
  label,
  onPointerDown,
  onKeyDown,
}: {
  orientation: "column" | "row";
  label: string;
  onPointerDown: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  return (
    <div
      className={`resize-handle ${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation === "column" ? "vertical" : "horizontal"}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-bar" aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
