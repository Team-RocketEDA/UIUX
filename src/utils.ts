import type { Check, ConstraintSet } from "./types";

export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildVerificationReport(
  checks: Check[],
  constraints: ConstraintSet,
  revision: string,
  projectName: string,
) {
  const rows = checks
    .map(
      (check) =>
        `| ${check.name} | ${check.domain} | ${check.status.toUpperCase()} | ${check.target} | ${check.measured} | ${check.tool} | ${check.artifact} |`,
    )
    .join("\n");

  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const unsupported = checks.filter((check) => check.status === "unsupported").length;

  return `# RocketEDA verification report

- **Project:** ${projectName}
- **Revision:** ${revision}
- **PDK:** ${constraints.pdk}
- **Domains:** ${constraints.domains.join(", ")}
- **Autonomy:** ${constraints.autonomy} · max ${constraints.maxIterations} repair iterations
- **Generated:** ${new Date().toISOString()}

## Summary

- Passed: ${passed}
- Failed: ${failed}
- Unsupported: ${unsupported}

| Check | Domain | Status | Target | Measured | Tool / version | Artifact |
|---|---|---|---|---|---|---|
${rows}

## Boundaries

A PASS means the recorded run met the listed target for the recorded source revision,
PDK and tool settings. Unsupported checks are not passes. GDS output and this report
are not foundry-approved tapeout signoff. Binary layout artifacts remain in the runner
artifact store.

## Constraints

- Supply: ${constraints.supplyV} V
- Clock: ${constraints.clockMhz} MHz
- Power budget: ${constraints.maxPowerMw} mW
- Area budget: ${constraints.maxAreaMm2} mm²
- Optical wavelength: ${constraints.wavelengthNm} nm
- Extinction target: ${constraints.extinctionDb} dB
- Required gates: ${constraints.requiredChecks.join(", ")}
`;
}
