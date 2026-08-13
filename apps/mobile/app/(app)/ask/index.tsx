import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Keyboard, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useMeetings } from "@/lib/api/meetings";
import { useSearch } from "@/lib/api/search";
import { haptics } from "@/lib/haptics";
import { AnswerCard } from "@/components/ask/answer";
import { Composer } from "@/components/ask/composer";
import { AskEmptyState } from "@/components/ask/empty-state";
import { AskFailureCard } from "@/components/ask/failure";
import { PillButton, QuestionHeader } from "@/components/ask/question";
import { SearchStatus } from "@/components/ask/search-status";
import { SourcesRail } from "@/components/ask/sources";

/**
 * Ask — cross-meeting search.
 *
 * The screen is built around one fact about the endpoint: citations come back
 * in a response HEADER, so they land before the first answer token. That means
 * the page can fill top-down in the order the data actually arrives —
 *
 *   1. the question, restated as a headline
 *   2. "Searching N meetings" with a live retrieval sweep
 *   3. the real source cards, a second or more before any answer exists
 *   4. the answer streaming into a card beneath them
 *
 * — and the wait stops being a spinner. Ordering the layout this way is the
 * whole design: it is a genuine perceived-latency win, so it is made visible
 * rather than hidden behind a single "thinking" state.
 *
 * Violet is spent only on the answer band. Blue stays on things that navigate,
 * which on this screen means the source timestamps.
 */
