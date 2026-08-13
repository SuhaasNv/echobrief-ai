import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { formatClock } from "@/lib/format";
import { describeError, useOnline } from "@/lib/api/errors";
import { ErrorState } from "@/components/error-state";

import { Eyebrow } from "./eyebrow";
import { PillButton } from "./question";

/**
 * What went wrong with a question, and whether asking again can possibly help.
 *
 * The screen used to render one card for every failure, headed "Search failed",
 * with a "Try again" pill under it. On the demo account, which sits at 10 of 10
 * AI questions, that pill was an invitation to receive the identical error for
 * the rest of the month. A retry that cannot succeed is worse than no retry: it
 * tells the user the app is broken rather than that they are out of questions.
 *
 * The two 429s the search endpoint can return are genuinely different events and
 * are separated here:
 *
 *   quota_exceeded — the monthly AI-question allowance, from the quota
 *     middleware. Nothing the user does in the next hour changes it, so there is
 *     no retry at all; the card says when the allowance comes back instead.
 *
 *   rate_limited — the per-minute AI bucket. It clears on its own, so the retry
 *     stays, disabled, counting down, and becomes live at the exact moment it
 *     can work.
 *
 * CLASSIFIED FROM THE MESSAGE, WHICH IS NOT WHERE IT BELONGS. `ApiError` carries
 * `status` and a `code` of "quota_exceeded" or "rate_limited", but useSearch
 * flattens the error to `e.message` before this screen ever sees it, and
 * lib/api is owned elsewhere this round. The two server strings are matched
 * below. When the controller starts surfacing the code, delete `classify` and
 * switch on that: the rest of this file does not change.
 */

type AskFailure =
  /** Monthly allowance is spent. Retrying is pointless until the period rolls. */
  | { kind: "quota"; message: string }
  /** Per-minute bucket. Retrying works once the window closes. */
  | { kind: "throttled"; message: string; seconds: number }
  /** Anything else: a 500, a dropped socket, a malformed body. */
  | { kind: "generic"; message: string };

/** Server copy: "You've used 10 of 10 AI queries this month. Upgrade for unlimited." */
const QUOTA = /\d+\s+of\s+\d+\s+ai\s+quer/i;
/** Server copy: "Too many requests. Try again in 1 minute(s)." */
const THROTTLED = /too many requests/i;
const MINUTES = /in\s+(\d+)\s*minute/i;

function classify(message: string): AskFailure {
  if (QUOTA.test(message)) return { kind: "quota", message };

  if (THROTTLED.test(message)) {
    const minutes = Number.parseInt(MINUTES.exec(message)?.[1] ?? "", 10);
    // A minute is the free tier's AI window, and the only value the server can
    // currently send. It is the fallback rather than zero so that a message we
    // failed to parse still counts down to something reachable.
    const seconds = Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 60;
    return { kind: "throttled", message, seconds };
  }

  return { kind: "generic", message };
}

/**
 * When the monthly allowance comes back.
 *
 * The server buckets usage by UTC calendar month (`YYYY-MM`), so the boundary is
 * midnight UTC on the first. Rendered in the device's own zone, which is why
 * someone in Los Angeles is correctly told the 31st and someone in Berlin the
 * 1st: it is the same instant, described where they are standing.
 */
function nextPeriodStart(now: Date): string {
  const rollover = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return rollover.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function AskFailureCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  const online = useOnline();

  /**
   * Offline is handled BEFORE classification, because it is the one failure a
   * retry genuinely cannot fix and the whole app already has a component that
   * says so correctly.
   *
   * Ask was the one feature that never adopted the errors.ts contract every
   * other screen runs on: offline here fell through to the generic "Search
   * failed" card with a live "Try again" pill — the exact "retry that cannot
   * succeed" this file's own header condemns. describeError knows to withhold
   * the retry when the network is down, so ErrorState draws no button; the user
   * is told to reconnect, not to keep tapping.
   *
   * Computed here but branched on AFTER the hooks below, so the hook order stays
   * fixed — an early return above useMemo/useState/useEffect would break the
   * rules of hooks the first time the network dropped.
   */
  const offlineCopy = !online
    ? describeError(new Error(error), { online, subject: "an answer" })
    : null;

  const failure = useMemo(() => classify(error), [error]);

  // Seconds left on a per-minute limit. Zero for every other kind, which is
  // also what an expired countdown reads as, so the button has one condition.
  const [remaining, setRemaining] = useState(0);

  const { kind } = failure;
  const seconds = failure.kind === "throttled" ? failure.seconds : 0;

  useEffect(() => {
    if (kind !== "throttled") {
      setRemaining(0);
      return;
    }

    const deadline = Date.now() + seconds * 1000;
    setRemaining(seconds);

    // A whole-second tick against a fixed deadline, not a decrement: a
    // decrementing counter drifts by however long the app spent in the
    // background, and would still be counting after the window had passed.
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [error, kind, seconds]);

  // Offline wins over any classification: the message might match the quota or
  // throttle regex by coincidence, but if the network is down none of those
  // cards' advice applies.
  if (offlineCopy) {
    return <ErrorState title={offlineCopy.title} body={offlineCopy.body} />;
  }

  if (failure.kind === "quota") {
    return (
      <View
        className="gap-2.5 rounded-card border border-edge bg-surface p-4"
        style={{ borderCurve: "continuous" }}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        {/* Not the danger palette. Nothing failed and nothing is wrong with the
            account; a plan ran out of room, which is a fact about the plan. */}
        <Eyebrow>Out of questions this month</Eyebrow>
        <Text className="text-[15px] leading-[21px] text-label">{failure.message}</Text>
        <Text className="text-[15px] leading-[21px] text-label-secondary">
          {`They come back on ${nextPeriodStart(new Date())}. Account, then Plan, shows what is left of every allowance.`}
        </Text>
        {/* No retry. There is nothing on the other side of it until the month
            turns over, and the composer is still there for the moment it does. */}
      </View>
    );
  }

  if (failure.kind === "throttled") {
    const ready = remaining <= 0;
    return (
      <View
        className="gap-2.5 rounded-card border border-edge bg-surface p-4"
        style={{ borderCurve: "continuous" }}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <Eyebrow>Too many questions at once</Eyebrow>
        <Text className="text-[15px] leading-[21px] text-label-secondary">
          This account has asked more questions in the last minute than the plan allows. The limit
          clears on its own.
        </Text>
        <PillButton
          label={ready ? "Try again" : `Try again in ${formatClock(remaining)}`}
          disabled={!ready}
          onPress={onRetry}
          accessibilityHint={
            ready ? "Runs the same question again" : "Available when the countdown ends"
          }
        />
      </View>
    );
  }

  return (
    <View
      className="gap-2.5 rounded-card border border-danger/40 bg-danger/10 p-4"
      style={{ borderCurve: "continuous" }}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Eyebrow>Search failed</Eyebrow>
      <Text className="text-[15px] leading-[21px] text-danger">{failure.message}</Text>
      <PillButton
        label="Try again"
        onPress={onRetry}
        accessibilityHint="Runs the same question again"
      />
    </View>
  );
}
