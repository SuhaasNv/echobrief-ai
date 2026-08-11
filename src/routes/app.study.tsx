import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, GraduationCap, Check, RotateCcw, ArrowRight, Sparkle } from "lucide-react";
import { useReviewQueue, useUpdateFlashcard, type FlashcardWithMeeting } from "@/lib/api/hooks";
import { useActiveWorkspaceKind } from "@/lib/workspace-store";

export const Route = createFileRoute("/app/study")({
  head: () => ({ meta: [{ title: "Study — EchoBrief" }] }),
  component: StudyGate,
});

function StudyGate() {
  const kind = useActiveWorkspaceKind();
  const navigate = useNavigate();
  useEffect(() => {
    if (kind === "professional") {
      navigate({ to: "/app", replace: true });
    }
  }, [kind, navigate]);
  if (kind === "professional") return null;
  return <StudyPage />;
}

function StudyPage() {
  const { data, isLoading, isError } = useReviewQueue(30);
  const update = useUpdateFlashcard();
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, gotIt: 0 });

  // Snapshot the queue once per session. `gotIt` marks a card reviewed, which
  // invalidates the flashcards query; the server re-sorts by
  // last_reviewed_at ASC NULLS FIRST, so the card just answered jumps to the
  // end and every other card shifts down one — while `index` has already moved
  // forward. On a live list that silently skips every second card.
  const [deck, setDeck] = useState<FlashcardWithMeeting[] | null>(null);
  useEffect(() => {
    if (deck === null && data?.items) setDeck(data.items);
  }, [deck, data]);

  const cards = deck ?? [];
  const card = cards[index];

  // Keyboard nav: Space = flip, J = review again, K = got it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!card) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setShowAnswer((s) => !s);
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        gotIt();
      } else if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        reviewAgain();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, showAnswer]);

  const advance = () => {
    setShowAnswer(false);
    setIndex((i) => i + 1);
  };

  const gotIt = () => {
    if (!card) return;
    update.mutate({ id: card.id, mark_reviewed: true });
    setSessionStats((s) => ({ reviewed: s.reviewed + 1, gotIt: s.gotIt + 1 }));
    advance();
  };

  const reviewAgain = () => {
    if (!card) return;
    // Don't mark reviewed — keeps card at the top of the queue next time.
    setSessionStats((s) => ({ reviewed: s.reviewed + 1, gotIt: s.gotIt }));
    advance();
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load your review queue.</p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <GraduationCap className="mx-auto h-10 w-10 text-violet" strokeWidth={1.4} />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">No flashcards yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open a lecture and click{" "}
          <span className="font-medium text-foreground">Generate flashcards</span> to start building
          your study deck.
        </p>
        <Link
          to="/app/meetings"
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
        >
          Go to lectures <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <Sparkle className="mx-auto h-10 w-10 text-brand" strokeWidth={1.4} />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Session complete</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {sessionStats.gotIt} of {sessionStats.reviewed} marked as known.
        </p>
        <button
          type="button"
          onClick={() => {
            setIndex(0);
            setSessionStats({ reviewed: 0, gotIt: 0 });
            // Drop the snapshot so the next session picks up the re-sorted
            // queue rather than replaying this one.
            setDeck(null);
          }}
          className="mt-6 inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-3 py-1.5 text-sm transition-colors hover:bg-accent"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Start a new session
        </button>
      </div>
    );
  }

  const progress = cards.length > 0 ? ((index + 1) / cards.length) * 100 : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5 text-violet" /> Study mode
        </span>
        <span className="font-mono">
          {index + 1} / {cards.length}
        </span>
      </div>
      <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-border">
        <motion.div
          className="h-full bg-brand"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={card.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="mt-8 rounded-2xl border border-border/70 bg-surface p-8 shadow-elegant"
        >
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            From: {card.meeting_title}
          </p>
          <h2 className="mt-3 text-2xl font-semibold leading-snug">{card.question}</h2>

          <AnimatePresence initial={false}>
            {showAnswer && (
              <motion.div
                key="answer"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
                className="overflow-hidden"
              >
                <div className="mt-6 rounded-lg border border-border/60 bg-background/60 p-4 text-sm leading-relaxed">
                  {card.answer}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!showAnswer ? (
            <button
              type="button"
              onClick={() => setShowAnswer(true)}
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-foreground py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Reveal answer
              <kbd className="ml-2 rounded border border-background/30 px-1.5 py-0.5 font-mono text-[9px]">
                Space
              </kbd>
            </button>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={reviewAgain}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-surface py-2 text-sm transition-colors hover:bg-accent"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Review again
                <kbd className="rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px]">
                  J
                </kbd>
              </button>
              <button
                type="button"
                onClick={gotIt}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-foreground py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <Check className="h-3.5 w-3.5" /> Got it
                <kbd className="rounded border border-background/30 px-1.5 py-0.5 font-mono text-[9px]">
                  K
                </kbd>
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Space to flip · J to review again · K when you've got it
      </p>
    </div>
  );
}