export default function AskScreen() {
  const search = useSearch();
  const { ask, stop, reset } = search;
  /**
   * The composer sits ON the tab bar, 8pt off its top edge.
   *
   * `insets.bottom` under native tabs is already the distance to the bar's top
   * edge (49pt bar + 34pt home indicator on a 402x874 device);
   * `useTabBarInset()` adds the bar's height a second time, which is what left
   * the composer hanging 65pt above the bar with nothing in the band. Measured
   * from device pixels; the same double count was leaving a 60pt hole under the
   * player and 65pt under the record button. See components/player/metrics.
   */
  const composerInset = useSafeAreaInsets().bottom + 8;
  const reduceMotion = useReducedMotion();

  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  /** Follow the tail of the stream until the user scrolls away from it. */
  const stickRef = useRef(true);
  /** Guards the completion announcement so it fires once, never per token. */
  const settledRef = useRef(true);

  // Shares the meetings tab's cache, so this costs nothing on a warm app and
  // lets the search phase name a real number instead of "your meetings".
  const meetings = useMeetings();
  const meetingCount = meetings.data?.pages[0]?.total ?? null;

  const busy = search.phase === "searching" || search.phase === "streaming";
  const idle = search.phase === "idle";

  /**
   * The thread, as question/answer pairs.
   *
   * `turns` is the wire shape the endpoint wants — a flat alternating array —
   * so it is paired here rather than stored twice. Stepping by two is safe
   * because commitTurn appends both halves together or neither.
   */
  const settled = useMemo(() => {
    const pairs: { question: string; answer: string }[] = [];
    for (let i = 0; i + 1 < search.turns.length; i += 2) {
      pairs.push({
        question: search.turns[i]?.content ?? "",
        answer: search.turns[i + 1]?.content ?? "",
      });
    }
    return pairs;
  }, [search.turns]);

  const submit = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      // The keyboard covers the answer it is about to produce.
      Keyboard.dismiss();
      haptics.tap();
      setInput("");
      stickRef.current = true;
      settledRef.current = false;
      void ask(trimmed);
    },
    [ask],
  );

  const onStop = useCallback(() => {
    // A deliberate stop is not a completion; suppress the success chord.
    settledRef.current = true;
    stop();
  }, [stop]);

  const { phase } = search;
  useEffect(() => {
    if (settledRef.current) return;

    if (phase === "done") {
      settledRef.current = true;
      haptics.success();
      AccessibilityInfo.announceForAccessibility("Answer ready");
    } else if (phase === "error") {
      settledRef.current = true;
      haptics.error();
      AccessibilityInfo.announceForAccessibility("Search failed");
    }
  }, [phase]);

  const noResult = search.phase === "done" && !search.answer && search.citations.length === 0;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        // Handles keyboard occlusion for the scrolling content; the composer
        // handles its own. Neither uses KeyboardAvoidingView.
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          // 16, not 28. This is now only the air between the last line of an
          // answer and the composer's hairline, because on the idle screen the
          // openers reach down to meet the composer instead of stopping short.
          //
          // NOT flexGrow: 1. It is the obvious way to make short content fill
          // the screen, and it is wrong here: Yoga stretches the content
          // container to the ScrollView's FRAME, which runs up under the large
          // title, while UIKit's automatic contentInset is what keeps the
          // visible window below it. The container would come out one header
          // taller than the window and push the footnote off the bottom. The
          // openers carry the height instead — see AskEmptyState.
          paddingBottom: 16,
          gap: 20,
        }}
        onScrollBeginDrag={() => {
          // Reading back through the answer must not be fought by autoscroll.
          stickRef.current = false;
        }}
        onContentSizeChange={() => {
          if (busy && stickRef.current) scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
        {idle ? (
          <AskEmptyState
            meetingCount={meetingCount}
            onPick={submit}
            onGoRecord={() => router.push("/(app)/record")}
          />
        ) : (
          <>
            {/* Everything already answered, oldest first.
                Held back at 70% so the exchange in flight stays the loudest
                thing on the screen — this is a thread you are reading forward,
                not a log you are scanning. */}
            {settled.length > 0 ? (
              <View className="gap-6 opacity-70">
                {settled.map((turn, index) => (
                  <View key={`${index}-${turn.question.slice(0, 24)}`} className="gap-3">
                    <QuestionHeader question={turn.question} />
                    <AnswerCard answer={turn.answer} streaming={false} />
                  </View>
                ))}
              </View>
            ) : null}

            <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(260)}>
              <QuestionHeader question={search.question} />
            </Animated.View>

            {search.phase === "searching" ? (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(180)}
                // Exits faster than it enters — this band is being replaced by
                // the sources it was waiting for, and lingering reads as lag.
                exiting={reduceMotion ? undefined : FadeOut.duration(110)}
              >
                <SearchStatus meetingCount={meetingCount} />
              </Animated.View>
            ) : null}

            <SourcesRail citations={search.citations} />

            {search.phase === "streaming" || search.answer ? (
              <Animated.View
                // Lands after the sources have finished assembling, so the
                // order the data arrived in is the order the eye reads it.
                entering={reduceMotion ? undefined : FadeInDown.duration(320).delay(140)}
              >
                <AnswerCard answer={search.answer} streaming={search.phase === "streaming"} />
              </Animated.View>
            ) : null}

            {noResult ? (
              <View className="gap-2 py-4">
                <Text className="text-[17px] font-semibold text-label">
                  No meeting mentions that.
                </Text>
                <Text className="text-[15px] leading-[21px] text-label-secondary">
                  Nothing in your transcripts matched closely enough to quote. Try the words that
                  would have been said out loud.
                </Text>
              </View>
            ) : null}

            {/* Reads the failure before offering a way out of it: a quota that
                is spent gets no retry at all, a per-minute limit gets one that
                unlocks when it can succeed. */}
            {search.error ? (
              <AskFailureCard error={search.error} onRetry={() => submit(search.question)} />
            ) : null}

            {/* "Start over", not "Ask something else". Asking something else no
                longer needs a button — the composer is right there and the next
                question now carries this one with it. This clears the thread,
                which is a different and rarer intent. */}
            {!busy ? (
              <PillButton
                label="Start over"
                onPress={() => {
                  reset();
                  setInput("");
                }}
                accessibilityHint="Clears this conversation and returns to suggestions"
              />
            ) : null}
          </>
        )}
      </ScrollView>

      <Composer
        value={input}
        onChangeText={setInput}
        onSubmit={() => submit(input)}
        onStop={onStop}
        busy={busy}
        bottomInset={composerInset}
      />
    </View>
  );
}
