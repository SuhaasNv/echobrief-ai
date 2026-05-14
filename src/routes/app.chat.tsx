import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowUp, FileAudio, Plus, Clock } from "lucide-react";

export const Route = createFileRoute("/app/chat")({
  head: () => ({ meta: [{ title: "AI Chat — EchoBrief" }] }),
  component: ChatPage,
});

const suggested = [
  "What decisions were made this week?",
  "Summarize blockers across all engineering meetings",
  "What did John say about pricing?",
  "List all action items assigned to me",
];

const conversations = [
  { t: "Today", items: ["Q3 launch decisions", "Acme account summary"] },
  { t: "This week", items: ["Pricing discussions", "Engineering blockers", "Hiring plan recap"] },
  { t: "Earlier", items: ["Q2 retrospective", "All design reviews"] },
];

type Msg = { role: "user" | "ai"; content: string; sources?: string[]; streaming?: boolean };

const reply =
  "Across the last 4 leadership meetings, three pricing decisions stand out:\n\n1. Move the Pro tier from $24 → $29, effective September 1.\n2. Introduce a Team plan at $79/seat with workspace analytics.\n3. Sunset the legacy Starter tier by end of year — confirmed in Q3 Planning.\n\nThe consistent through-line was simplifying the pricing page before launch, which David is owning.";

function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(text: string) {
    if (!text.trim()) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setMessages((m) => [...m, { role: "ai", content: "", streaming: true }]);

    let i = 0;
    const interval = setInterval(() => {
      i += Math.max(1, Math.round(reply.length / 60));
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === "ai") {
          last.content = reply.slice(0, i);
          if (i >= reply.length) {
            last.streaming = false;
            last.sources = ["Pricing Sync · Aug 12", "Exec Review · Aug 19", "Sales QBR · Aug 26", "Q3 Planning · Today"];
          }
        }
        return copy;
      });
      if (i >= reply.length) clearInterval(interval);
    }, 35);
  }

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden border-r border-border/60 bg-sidebar/40 p-4 lg:block">
        <button className="mb-4 flex w-full items-center gap-2 rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm hover:bg-accent">
          <Plus className="h-3.5 w-3.5" /> New chat
        </button>
        {conversations.map((g) => (
          <div key={g.t} className="mt-5">
            <p className="px-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{g.t}</p>
            <div className="mt-1 space-y-0.5">
              {g.items.map((c) => (
                <button
                  key={c}
                  className="flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground/85 hover:bg-accent"
                >
                  <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                  {c}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <div className="flex min-h-0 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
            {messages.length === 0 ? (
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-violet shadow-glow">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <h1 className="mt-6 text-2xl font-semibold tracking-tight">Ask anything about your meetings.</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  EchoBrief has indexed 247 meetings. Try one of these:
                </p>
                <div className="mx-auto mt-8 grid max-w-xl gap-2">
                  {suggested.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-lg border border-border/70 bg-surface px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:border-border hover:bg-surface-elevated"
                    >
                      {s}
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
                              <>
                                <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/95">
                                  {m.content}
                                  {m.streaming && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground/60" />}
                                </div>
                                {m.sources && (
                                  <div className="mt-4">
                                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Sources</p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {m.sources.map((s) => (
                                        <span
                                          key={s}
                                          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface px-2 py-1 font-mono text-[10px] text-muted-foreground"
                                        >
                                          <FileAudio className="h-2.5 w-2.5" /> {s}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
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

        {/* Composer */}
        <div className="border-t border-border/60 bg-background/80 px-4 py-4 backdrop-blur md:px-8">
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border/70 bg-surface p-2 transition-colors focus-within:border-border focus-within:bg-surface-elevated"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Ask about any meeting…"
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">
            EchoBrief AI can make mistakes. Verify important details against the transcript.
          </p>
        </div>
      </div>
    </div>
  );
}
