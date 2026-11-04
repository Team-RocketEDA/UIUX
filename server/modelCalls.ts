// The Meta Model API calls this run has made, for the panel in the app. They come from the relay's log, which holds
// the model the API reported, the status, tokens and timing, and never a key or a prompt.
import { closeSync, openSync, readSync, statSync } from "node:fs";

export type ModelCall = { at: string; model: string | null; status: number; tokensIn: number | null; tokensOut: number | null; seconds: number; requestId: string | null };

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

// Newest first. Only completed chat, image and segmentation calls, not the check of a key.
export function readModelCalls(file: string, since: string): ModelCall[] {
  let text: string;
  try {
    text = tail(file);
  } catch {
    return [];
  }
  const calls: ModelCall[] = [];
  for (const line of text.split("\n")) {
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // an empty line, or one cut off by the tail
    }
    if (record?.event !== "response" || typeof record.at !== "string" || record.at < since) continue;
    if (String(record.path ?? "").endsWith("/models")) continue;
    calls.push({
      at: record.at,
      model: record.model ?? null,
      status: record.status,
      tokensIn: record.tokens_in ?? null,
      tokensOut: record.tokens_out ?? null,
      seconds: record.seconds ?? 0,
      requestId: record.request_id ?? null,
    });
  }
  return calls.slice(-LIMIT).reverse();
}
