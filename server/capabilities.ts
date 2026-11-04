// What Rocket Engine says it can run, from its get_capabilities answer. The engine decides readiness and
// whether each tool resolves on this machine; this only reshapes that answer for the IDE and adds nothing.

export type EngineTool = { name: string; available: boolean; missing: string[]; remedy?: string };
export type JobKind = { operation: string; readiness: string; reason?: string; tools: EngineTool[] };

/**
 * Lists the engine operations that run on a tool, each with the engine's readiness and its tools.
 * Operations the engine serves itself, or has no solver for, name no tool and are left out.
 * Throws when the answer has no operations, so an engine error is not shown as "nothing installed".
 */
export function capabilityKinds(answer: unknown): JobKind[] {
  const operations = (answer as { operations?: unknown } | null)?.operations;
  if (!operations || typeof operations !== "object") {
    const error = (answer as { error?: unknown } | null)?.error;
    throw new Error(`get_capabilities gave no operations${error ? `: ${JSON.stringify(error)}` : ""}`);
  }
  return Object.entries(operations as Record<string, any>).flatMap(([operation, entry]) => {
    const tools = Object.entries((entry?.tools ?? {}) as Record<string, any>);
    if (!tools.length) return [];
    return [{
      operation,
      readiness: String(entry?.readiness ?? "unknown"),
      ...(entry?.reason ? { reason: String(entry.reason) } : {}),
      tools: tools.map(([name, tool]) => ({
        name,
        available: tool?.available === true,
        missing: Array.isArray(tool?.missing) ? tool.missing.map(String) : [],
        ...(tool?.remedy ? { remedy: String(tool.remedy) } : {}),
      })),
    }];
  });
}
