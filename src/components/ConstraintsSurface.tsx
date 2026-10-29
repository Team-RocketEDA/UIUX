import { useState } from "react";
import type { Check, ConstraintSet, Domain } from "../types";
import { pdkOptions } from "../data";
import { Icon } from "./icons";
import { DomainTag, ProgressBar, StatusPill, SurfaceHeader } from "./ui";

type NumericKey =
  | "supplyV"
  | "clockMhz"
  | "maxPowerMw"
  | "maxAreaMm2"
  | "wavelengthNm"
  | "extinctionDb";

const numericFields: {
  key: NumericKey;
  label: string;
  unit: string;
  step: string;
  domains?: Domain[];
}[] = [
  { key: "supplyV", label: "Supply voltage", unit: "V", step: "0.1" },
  { key: "clockMhz", label: "Clock target", unit: "MHz", step: "1", domains: ["digital"] },
  { key: "maxPowerMw", label: "Power budget", unit: "mW", step: "1" },
  { key: "maxAreaMm2", label: "Area budget", unit: "mm²", step: "0.01" },
  {
    key: "wavelengthNm",
    label: "Operating wavelength",
    unit: "nm",
    step: "1",
    domains: ["photonic"],
  },
  {
    key: "extinctionDb",
    label: "Min. extinction ratio",
    unit: "dB",
    step: "0.5",
    domains: ["photonic"],
  },
];

const domainLabels: Record<Domain, string> = {
  digital: "Digital",
  analog: "Analog",
  photonic: "Photonic",
};

