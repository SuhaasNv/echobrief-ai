import { Pressable, Text, View } from "react-native";
import Animated, {
  FadeInDown,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from "react-native-reanimated";
import { router } from "expo-router";
import Svg, { Path } from "react-native-svg";

import { completedLabel, type ActionItem } from "@/lib/api/action-items";
import { formatClock } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { CheckRing } from "./check-ring";
import { dueState } from "./due";

/** Dark-ramp tint, for SVG. See the note in check-ring. */
const TINT = "#4C99F8";

/** Play triangle — "jump to this moment", not "open this document". */
function PlayGlyph() {
  return (
    <Svg width={9} height={11} viewBox="0 0 9 11">
      <Path d="M0.8 0.9 L8 5.5 L0.8 10.1 Z" fill={TINT} />
    </Svg>
  );
}

function Chevron() {
  return (
    <Svg width={7} height={12} viewBox="0 0 7 12">
      <Path
        d="M1 1 L6 6 L1 11"
        stroke="#787C85"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function ActionRow({
  item,
  onToggle,
  index = 0,
}: {
  item: ActionItem;
  /** Screen owns the mutation so it can hold the row on screen while it settles. */
  onToggle: (item: ActionItem) => void;
  /** Position in its group, for entrance stagger. */
  index?: number;
}) {
  const reduceMotion = useReducedMotion();
  const due = dueState(item.due_date);
  const overdue = due.overdue && !item.completed;

  const sourceTitle = item.meeting_title?.trim() || "Source meeting";
  const clock = item.timestamp_sec !== null ? formatClock(item.timestamp_sec) : null;

  /**
   * A deadline is meaningless once the task is finished — "Due Friday" on a
   * completed row is noise at best and a false alarm at worst. Done rows state
   * when they were completed instead, and say a bare "Completed" when the date
   * is unknown rather than borrowing one from another field.
   */
  const done = completedLabel(item);

  // Overdue is stated in words in the chip, so the meta line never repeats it.
  const meta = item.completed
    ? [done, item.assignee_name].filter(Boolean).join("  ·  ") || null
    : overdue
      ? item.assignee_name
      : [due.label, item.assignee_name].filter(Boolean).join("  ·  ") || null;

  return (
    <Animated.View
      // Entrance on first paint only. Exit is what makes checking something off
      // feel finished: the row fades as its neighbours spring up into the gap.
      entering={reduceMotion ? undefined : FadeInDown.duration(260).delay(Math.min(index * 40, 200))}
      exiting={reduceMotion ? undefined : FadeOut.duration(160)}
      layout={
        reduceMotion
          ? undefined
          : LinearTransition.springify()
              .damping(SPRING.smooth.damping)
              .stiffness(SPRING.smooth.stiffness)
      }
      className="overflow-hidden rounded-card border border-edge bg-surface"
      style={{ borderCurve: "continuous" }}
    >
      {/* Light from above — turns the border into a bevel. */}
      <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

      <View className="flex-row items-start gap-3 p-4">
        <View className="pt-px">
          <CheckRing
            checked={item.completed}
            overdue={overdue}
            onToggle={() => onToggle(item)}
            label={item.description}
          />
        </View>

        <View className="flex-1 gap-1.5">
          <Text
            className={`text-[15px] leading-[21px] ${
              item.completed ? "text-label-tertiary line-through" : "text-label"
            }`}
            // Four, not three. Action items are model-written sentences that
            // routinely run past three lines, and the tail clip landed mid-word
            // ("...and then implem...") which reads as a rendering fault rather
            // than as more text. Four lines clears the great majority of them
            // outright.
            numberOfLines={4}
          >
            {item.description}
          </Text>

          {overdue || meta ? (
            <View className="flex-row flex-wrap items-center gap-2">
              {overdue && due.label ? (
                // Lateness in words, not just a red tint. The chip is the
                // exception marker; on-time rows carry plain grey text.
                <View
                  className="rounded-chip bg-danger/15 px-1.5 py-0.5"
                  style={{ borderCurve: "continuous" }}
                >
                  <Text
                    className="text-[12px] font-semibold text-danger"
                    maxFontSizeMultiplier={1.4}
                  >
                    {due.label}
                  </Text>
                </View>
              ) : null}

              {meta ? (
                <Text
                  className="text-[13px] text-label-secondary"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.6}
                >
                  {meta}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {/*
        Provenance strip.
        This is the thing no competitor ships: the item remembers WHEN it was
        said, and takes you back to that moment. It gets its own recessed band
        with its own affordance rather than being a blue line of text under the
        task, so it reads as a deliberate route out of this screen instead of
        incidental metadata.

        Three elements at two type sizes, down from four at three. There was a
        second stacked line here carrying "Added <date>" — the row's own
        created_at, which is not when anything was said. It was the fourth date
        on a card that is already grouped under a dated section header, and on
        an untitled meeting the title beside it IS that date, printed twice.

        The blue here is the ONE colour on this card and it is load-bearing:
        the play triangle, the timestamp, and the chevron are a single tap
        target that jumps to that moment in the recording. Blue is the app's
        navigation colour and this navigates. The item's text is model output
        and stays on --label; violet would put a mark on every row in the list,
        which marks nothing.
      */}
      <Pressable
        onPress={() => {
          haptics.select();
          router.push(`/(app)/meetings/${item.meeting_id}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          [sourceTitle, clock ? `at ${clock}` : null].filter(Boolean).join(", ")
        }
        accessibilityHint="Opens the meeting this came from"
        className="flex-row items-center gap-2 border-t border-edge bg-inset px-4 py-2.5 active:bg-elevated"
      >
        <PlayGlyph />
        <Text
          className="flex-1 text-[13px] text-label-secondary"
          numberOfLines={1}
          maxFontSizeMultiplier={1.6}
        >
          {sourceTitle}
        </Text>
        {clock ? (
          <Text
            className="text-[13px] font-medium text-tint"
            style={{ fontVariant: ["tabular-nums"] }}
            maxFontSizeMultiplier={1.4}
          >
            {clock}
          </Text>
        ) : null}
        <Chevron />
      </Pressable>
    </Animated.View>
  );
}
