// SAM 3.1 through the Meta Model API: which objects matching a text prompt are in a picture. Runs on the server, which
// holds the key. Calls go through the same relay as the agent's, so run.sh's terminal shows them too.
// Output format: https://dev.meta.ai/docs/sam/reading-segmentation
export type FoundBox = { id: number; x1: number; y1: number; x2: number; y2: number; w: number; h: number };

// One line per frame: <0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|><|mask;..|>,1<|box;..|><|mask;..|>
export function parseBoxes(text: string): FoundBox[] {
  const boxes: FoundBox[] = [];
  for (const match of text.matchAll(/(\d+)<\|box;([^|]*)\|>/g)) {
    const fields = Object.fromEntries(match[2].split(";").map((field) => field.split("=")));
    const box = { id: Number(match[1]), x1: +fields.x1, y1: +fields.y1, x2: +fields.x2, y2: +fields.y2, w: +fields.w, h: +fields.h };
    if (Object.values(box).every(Number.isFinite) && box.w > 0 && box.h > 0) boxes.push(box);
  }
  return boxes;
}

// The text of a Responses API event stream.
export function outputText(stream: string): string {
  let text = "";
  for (const line of stream.split("\n")) {
    if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
    try {
      const event = JSON.parse(line.slice(5));
      if (event.type === "response.output_text.delta") text += event.delta ?? "";
      if (event.type === "response.failed" || event.type === "error") {
        throw new Error(event.response?.error?.message ?? event.error?.message ?? "SAM 3.1 couldn't process that picture.");
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return text;
}

export async function segment(image: string, prompt: string, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch) {
  const key = env.MODEL_API_KEY;
  if (!key) throw new Error("Add MODEL_API_KEY to .env to use Find.");
  const base = (env.ROCKET_META_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
  const response = await fetchImpl(`${base}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      model: "sam-3.1",
      stream: true,
      metadata: { mask_encoding: "one_bit" },
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: image }] }],
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    let message = body.slice(0, 200);
    try {
      message = JSON.parse(body).error?.message ?? message;
    } catch {
      // Not JSON: keep the text.
    }
    throw new Error(`SAM 3.1: ${message}`);
  }
  return { boxes: parseBoxes(outputText(body)) };
}
