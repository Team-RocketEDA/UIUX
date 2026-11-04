import { useCallback, useEffect, useRef, useState } from "react";
import { emptyView, FuelClient, reduce, type Attachment, type SessionView } from "./fuel";

export type AgentMode = "live" | "replay";

// The workspace server proxies /agent to the open project's agent and adds auth there, so no
// password or key ever reaches the browser. A recorded session is recognised when it arrives: replay_server.py
// starts its stream with a rocket.replay event (./run.sh replay), and VITE_ROCKET_AGENT=replay also forces it.
const builtForReplay = import.meta.env.VITE_ROCKET_AGENT === "replay";
const client = new FuelClient({ baseUrl: `${window.location.origin}/agent` });

// Who answers: the design agent (on Muse Spark, asking first or not), the tutor (Learn mode, on Muse Spark) or the
// independent reviewer (Second opinion, on Muse Wonder).
export type Profile = "auto" | "approval" | "tutor" | "reviewer";
const PROFILES: Record<Profile, string> = {
  auto: "rocket-auto",
  approval: "rocket-approval",
  tutor: "rocket-tutor",
  reviewer: "rocket-reviewer",
};

export type Agent = {
  mode: AgentMode;
  view: SessionView;
  connected: boolean;
  error?: string;
  send: (text: string, profile: Profile, files?: Attachment[]) => Promise<void>;
  approve: (approvalId: string) => Promise<void>;
  reject: (approvalId: string) => Promise<void>;
  stop: () => Promise<void>;
};

export function useAgent(): Agent {
  const [view, setView] = useState<SessionView>(() => emptyView());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const sessionRef = useRef<string | undefined>(undefined);
  const replayRef = useRef(builtForReplay);
  const mode: AgentMode = builtForReplay || view.replay ? "replay" : "live";

  useEffect(() => {
    const controller = new AbortController();
    let retry: number | undefined;

    const connect = async () => {
      if (controller.signal.aborted) return;
      setConnected(true);
      // Catch up once the stream is open, not before: a reply that lands between the two would otherwise be lost. It
      // matters on every connection, because the agent may have restarted (a new key) and answered in the meantime.
      let caughtUp = false;
      client
        .subscribe((event) => {
          setError(undefined);
          if (event.type === "rocket.replay") replayRef.current = true;
          setView((current) => reduce(current, event));
          if (!caughtUp) {
            caughtUp = true;
            void restore();
          }
        }, controller.signal)
        .then(() => {
          // A cancelled connection (unmount, or React's dev double-mount) must not touch state:
          // it would mark the newer, live connection as offline.
          if (controller.signal.aborted) return;
          setConnected(false);
          // A replay ends when the recording does; a live stream should come back.
          if (!replayRef.current) retry = window.setTimeout(connect, 2000);
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
    // Pick the project's latest conversation back up (page reload, reopening the project), then stream.
    const restore = async () => {
      if (replayRef.current) return;
      try {
        const sessionId = sessionRef.current ?? (await client.latestSession());
        if (!sessionId || controller.signal.aborted) return;
        const events = await client.history(sessionId);
        // A message sent meanwhile started its own session; keep that one.
        if (controller.signal.aborted || (sessionRef.current && sessionRef.current !== sessionId)) return;
        sessionRef.current = sessionId;
        // Added to what the stream has delivered meanwhile, which is at least as new.
        setView((current) => events.reduce(reduce, current.sessionId === sessionId ? current : emptyView(sessionId)));
      } catch {
        // Agent still starting; connect() tries again with the stream.
      }
    };
    void connect();
    return () => {
      controller.abort();
      window.clearTimeout(retry);
    };
  }, []);

  const send = useCallback(async (text: string, profile: Profile, files: Attachment[] = []) => {
    if (replayRef.current) return;
    try {
      setError(undefined);
      if (!sessionRef.current) {
        sessionRef.current = await client.createSession("RocketIDE");
        setView((current) => ({ ...current, sessionId: sessionRef.current }));
      }
      await client.prompt(sessionRef.current, text, PROFILES[profile], files);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.includes("503") ? "The assistant is starting. Try again in a moment." : message);
    }
  }, []);

  const answer = useCallback(async (approvalId: string, reply: "once" | "reject") => {
    if (replayRef.current) return;
    try {
      await client.reply(approvalId, reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const stop = useCallback(async () => {
    if (!replayRef.current && sessionRef.current) await client.abort(sessionRef.current);
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
