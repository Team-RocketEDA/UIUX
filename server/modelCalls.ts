// Provider-neutral model activity for the panel in the app. Two record shapes are understood:
//
//   {"event":"call", ...}       written by the Rocket Fuel plugin from OpenCode's own accounting
//   {"event":"response", ...}   written by the optional transparent relay (and by older Meta installs)
//
// Both contain only provider/model, status, timing, token counts and request ids. Prompts, messages,
// authorization headers and keys are never recorded.
import { closeSync, openSync, readSync, statSync } from "node:fs";

export type ModelCall = {
  at: string;
  provider: string | null;
  model: string | null;
  status: number;
  tokensIn: number | null;
  tokensOut: number | null;
  seconds: number;
  requestId: string | null;
};

const TAIL_BYTES = 256 * 1024;
const LIMIT = 50;

function tail(file: string): string {
  const size = statSync(file).size;
  const length = Math.min(size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

function secondsOf(record: any): number {
  if (typeof record.seconds === "number") return record.seconds;
  if (typeof record.duration_ms === "number") return record.duration_ms / 1000;
  return 0;
}

function fromCall(record: any): ModelCall {
  return {
    at: record.at ?? record.timestamp,
    provider: record.provider ?? null,
    model: record.model ?? null,
    status: typeof record.status === "number" ? record.status : 200,
    tokensIn: record.input_tokens ?? record.tokens_in ?? null,
    tokensOut: record.output_tokens ?? record.tokens_out ?? null,
    seconds: secondsOf(record),
    requestId: record.message_id ?? record.request_id ?? null,
  };
}

// Newest first. Only completed model calls, not the check of a key.
export function readModelCalls(file: string, since: string): ModelCall[] {
  let text: string;
  try {
    text = tail(file);
  } catch {
    return [];
  }
  const calls: ModelCall[] = [];
  const legacy: ModelCall[] = [];
  for (const line of text.split("\n")) {
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // an empty line, or one cut off by the tail
    }
    if (typeof record?.at !== "string" || record.at < since) continue;
    if (record.event === "call") {
      calls.push(fromCall(record));
      continue;
    }
    if (record.event !== "response") continue;
    if (String(record.path ?? "").endsWith("/models")) continue;
    legacy.push({
      at: record.at,
      provider: record.provider ?? null,
      model: record.model ?? null,
      status: record.status,
      tokensIn: record.tokens_in ?? null,
      tokensOut: record.tokens_out ?? null,
      seconds: secondsOf(record),
      requestId: record.request_id ?? null,
    });
  }
  // The plugin is authoritative when it is running. A relay may write to the same file; showing both would
  // double-count every turn.
  const chosen = calls.length ? calls : legacy;
  return chosen.slice(-LIMIT).reverse();
}
