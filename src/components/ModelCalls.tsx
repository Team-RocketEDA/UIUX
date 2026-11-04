import { useEffect, useState } from "react";
import { api, type ModelCall } from "../api";

const POLL_MS = 2500;

// The Meta Model API calls this run has made, from the same log as the terminal's lines.
export function useModelCalls(replay: boolean): ModelCall[] {
  const [calls, setCalls] = useState<ModelCall[]>([]);
  useEffect(() => {
    if (replay) return;
    const load = () => void api.modelCalls().then(setCalls).catch(() => undefined);
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [replay]);
  return calls;
}

const tokens = (call: ModelCall) => (call.tokensIn === null && call.tokensOut === null ? "" : `${call.tokensIn ?? 0}→${call.tokensOut ?? 0} tok`);

// One quiet line above the composer: what just ran, as Meta's API reported it.
export function LastModelCall({ calls }: { calls: ModelCall[] }) {
  const call = calls[0];
  if (!call) return null;
  return (
    <div className="model-last" title={`Last call to the Meta Model API. The model name comes from the API's response.${calls.length > 1 ? " All calls are under Activity." : ""}`}>
      <span className={`model-dot ${call.status >= 400 ? "failed" : ""}`} />
      <span>
        {[call.model ?? `HTTP ${call.status}`, tokens(call), `${call.seconds.toFixed(1)} s`].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

export function ModelCallList({ calls }: { calls: ModelCall[] }) {
  if (!calls.length) return null;
  return (
    <section className="model-calls" aria-label="Meta Model API calls">
      <span className="eyebrow">Meta Model API calls ({calls.length})</span>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Model</th>
            <th>Status</th>
            <th>Tokens</th>
            <th>Took</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={`${call.at}-${call.requestId ?? ""}`}>
              <td>{new Date(call.at).toLocaleTimeString()}</td>
              <td>{call.model ?? "-"}</td>
              <td>{call.status}</td>
              <td>{tokens(call).replace(" tok", "")}</td>
              <td>{call.seconds.toFixed(1)} s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