export function ConstraintsSurface({
  constraints,
  checks,
  onSave,
  onOpenFile,
}: {
  constraints: ConstraintSet;
  checks: Check[];
  onSave: (next: ConstraintSet) => void;
  onOpenFile: (path: string) => void;
}) {
  const [draft, setDraft] = useState<ConstraintSet>(constraints);
  const dirty = JSON.stringify(draft) !== JSON.stringify(constraints);

  const update = <Key extends keyof ConstraintSet>(key: Key, value: ConstraintSet[Key]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const toggleDomain = (domain: Domain) => {
    if (draft.domains.includes(domain) && draft.domains.length === 1) return;
    update(
      "domains",
      draft.domains.includes(domain)
        ? draft.domains.filter((item) => item !== domain)
        : [...draft.domains, domain],
    );
  };

  const toggleGate = (id: string) => {
    update(
      "requiredChecks",
      draft.requiredChecks.includes(id)
        ? draft.requiredChecks.filter((item) => item !== id)
        : [...draft.requiredChecks, id],
    );
  };

  const isFieldActive = (field: (typeof numericFields)[number]) =>
    !field.domains || field.domains.some((domain) => draft.domains.includes(domain));

  const invalidFields = numericFields.filter((field) => {
    if (!isFieldActive(field)) return false;
    const value = Number(draft[field.key]);
    return !Number.isFinite(value) || value <= 0;
  });
  const iterationsValid =
    Number.isInteger(draft.maxIterations) &&
    draft.maxIterations >= 1 &&
    draft.maxIterations <= 50;
  const canSave = dirty && invalidFields.length === 0 && iterationsValid && draft.domains.length > 0;

  const requiredChecks = checks.filter((check) => draft.requiredChecks.includes(check.id));
  const requiredPassed = requiredChecks.filter((check) => check.status === "passed").length;
  const requiredFailed = requiredChecks.filter((check) => check.status === "failed").length;
  const requiredUnsupported = requiredChecks.filter(
    (check) => check.status === "unsupported",
  ).length;

  return (
    <div className="page-surface constraints-surface">
      <SurfaceHeader
        eyebrow="PROJECT / VERIFICATION GATES"
        title="Constraints"
        subtitle="Targets and required checks are explicit before generation. The agent and runner read this file."
        actions={
          <>
            {dirty ? (
              <span className="unsaved-pill">UNSAVED</span>
            ) : (
              <span className="saved-pill">
                <span className="status-dot passed" />
                SAVED
              </span>
            )}
            <button
              className="secondary-button"
              onClick={() => setDraft(constraints)}
              disabled={!dirty}
            >
              <Icon name="refresh" size={13} />
              Reset
            </button>
            <button
              className="primary-button"
              onClick={() => onSave(draft)}
              disabled={!canSave}
              title={!canSave && dirty ? "Fix validation errors before saving" : "Save constraints.yaml"}
            >
              <Icon name="save" size={13} />
              Save constraints
            </button>
          </>
        }
      />

      <div className="constraints-grid">
        <div className="constraint-main">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">PROCESS & DOMAINS</span>
                <h2>Technology scope</h2>
              </div>
              <span className="panel-note">PDK-aware, not PDK-universal</span>
            </div>
            <div className="constraint-body">
              <span className="field-caption">Process design kit</span>
              <div className="pdk-options" role="radiogroup" aria-label="Process design kit">
                {pdkOptions.map((pdk) => (
                  <button
                    key={pdk.id}
                    className={`pdk-option ${draft.pdk === pdk.id ? "selected" : ""}`}
                    role="radio"
                    aria-checked={draft.pdk === pdk.id}
                    onClick={() => update("pdk", pdk.id)}
                  >
                    <span className="pdk-option-mark">{pdk.label.charAt(0)}</span>
                    <span>
                      <b>{pdk.label}</b>
                      <small>{pdk.note}</small>
                    </span>
                    {draft.pdk === pdk.id && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>

              <div className="field-divider" />

              <span className="field-caption">Design domains in this project</span>
              <div className="domain-toggles">
                {(["digital", "analog", "photonic"] as Domain[]).map((domain) => {
                  const active = draft.domains.includes(domain);
                  return (
                    <button
                      key={domain}
                      className={`domain-toggle ${active ? "active" : ""}`}
                      onClick={() => toggleDomain(domain)}
                      aria-pressed={active}
                      disabled={active && draft.domains.length === 1}
                      title={active && draft.domains.length === 1 ? "Keep at least one domain" : undefined}
                    >
                      <span className={`domain-icon ${domain}`}>
                        {domainLabels[domain].charAt(0)}
                      </span>
                      <span>
                        <b>{domainLabels[domain]}</b>
                        <small>{active ? "included" : "excluded"}</small>
                      </span>
                      <span className={`toggle-check ${active ? "on" : ""}`}>
                        {active ? <Icon name="check" size={11} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="field-help">
                Mixed-domain assembly is supported logically. Unrelated electronic and photonic
                PDKs are not claimed to co-fabricate one die.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">NUMERIC TARGETS</span>
                <h2>Measurable acceptance criteria</h2>
              </div>
              <span className="panel-note">All values must be positive</span>
            </div>
            <div className="constraint-body">
              <div className="field-grid">
                {numericFields.map((field) => {
                  const active = isFieldActive(field);
                  const invalid = invalidFields.includes(field);
                  return (
                    <label className={`field ${active ? "" : "inactive"} ${invalid ? "invalid" : ""}`} key={field.key}>
                      <span>{field.label}</span>
                      <div className="input-with-unit">
                        <input
                          type="number"
                          min="0"
                          step={field.step}
                          value={draft[field.key]}
                          disabled={!active}
                          aria-invalid={invalid}
                          onChange={(event) => update(field.key, event.target.value)}
                        />
                        <b>{field.unit}</b>
                      </div>
                      <small>{active ? (invalid ? "Enter a positive number" : "Required target") : "Disabled for selected domains"}</small>
                    </label>
                  );
                })}
              </div>
              {invalidFields.length > 0 && (
                <div className="inline-callout danger">
                  <Icon name="warning" size={14} />
                  <span>
                    Fix {invalidFields.length} invalid target{invalidFields.length > 1 ? "s" : ""} before
                    saving.
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">VERIFICATION GATES</span>
                <h2>Checks required before export</h2>
              </div>
              <span className="panel-note">{draft.requiredChecks.length} required</span>
            </div>
            <div className="gate-list">
              {checks.map((check) => {
                const domainActive = draft.domains.includes(check.domain);
                const enabled = draft.requiredChecks.includes(check.id);
                return (
                  <label
                    className={`gate-row ${enabled ? "" : "off"} ${domainActive ? "" : "disabled"}`}
                    key={check.id}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={!domainActive}
                      onChange={() => toggleGate(check.id)}
                    />
                    <span className="gate-checkbox" aria-hidden="true">
                      {enabled ? <Icon name="check" size={11} /> : null}
                    </span>
                    <span className="gate-copy">
                      <b>{check.name}</b>
                      <small>{check.target}</small>
                    </span>
                    <DomainTag domain={check.domain} />
                    <StatusPill status={check.status} />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">AUTONOMY</span>
                <h2>Repair loop and stop rule</h2>
              </div>
            </div>
            <div className="constraint-body">
              <div className="autonomy-options">
                <button
                  className={`autonomy-option ${draft.autonomy === "approve" ? "selected" : ""}`}
                  onClick={() => update("autonomy", "approve")}
                  aria-pressed={draft.autonomy === "approve"}
                >
                  <b>Approval at major stages</b>
                  <small>Proposed source edits and check reruns wait for your approval.</small>
                </button>
                <button
                  className={`autonomy-option ${draft.autonomy === "auto" ? "selected" : ""}`}
                  onClick={() => update("autonomy", "auto")}
                  aria-pressed={draft.autonomy === "auto"}
                >
                  <b>Automatic repair</b>
                  <small>The agent edits sources and reruns affected checks until the limit.</small>
                </button>
              </div>
              <label className={`field iteration-field ${iterationsValid ? "" : "invalid"}`}>
                <span>Maximum repair iterations</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={Number.isNaN(draft.maxIterations) ? "" : draft.maxIterations}
                    onChange={(event) => update("maxIterations", Number(event.target.value))}
                  />
                  <b>iterations</b>
                </div>
                <small>
                  {iterationsValid
                    ? "At the limit the agent stops and asks you what to do."
                    : "Enter a whole number from 1 to 50."}
                </small>
              </label>
            </div>
          </section>
        </div>

        <aside className="constraint-side">
          <section className="panel summary-card">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">SNAPSHOT</span>
                <h2>Constraint summary</h2>
              </div>
            </div>
            <div className="summary-body">
              <dl className="summary-list">
                <div>
                  <dt>PDK</dt>
                  <dd>{pdkOptions.find((pdk) => pdk.id === draft.pdk)?.label}</dd>
                </div>
                <div>
                  <dt>Domains</dt>
                  <dd>{draft.domains.join(", ")}</dd>
                </div>
                <div>
                  <dt>Clock</dt>
                  <dd>{draft.clockMhz} MHz</dd>
                </div>
                <div>
                  <dt>Supply</dt>
                  <dd>{draft.supplyV} V</dd>
                </div>
                <div>
                  <dt>Area budget</dt>
                  <dd>{draft.maxAreaMm2} mm²</dd>
                </div>
                <div>
                  <dt>Optical target</dt>
                  <dd>{draft.wavelengthNm} nm</dd>
                </div>
                <div>
                  <dt>Max iterations</dt>
                  <dd>{draft.maxIterations}</dd>
                </div>
                <div>
                  <dt>Autonomy</dt>
                  <dd>{draft.autonomy === "auto" ? "Automatic" : "Approval"}</dd>
                </div>
              </dl>

              <div className="summary-progress">
                <div className="summary-progress-label">
                  <span>Required gates</span>
                  <b>
                    {requiredPassed}/{requiredChecks.length}
                  </b>
                </div>
                <ProgressBar
                  value={requiredChecks.length ? (requiredPassed / requiredChecks.length) * 100 : 0}
                />
                <div className="summary-counts">
                  <span className="pass">{requiredPassed} pass</span>
                  <span className="fail">{requiredFailed} fail</span>
                  <span className="skip">{requiredUnsupported} unsupported</span>
                </div>
              </div>

              <div className="summary-actions">
                <button
                  className="secondary-button"
                  onClick={() => onOpenFile("constraints.yaml")}
                >
                  <Icon name="code" size={13} />
                  View constraints.yaml
                </button>
                {dirty && <span className="unsaved-note">Changes not saved</span>}
              </div>
            </div>
          </section>

          <section className="panel side-note">
            <div className="panel-heading compact">
              <div>
                <span className="eyebrow">EVIDENCE RULE</span>
                <h2>No green without a run</h2>
              </div>
            </div>
            <div className="side-note-body">
              <p>
                A check passes only when real tool output satisfies the stated target. Unsupported
                and skipped checks stay distinct and are never shown as passes.
              </p>
              <button className="text-button" onClick={() => onOpenFile("rocket.yaml")}>
                Open project file
                <Icon name="chevronRight" size={12} />
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
