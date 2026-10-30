import { useCallback, useEffect, useRef, useState } from "react";
import { emptyView, FuelClient, reduce, type SessionView } from "./fuel";

export type AgentMode = "live" | "replay";

// The workspace server proxies /agent to the open project's agent and adds auth there, so no
// password or key ever reaches the browser. VITE_ROCKET_AGENT=replay streams a recording instead.
const mode: AgentMode = import.meta.env.VITE_ROCKET_AGENT === "replay" ? "replay" : "live";
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
    const controller = new AbortController();
    let retry: number | undefined;

    const connect = () => {
      setConnected(true);
      client
        .subscribe((event) => {
          setError(undefined);
          setView((current) => reduce(current, event));
        }, controller.signal)
        .then(() => {
          // A cancelled connection (unmount, or React's dev double-mount) must not touch state:
          // it would mark the newer, live connection as offline.
          if (controller.signal.aborted) return;
          setConnected(false);
          // A replay ends when the recording does; a live stream should come back.
          if (mode === "live") retry = window.setTimeout(connect, 2000);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setConnected(false);
          // 503 = the agent for this project is still starting; keep retrying quietly.
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("503")) setError(`Agent unreachable: ${message}`);
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
