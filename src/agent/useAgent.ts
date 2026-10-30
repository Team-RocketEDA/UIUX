import { useCallback, useEffect, useRef, useState } from "react";
import { emptyView, FuelClient, reduce, type SessionView } from "./fuel";

export type AgentMode = "mock" | "live" | "replay";

// The dev server proxies /agent to opencode (live) or the replay server and adds auth there,
// so no password or key ever reaches the browser. Electron main will play the same role.
const mode: AgentMode = import.meta.env.VITE_ROCKET_AGENT ?? "mock";
const client = new FuelClient({ baseUrl: `${window.location.origin}/agent` });

export type Agent = {
  mode: AgentMode;
  view: SessionView;
  connected: boolean;
  error?: string;
  send: (text: string, autonomy: "auto" | "approval") => Promise<void>;
  approve: (approvalId: string) => Promise<void>;
  reject: (approvalId: string) => Promise<void>;
  stop: () => Promise<void>;
};

export function useAgent(): Agent {
  const [view, setView] = useState<SessionView>(() => emptyView());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const sessionRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (mode === "mock") return;
    const controller = new AbortController();
    let retry: number | undefined;

    const connect = () => {
      setConnected(true);
      client
        .subscribe((event) => setView((current) => reduce(current, event)), controller.signal)
        .then(() => {
          setConnected(false);
          // A replay ends when the recording does; a live stream should come back.
          if (mode === "live" && !controller.signal.aborted) retry = window.setTimeout(connect, 2000);
        })
        .catch((err: unknown) => {
          setConnected(false);
          if (controller.signal.aborted) return;
          setError(`Agent unreachable: ${err instanceof Error ? err.message : String(err)}`);
          if (!controller.signal.aborted) retry = window.setTimeout(connect, 3000);
        });
    };
    connect();
    return () => {
      controller.abort();
      window.clearTimeout(retry);
    };
  }, []);

  const send = useCallback(async (text: string, autonomy: "auto" | "approval") => {
    if (mode !== "live") return;
    try {
      setError(undefined);
      if (!sessionRef.current) {
        sessionRef.current = await client.createSession("RocketEDA IDE");
        setView((current) => ({ ...current, sessionId: sessionRef.current }));
      }
      await client.prompt(sessionRef.current, text, autonomy === "auto" ? "rocket-auto" : "rocket-approval");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const answer = useCallback(async (approvalId: string, reply: "once" | "reject") => {
    if (mode !== "live") return;
    try {
      await client.reply(approvalId, reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const stop = useCallback(async () => {
    if (mode === "live" && sessionRef.current) await client.abort(sessionRef.current);
  }, []);

  return {
    mode,
    view,
    connected,
    error,
    send,
    approve: (id) => answer(id, "once"),
    reject: (id) => answer(id, "reject"),
    stop,
  };
}
