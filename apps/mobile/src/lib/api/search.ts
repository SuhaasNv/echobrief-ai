import { useCallback, useRef, useState } from "react";
// Subpath rather than the barrel — see the note in components/ask/action.tsx.
import {
  describeAskPlan,
  parseAskActionPlan,
  type AskActionPlan,
} from "@echobrief/shared/ask-actions";

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
  /**
   * Settled exchanges, oldest first, excluding the one in flight.
   *
   * This is what makes a follow-up possible. The endpoint has always accepted a
   * `history` array — see routes/search.ts, which destructures it and passes it
   * to the model — but the client sent a hardcoded `[]` on every request, so
   * every question started cold and "what about the budget?" resolved against
   * nothing.
   */
  turns: ChatTurn[];
  /**
   * Set when the turn was an INSTRUCTION rather than a question.
   *
   * Mutually exclusive with `answer` by construction: the endpoint sends either
   * a streamed answer or an empty body plus this plan, never both. Nothing here
   * has been executed — see components/ask/action.tsx, which is what decides
   * between running it and asking first.
   */
  action: AskActionPlan | null;
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
  const [action, setAction] = useState<AskActionPlan | null>(null);

  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef("");
  /**
   * Read by `ask` when building the request. A ref, not the state, so sending a
   * question does not have to re-create `ask` on every turn — the screen holds
   * it in a callback and a new identity each turn would churn the composer.
   */
  const turnsRef = useRef<ChatTurn[]>([]);
  /**
   * The exchange that just finished, held back until the NEXT question.
   *
   * Committing on completion instead was wrong: `question` and `answer` keep
   * holding the finished exchange after `phase` flips to "done", so the screen
   * rendered it once from `turns` and again as the live one — the same text
   * twice, and a scroll view twice as tall as its content.
   *
   * Sealing it at the start of the next ask means the live exchange is never
   * also a settled one, and the history still reaches the request because this
   * runs before the body is built.
   */
  const lastExchangeRef = useRef<{ question: string; answer: string } | null>(null);

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
    setAction(null);
    setTurns([]);
    turnsRef.current = [];
    lastExchangeRef.current = null;
  }, [stop]);

  const ask = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      stop();
      const controller = new AbortController();
      abortRef.current = controller;

      // Seal the previous exchange first, so it is both in the history this
      // request sends and in the thread the screen draws above the new answer.
      const parked = lastExchangeRef.current;
      if (parked) {
        const next: ChatTurn[] = [
          ...turnsRef.current,
          { role: "user", content: parked.question },
          { role: "assistant", content: parked.answer },
        ];
        turnsRef.current = next;
        lastExchangeRef.current = null;
        setTurns(next);
      }

      setQuestion(trimmed);
      setAnswer("");
      setCitations([]);
      setError(null);
      setAction(null);
      setPhase("searching");
      bufferRef.current = "";

      let flushTimer: ReturnType<typeof setInterval> | null = null;
      // Accumulated separately from `answer`: that state is written by a 50ms
      // flush timer and is therefore always a little behind, which would commit
      // a truncated turn to the history.
      let full = "";

      /**
       * Park the finished exchange. It joins `turns` when the next one starts.
       *
       * Runs on a clean finish AND on a deliberate stop, because a half-read
       * answer the user cut off is still something they can ask about.
       */
      const parkTurn = () => {
        if (!full) return;
        lastExchangeRef.current = { question: trimmed, answer: full };
      };

      try {
        const { stream, response } = await api.apiStream("/search", {
          method: "POST",
          body: { query: trimmed, history: turnsRef.current, limit: 10 },
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

        /**
         * An instruction turn. Same header trick as citations, for the same
         * reason — it lands before the (empty) body.
         *
         * VALIDATED, NOT CAST. Every other header on this endpoint is
         * decoration; this one decides whether a Delete button appears on
         * screen, so a malformed or truncated envelope must produce no card at
         * all rather than a half-built one. parseAskActionPlan returns null on
         * anything it does not fully recognise, and the turn then falls through
         * to the normal empty-answer path — the safe direction.
         */
        const rawAction = response.headers.get("x-ask-action");
        if (rawAction) {
          // JSON.parse throws on a truncated header, so the decode is inside
          // the guard too.
          let decoded: unknown = null;
          try {
            decoded = JSON.parse(decodeURIComponent(rawAction)) as unknown;
          } catch {
            decoded = null;
          }

          const plan = parseAskActionPlan(decoded);
          if (plan) {
            setAction(plan);
            // The thread needs a line for this turn, both to redraw above the
            // next question and to give the answering model an assistant half.
            // Composed from typed fields — no generated prose enters the
            // conversation. See describeAskPlan.
            full = describeAskPlan(plan);
          }
        }

        // Deliberately not "streaming" on an action turn: no tokens are coming,
        // and flipping through a state that renders a live answer card would
        // put a violet caret on screen for a turn that produces no answer.
        if (!rawAction) setPhase("streaming");

        flushTimer = setInterval(() => {
          if (bufferRef.current) {
            const chunk = bufferRef.current;
            bufferRef.current = "";
            setAnswer((prev) => prev + chunk);
          }
        }, FLUSH_INTERVAL_MS);

        for await (const chunk of stream) {
          bufferRef.current += chunk;
          full += chunk;
        }

        if (flushTimer) clearInterval(flushTimer);
        if (bufferRef.current) {
          setAnswer((prev) => prev + bufferRef.current);
          bufferRef.current = "";
        }
        parkTurn();
        setPhase("done");
      } catch (e) {
        if (flushTimer) clearInterval(flushTimer);
        if (controller.signal.aborted) {
          // Deliberate stop — keep whatever streamed, and keep it askable.
          if (bufferRef.current) {
            setAnswer((prev) => prev + bufferRef.current);
            bufferRef.current = "";
          }
          parkTurn();
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

  return { phase, question, answer, citations, error, turns, action, ask, stop, reset };
}
