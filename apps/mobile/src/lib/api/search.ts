import { useCallback, useRef, useState } from "react";

import { api } from "./client";

export interface SearchCitation {
  meeting_id: string;
  meeting_title: string;
  start_sec: number;
  end_sec: number;
  excerpt: string;
  similarity: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type SearchPhase = "idle" | "searching" | "streaming" | "done" | "error";

/** Tokens arrive faster than the eye resolves; batching to ~20fps costs nothing visually. */
const FLUSH_INTERVAL_MS = 50;

export interface SearchController {
  phase: SearchPhase;
  question: string;
  answer: string;
  citations: SearchCitation[];
  error: string | null;
  ask: (query: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

/**
 * Cross-meeting semantic search.
 *
 * Two things shape this:
 *
 * Citations come back in the `x-citations` RESPONSE HEADER, which lands before
 * the body starts streaming. So "Searched 4 meetings" and the source cards can
 * render a second or two before the first token — the cheapest perceived-latency
 * win available on this screen.
 *
 * Tokens are buffered and flushed on an interval rather than appended per chunk.
 * Setting state per token re-lays out the whole answer on every character.
 */
export function useSearch(): SearchController {
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<SearchCitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef("");

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setPhase("idle");
    setQuestion("");
    setAnswer("");
    setCitations([]);
    setError(null);
  }, [stop]);

  const ask = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      stop();
      const controller = new AbortController();
      abortRef.current = controller;

      setQuestion(trimmed);
      setAnswer("");
      setCitations([]);
      setError(null);
      setPhase("searching");
      bufferRef.current = "";

      let flushTimer: ReturnType<typeof setInterval> | null = null;

      try {
        const { stream, response } = await api.apiStream("/search", {
          method: "POST",
          body: { query: trimmed, history: [], limit: 10 },
          signal: controller.signal,
        });

        // Header, so this is available before the first token.
        const raw = response.headers.get("x-citations");
        if (raw) {
          try {
            setCitations(JSON.parse(decodeURIComponent(raw)) as SearchCitation[]);
          } catch {
            // Malformed citations must not take the answer down with them.
          }
        }

        setPhase("streaming");

        flushTimer = setInterval(() => {
          if (bufferRef.current) {
            const chunk = bufferRef.current;
            bufferRef.current = "";
            setAnswer((prev) => prev + chunk);
          }
        }, FLUSH_INTERVAL_MS);

        for await (const chunk of stream) {
          bufferRef.current += chunk;
        }

        if (flushTimer) clearInterval(flushTimer);
        if (bufferRef.current) {
          setAnswer((prev) => prev + bufferRef.current);
          bufferRef.current = "";
        }
        setPhase("done");
      } catch (e) {
        if (flushTimer) clearInterval(flushTimer);
        if (controller.signal.aborted) {
          // Deliberate stop — keep whatever streamed.
          setPhase("done");
          return;
        }
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setPhase("error");
      } finally {
        abortRef.current = null;
      }
    },
    [stop],
  );

  return { phase, question, answer, citations, error, ask, stop, reset };
}
