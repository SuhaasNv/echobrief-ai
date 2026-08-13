import { Pressable, Text, View } from "react-native";

import { haptics } from "@/lib/haptics";
import { Eyebrow } from "./eyebrow";

/**
 * The question, as the headline of the result.
 *
 * Not a right-aligned chat bubble. This controller holds exactly one question
 * and one answer at a time, so a stack of bubbles would be describing a
 * conversation that does not exist. Setting the question as a display-face
 * headline says what the page is about — the same job a title does on a
 * document — and leaves the whole width for the answer beneath it.
 */
export function QuestionHeader({ question }: { question: string }) {
  return (
    <View className="gap-2">
      <Eyebrow>You asked</Eyebrow>
      <Text
        className="font-display text-[24px] leading-[31px] text-label"
        selectable
        maxFontSizeMultiplier={1.6}
      >
        {question}
      </Text>
    </View>
  );
}

/**
 * Secondary pill.
 *
 * Neutral and bordered. Blue would read as navigation, and these actions stay
 * on this screen; near-white would claim primary weight the screen has already
 * spent on the send button.
 *
 * 44pt tall, not the 40 it was. Four points under Apple's floor is the kind of
 * miss nobody sees and everybody feels, and this is a recovery control: it is
 * reached for after something has already gone wrong, which is the worst moment
 * to make someone aim. The hitSlop is deliberate on top of the floor rather than
 * instead of it, because these pills are `self-start` and sit at the left edge
 * of a column with nothing beside them to steal from.
 */
export function PillButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  tone = "neutral",
}: {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  /** Renders dimmed and inert. Used while a rate limit is still counting down. */
  disabled?: boolean;
  /**
   * "danger" tints the border and label for the one control in Ask that
   * destroys something.
   *
   * Tinted, not FILLED. A solid danger pill would need a legible foreground on
   * top of --danger, and there is no on-danger token in this palette — inventing
   * a hex here would be the first colour in the app that answers to nothing. The
   * tint is loud enough beside three neutral pills, and the confirm card around
   * it is already carrying the warning.
   */
  tone?: "neutral" | "danger";
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        // Consequential controls get the heavier tap. This is the same
        // distinction haptics.medium documents: a destructive commit is not the
        // same event as ticking something off.
        if (tone === "danger") haptics.medium();
        else haptics.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      className={`min-h-[44px] justify-center self-start rounded-full border px-4 ${
        tone === "danger" ? "border-danger/50 bg-danger/10" : "border-edge bg-surface"
      } ${disabled ? "" : "active:bg-elevated"}`}
      style={disabled ? { opacity: 0.55 } : undefined}
    >
      <Text
        className={`text-[15px] font-medium ${tone === "danger" ? "text-danger" : "text-label"}`}
        style={{ fontVariant: ["tabular-nums"] }}
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </Text>
    </Pressable>
  );
}
