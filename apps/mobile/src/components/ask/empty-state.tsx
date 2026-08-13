import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";

import { pluralize } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { Chevron } from "@/components/settings/rows";
import { Eyebrow } from "./eyebrow";

/**
 * Openers.
 *
 * Written as questions a person would actually ask out loud, and deliberately
 * cross-meeting: "what did we decide about pricing" is the thing this product
 * can answer and a single transcript cannot. A suggestion that could be
 * answered by opening one meeting teaches the user the wrong mental model.
 *
 * Six, not four. Four left roughly 140pt of dead air between this group and the
 * pinned composer on a large phone, and the openers are the only thing on the
 * screen doing real work: they are the whole tutorial for what "ask across your
 * meetings" means. Filling that space with more of the one useful thing beats
 * filling it with a second group, and beats a list of recent questions that
 * would be empty on exactly the run where the gap was reported.
 *
 * Each of these is answerable ONLY across meetings. The moment one of them can
 * be satisfied by opening a single transcript it stops earning its row.
 */
const SUGGESTIONS = [
  "What did we decide about pricing?",
  "What is still unresolved across my meetings?",
  "Who committed to what last week?",
  "Summarize everything said about onboarding",
  "What did I say I would follow up on?",
  "What concerns keep coming up?",
];

/**
 * Grouped suggestion list.
 *
 * One card with hairline-separated rows rather than four floating cards: iOS
 * groups related choices into a single inset surface, and four separate cards
 * read as four unrelated objects.
 *
 * Rows do NOT scale on press — they are full-width list rows inside a group,
 * and scaling one away from its separators looks like a rendering fault. The
 * pressed fill carries the feedback instead.
 *
 * THE ROWS CARRY THE HEIGHT THIS SCREEN NEEDS. py-3.5 around a 21pt line gave a
 * 50pt row, and six of them left the group ending 66pt short of the composer
 * once the composer stopped floating 65pt above the tab bar. A 60pt floor closes
 * that: the list now runs down to the composer, and the rows are a comfortable
 * iOS list height instead of a settings-row height, which is what these deserve
 * — they are the primary action on the screen, not a preferences list.
 *
 * Stated as a floor, so Dynamic Type still grows them and nothing clips.
 *
 * Deliberately NOT a seventh opener, and deliberately not flexGrow. Six is what
 * the tutorial needs; the layout is not a reason to invent a seventh question.
 * And flexGrow would have stretched the content container to the ScrollView's
 * frame rather than to its visible window — see the note on the Ask screen's
 * contentContainerStyle.
 */
const ROW_MIN_HEIGHT = 60;

function SuggestionGroup({ onPick }: { onPick: (question: string) => void }) {
  return (
    <View
      className="overflow-hidden rounded-card border border-edge bg-surface"
      style={{ borderCurve: "continuous" }}
    >
      {/* Light from above — turns the border into a bevel. */}
      <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

      {SUGGESTIONS.map((question, i) => (
        <Pressable
          key={question}
          onPress={() => {
            haptics.tap();
            onPick(question);
          }}
          accessibilityRole="button"
          accessibilityLabel={question}
          accessibilityHint="Asks this question across your meetings"
          className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-elevated ${
            i > 0 ? "border-t border-separator" : ""
          }`}
          style={{ minHeight: ROW_MIN_HEIGHT }}
        >
          <Text className="flex-1 text-[15px] leading-[21px] text-label">{question}</Text>
          {/* The settings list's chevron, not a typed "›". The character rendered
              at a different weight and sat off the row's baseline, so this was
              the only list in the app whose disclosure did not match the others.
              Its default tint is tertiary: blue is navigation, and this chevron
              commits an action. */}
          <Chevron />
        </Pressable>
      ))}
    </View>
  );
}

interface AskEmptyStateProps {
  /** Library size, or null while it is still loading. */
  meetingCount: number | null;
  onPick: (question: string) => void;
  onGoRecord: () => void;
}

export function AskEmptyState({ meetingCount, onPick, onGoRecord }: AskEmptyStateProps) {
  const reduceMotion = useReducedMotion();

  // Nothing indexed yet. Offering four questions that can only return "no
  // meeting mentions that" is worse than admitting the library is empty.
  if (meetingCount === 0) {
    return (
      <Animated.View
        entering={reduceMotion ? undefined : FadeInDown.duration(320)}
        className="gap-3 pt-2"
      >
        <Eyebrow>Nothing to search yet</Eyebrow>
        <Text className="text-[17px] leading-[25px] text-label-secondary">
          Ask works across meetings you have already captured. Record one and it becomes searchable
          as soon as it finishes processing.
        </Text>
        <Pressable
          onPress={() => {
            haptics.tap();
            onGoRecord();
          }}
          accessibilityRole="button"
          className="mt-1 min-h-[50px] flex-row items-center justify-center self-start rounded-full bg-label px-6 active:opacity-80"
        >
          {/* Primary actions are near-white with dark text. Blue is for
              navigation and links, never for commit buttons. */}
          <Text className="text-[17px] font-semibold text-background">Record a meeting</Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <View className="gap-5 pt-1">
      <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(300)}>
        <Text className="text-[17px] leading-[25px] text-label-secondary">
          Ask one question and get one answer, drawn from your own transcripts, with the moments it
          came from.
        </Text>
      </Animated.View>

      <Animated.View
        entering={reduceMotion ? undefined : FadeInDown.duration(340).delay(60)}
        className="gap-2.5"
      >
        <Eyebrow>Start with</Eyebrow>
        <SuggestionGroup onPick={onPick} />
        {meetingCount !== null ? (
          <Text
            className="px-1 pt-1 text-[13px] text-label-tertiary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {`Searching across ${pluralize(meetingCount, "meeting")}`}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}
