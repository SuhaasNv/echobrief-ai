import { memo } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

/**
 * One transcript paragraph.
 *
 * Every prop is a primitive. Resolving the speaker label and colour happens
 * once in the parent, so a poll that returns a structurally identical meeting
 * object cannot restyle 800 rows: the comparator below sees the same strings
 * and nothing re-renders. Passing the speakers ARRAY down here instead would
 * defeat memoisation on every refetch, because the array is a new identity each
 * time even when its contents are unchanged.
 *
 * The same rule governs playback. `onSeek` and `onMeasure` must be stable
 * across the parent's renders, and `active` is a boolean rather than a shared
 * index, so moving the highlight one row down dirties two rows and not 800.
 */

export interface SegmentRowProps {
  /** Position in the parent's row list. Identifies this row to `onMeasure`. */
  index: number;
  /** mm:ss, only on the first line of a turn. Null keeps the gutter empty. */
  time: string | null;
  /** Speaker name, only on the first line of a turn. */
  label: string | null;
  /** Tailwind text colour class for the speaker name. */
  labelClass: string;
  text: string;
  /** Gutter width, sized by the meeting's longest timestamp. */
  gutter: number;
  /** Space above this row: a turn change breathes, a continuation does not. */
  spacing: number;
  /** This line is the one currently playing. */
  active: boolean;
  /** Jump playback here. Absent when the meeting carries no audio. */
  onSeek?: (index: number) => void;
  /** Reports geometry for auto-scroll. Stable across renders. */
  onMeasure?: (index: number, y: number, height: number) => void;
}

function areEqual(a: SegmentRowProps, b: SegmentRowProps): boolean {
  return (
    a.text === b.text &&
    a.time === b.time &&
    a.label === b.label &&
    a.labelClass === b.labelClass &&
    a.gutter === b.gutter &&
    a.spacing === b.spacing &&
    a.index === b.index &&
    a.active === b.active &&
    a.onSeek === b.onSeek &&
    a.onMeasure === b.onMeasure
  );
}

export const SegmentRow = memo(function SegmentRow({
  index,
  time,
  label,
  labelClass,
  text,
  gutter,
  spacing,
  active,
  onSeek,
  onMeasure,
}: SegmentRowProps) {
  const handleLayout = onMeasure
    ? (event: LayoutChangeEvent) => {
        const { y, height } = event.nativeEvent.layout;
        onMeasure(index, y, height);
      }
    : undefined;

  const body = (
    <>
      {/* The follow-along highlight.
          Absolutely positioned and outset, so it cannot change the row's box.
          Anything that reflowed the text - a border, a padding change, a
          weight change - would push every line below it as the highlight
          walked down the page, which is unreadable while listening. */}
      {active ? (
        <Animated.View
          entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)}
          pointerEvents="none"
          className="rounded-row bg-fill"
          style={{
            position: "absolute",
            left: -8,
            right: -8,
            top: -6,
            bottom: -6,
            borderCurve: "continuous",
          }}
        />
      ) : null}

      <View className="flex-row gap-3">
        {/* Fixed-width gutter with tabular figures, so the column cannot shimmer
            between rows and the body text starts on one hard left margin. Sized
            to the meeting: an hour-long recording needs h:mm:ss, and most do not,
            so the common case buys that width back for the text. */}
        <Text
          className="shrink-0 pt-px text-[13px] text-label-tertiary"
          style={{ width: gutter, fontVariant: ["tabular-nums"] }}
          maxFontSizeMultiplier={1.2}
          accessibilityElementsHidden={time === null}
        >
          {time ?? ""}
        </Text>

        <View className="flex-1">
          {label ? (
            <Text
              className={`mb-1 text-[13px] font-semibold ${labelClass}`}
              maxFontSizeMultiplier={1.4}
            >
              {/* Colour is never the sole carrier of identity: the name is always
                  spelled out next to it. */}
              {label}
            </Text>
          ) : null}

          {/* selectable: a transcript you cannot copy is not much use, and RN
              defaults Text to non-selectable, the opposite of the web.
              16/25 is a reading measure, not a UI measure - this is the one
              surface in the app someone reads for minutes at a time.

              Selection survives the Pressable below because nothing here binds
              onLongPress, so the long press that starts a selection is never
              claimed by the tap-to-seek gesture. */}
          <Text className="text-[16px] leading-[25px] text-label" selectable>
            {text}
          </Text>
        </View>
      </View>
    </>
  );

  if (!onSeek) {
    return (
      <View style={{ marginTop: spacing }} onLayout={handleLayout}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      style={{ marginTop: spacing }}
      onLayout={handleLayout}
      onPress={() => onSeek(index)}
      accessibilityRole="button"
      // Read until something looks wrong, tap it, hear what was actually said.
      accessibilityHint="Plays the recording from this line"
      accessibilityState={{ selected: active }}
    >
      {body}
    </Pressable>
  );
}, areEqual);
