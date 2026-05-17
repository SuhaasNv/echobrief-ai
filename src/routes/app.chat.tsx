import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ArrowUp,
  Plus,
  FileAudio,
  Search,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { streamMeetingChat, useMeetings } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/client";
import { useLabels } from "@/lib/workspace-store";

export const Route = createFileRoute("/app/chat")({
  head: () => ({ meta: [{ title: "AI Chat — EchoBrief" }] }),
  component: ChatPage,
});

interface Msg {
  role: "user" | "ai";
  content: string;
  streaming?: boolean;
}

function suggestedPromptsFor(title: string): string[] {
  return [
    `Give me a 3-bullet summary of "${title}"`,
    "What decisions were made and by whom?",
    "List the action items with owners and due dates",
    "What were the open questions left for next time?",
  ];
}

function ChatPage() {
  const meetings = useMeetings({ status: "complete", limit: 50 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const labels = useLabels();
  // One thread per meeting — keep them in memory so switching meetings doesn't wipe context.
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const items = meetings.data?.items ?? [];
  const filtered = useMemo(
    () =>
      filter.trim()
        ? items.filter((m) => m.title.toLowerCase().includes(filter.toLowerCase()))
        : items,
    [items, filter],
  );

  const selected = items.find((m) => m.id === selectedId) ?? null;
  const messages: Msg[] = selectedId ? threads[selectedId] ?? [] : [];

  // Auto-select the first complete meeting once data lands.
  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0].id);
  }, [items, selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || !selectedId || sending) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const meetingId = selectedId;
    const prior = threads[meetingId] ?? [];
    const history = prior.map((m) => ({
      role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

    setThreads((t) => ({
      ...t,
      [meetingId]: [
        ...prior,
        { role: "user", content: message },
        { role: "ai", content: "", streaming: true },
      ],
    }));
    setInput("");
    setSending(true);

    try {
      const { stream } = await streamMeetingChat(
        meetingId,
        { message, history },
        abortRef.current.signal,
      );

      for await (const chunk of stream) {
        setThreads((t) => {
          const cur = t[meetingId];
          if (!cur) return t;
          const lastIdx = cur.length - 1;
          const last = cur[lastIdx];
          if (!last || last.role !== "ai") return t;
          // Pure replace — never mutate. React StrictMode double-invokes
          // setState updaters in dev, so `last.content += chunk` would have
          // doubled every token.
          const next = [...cur];
          next[lastIdx] = { ...last, content: last.content + chunk };
          return { ...t, [meetingId]: next };
        });
      }

      setThreads((t) => {
        const cur = t[meetingId];
        if (!cur) return t;
        const lastIdx = cur.length - 1;
        const last = cur[lastIdx];
        if (!last || last.role !== "ai") return t;
        const next = [...cur];
        next[lastIdx] = { ...last, streaming: false };
        return { ...t, [meetingId]: next };
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Chat failed";
      toast.error(msg);
      setThreads((t) => {
        const cur = t[meetingId];
        if (!cur) return t;
        const lastIdx = cur.length - 1;
        const last = cur[lastIdx];
        if (!last || last.role !== "ai" || !last.streaming) return t;
        const next = [...cur];
        next[lastIdx] = { ...last, streaming: false, content: `_${msg}_` };
        return { ...t, [meetingId]: next };
      });
    } finally {
      setSending(false);
    }
  }

  function newChat() {
    if (!selectedId) return;
    abortRef.current?.abort();
    setThreads((t) => ({ ...t, [selectedId]: [] }));
    setInput("");
  }

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Meeting picker */}
      <aside className="hidden flex-col border-r border-border/60 bg-sidebar/40 lg:flex">
        <div className="border-b border-border/60 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Talk to a meeting
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick one — the AI grounds its answers on that meeting's transcript.
          </p>
          <div className="mt-3 flex items-center gap-1.5 rounded-md border border-border/60 bg-surface/60 px-2 py-1.5 text-xs">
            <Search className="h-3 w-3 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter meetings"
              className="w-full bg-transparent placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          {selected && (
            <button
              onClick={newChat}
              className="mt-3 inline-flex w-full items-center gap-1.5 rounded-md border border-border/70 bg-surface px-2.5 py-1.5 text-xs hover:bg-accent"
            >
              <Plus className="h-3 w-3" /> New chat for this meeting
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {meetings.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">
              No completed meetings yet. Upload one to start chatting.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">No matches.</p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((m) => {
                const active = m.id === selectedId;
                const hasThread = (threads[m.id]?.length ?? 0) > 0;
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => setSelectedId(m.id)}
                      className={`group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        active
                          ? "bg-accent text-foreground"
                          : "text-sidebar-foreground/85 hover:bg-accent/60 hover:text-foreground"
                      }`}
                    >
                      <FileAudio className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{m.title}</p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {new Date(m.created_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                          {hasThread && " · ✦ active thread"}
                        </p>
                      </div>
                      {active && <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex min-h-0 flex-col">
        {selected && (
          <div className="border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur-md md:px-8">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              <p className="text-sm font-medium">{selected.title}</p>
              <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-mono text-[10px] text-success">
                {selected.action_item_count} actions · {selected.participant_count} speakers
              </span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
            {!selected ? (
              <div className="mt-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-violet shadow-glow">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <h1 className="mt-6 text-2xl font-semibold tracking-tight">Pick a {labels.meeting.singular.toLowerCase()} to chat with.</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a {labels.meeting.singular.toLowerCase()} from the left and ask the AI anything about it —
                  decisions, key topics, who said what, follow-ups for next time.
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="mt-12 text-center">
                <h2 className="text-lg font-medium">Ask anything about &ldquo;{selected.title}&rdquo;</h2>
                <p className="mt-1 text-sm text-muted-foreground">Try one of these:</p>
                <div className="mx-auto mt-6 grid max-w-xl gap-2">
                  {suggestedPromptsFor(selected.title).map((p) => (
                    <button
                      key={p}
                      onClick={() => send(p)}
                      disabled={sending}
                      className="rounded-lg border border-border/70 bg-surface px-4 py-3 text-left text-sm transition-colors hover:border-border hover:bg-surface-elevated disabled:opacity-50"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <AnimatePresence initial={false}>
                  {messages.map((m, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      {m.role === "user" ? (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm">
                            {m.content}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand to-violet">
                            <Sparkles className="h-3.5 w-3.5 text-white" />
                          </div>
                          <div className="min-w-0 flex-1">
                            {m.content === "" && m.streaming ? (
                              <div className="flex items-center gap-1.5 py-2 text-sm text-muted-foreground">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" style={{ animationDelay: "150ms" }} />
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" style={{ animationDelay: "300ms" }} />
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/95">
                                {m.content}
                                {m.streaming && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground/60" />}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={endRef} />
              </div>
            )}
          </div>
        </div>

        {selected && (
          <div className="border-t border-border/60 bg-background/80 px-4 py-4 backdrop-blur md:px-8">
            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border/70 bg-surface p-2 transition-colors focus-within:border-border focus-within:bg-surface-elevated"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
                }}
                rows={1}
                placeholder={`Ask about "${selected.title}"…`}
                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </form>
            <p className="mx-auto mt-2 flex max-w-3xl items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-success" /> Grounded on the meeting's transcript — answers cite real content.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
