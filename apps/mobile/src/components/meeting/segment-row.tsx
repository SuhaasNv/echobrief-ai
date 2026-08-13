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
  /**
   * Raw diarization id behind `label` ("A"), or null for an unattributed line.
   * A primitive rather than the speaker object, so the comparator below stays a
   * string compare and a poll cannot dirty 800 rows.
   */
  speakerId: string | null;
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
  /** Open the naming sheet for this turn's voice. Stable across renders. */
  onNameSpeaker?: (speakerId: string) => void;
}

function areEqual(a: SegmentRowProps, b: SegmentRowProps): boolean {
  return (
    a.text === b.text &&
    a.time === b.time &&
    a.label === b.label &&
    a.labelClass === b.labelClass &&
    a.speakerId === b.speakerId &&
    a.gutter === b.gutter &&
    a.spacing === b.spacing &&
    a.index === b.index &&
    a.active === b.active &&
    a.onSeek === b.onSeek &&
    a.onMeasure === b.onMeasure &&
    a.onNameSpeaker === b.onNameSpeaker
  );
}

export const SegmentRow = memo(function SegmentRow({
  index,
  time,
  label,
  labelClass,
  speakerId,
  text,
  gutter,
  spacing,
  active,
  onSeek,
  onMeasure,
  onNameSpeaker,
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
          {/* Colour is never the sole carrier of identity: the name is always
              spelled out next to it.

              The name is also the way to CHANGE the name, which is why this is a
              Pressable nested inside the row's own tap-to-seek one. Naming
              belongs on the surface where the anonymity is actually a problem —
              reading "Speaker B decided it" is the moment you want to fix it —
              and reaching for a settings screen to do it is how the feature goes
              unused. iOS gives the inner Pressable the touch, so the line around
              the name still seeks. There is deliberately no underline or pencil:
              this is the app's one long-form reading surface, and an editing
              affordance repeated down 800 lines reads as a spell-checker.
              Discovery is carried by the ribbon legend and the "Who talked" card,
              which both say so in as many words. */}
          {label && speakerId && onNameSpeaker ? (
            <Pressable
              onPress={() => onNameSpeaker(speakerId)}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint="Puts a name to this voice"
              className="self-start"
              hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
            >
              {({ pressed }) => (
                <Text
                  className={`mb-1 text-[13px] font-semibold ${labelClass}`}
                  style={{ opacity: pressed ? 0.4 : 1 }}
                  maxFontSizeMultiplier={1.4}
                >
                  {label}
                </Text>
              )}
            </Pressable>
          ) : label ? (
            <Text
              className={`mb-1 text-[13px] font-semibold ${labelClass}`}
              maxFontSizeMultiplier={1.4}
            >
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
