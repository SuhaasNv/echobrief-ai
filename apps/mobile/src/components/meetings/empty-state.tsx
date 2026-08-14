import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { router } from "expo-router";

import { haptics } from "@/lib/haptics";

/**
 * The three states a library screen can be in other than "has meetings".
 *
 * All three are rendered INSIDE the list rather than in place of it, so the
 * large title, the search field and the refresh control survive. Swapping the
 * whole screen for a centred message tears the navigation bar's search field
 * off mid-keystroke, which is exactly when the user needs it most.
 */

/** Primary commit action. Near-white on dark; blue is for navigation. */
function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      className="min-h-[50px] flex-row items-center justify-center self-stretch rounded-full bg-label px-6 active:opacity-80"
    >
      <Text className="text-[17px] font-semibold text-background" maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
    </Pressable>
  );
}

const OUTPUTS: { title: string; detail: string }[] = [
  { title: "Transcript", detail: "Every word, split by who said it" },
  { title: "Summary", detail: "The decisions, in a paragraph you can send" },
  { title: "Action items", detail: "Commitments with an owner and a due date" },
];

/**
 * Empty library.
 *
 * The list has nothing to show, so the screen's job changes: it has to explain
 * what a recording turns into. The grouped card is not filler — it is the only
 * place in the app that answers "what do I get for pressing record", and it
 * gives the empty screen a body instead of a headline floating over a void.
 */
export function LibraryEmpty() {
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(220)}
      className="gap-5 px-4 pt-4"
    >
      <View className="gap-2">
        <Text className="text-[22px] font-semibold text-label" maxFontSizeMultiplier={1.6}>
          Record your first meeting
        </Text>
        <Text
          className="text-[15px] leading-[21px] text-label-secondary"
          maxFontSizeMultiplier={1.8}
        >
          EchoBrief listens once and gives you three things back, usually within a couple of minutes.
        </Text>
      </View>

      <View
        className="overflow-hidden rounded-card border border-edge bg-surface"
        style={{ borderCurve: "continuous" }}
      >
        <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

        {OUTPUTS.map((output, i) => (
          <View
            key={output.title}
            className={`flex-row items-baseline gap-3 px-4 py-3.5 ${
              i > 0 ? "border-t border-separator" : ""
            }`}
          >
            <Text
              className="text-[11px] font-semibold text-label-tertiary"
              style={{ letterSpacing: 0.8, fontVariant: ["tabular-nums"] }}
              maxFontSizeMultiplier={1.3}
            >
              {String(i + 1).padStart(2, "0")}
            </Text>
            <View className="flex-1 gap-0.5">
              <Text className="text-[15px] font-semibold text-label" maxFontSizeMultiplier={1.6}>
                {output.title}
              </Text>
              <Text
                className="text-[13px] leading-[18px] text-label-secondary"
                maxFontSizeMultiplier={1.6}
              >
                {output.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <PrimaryButton label="Start recording" onPress={() => router.push("/(app)/record")} />
    </Animated.View>
  );
}

/** No match for the current query. Says what was searched, and nothing else. */
export function NoResults({ query }: { query: string }) {
  return (
    <View className="items-center gap-2 px-8 pt-16">
      <Text
        className="text-center text-[17px] font-semibold text-label"
        maxFontSizeMultiplier={1.6}
      >
        No meetings match
      </Text>
      <Text
        className="text-center text-[15px] leading-[21px] text-label-secondary"
        numberOfLines={3}
        maxFontSizeMultiplier={1.8}
      >
        {`Nothing in your library is titled "${query}". If it is something that was said, try Ask, which searches inside transcripts.`}
      </Text>
    </View>
  );
}

/** Load failure, split by cause: offline is not a server error. */
export function LoadFailed({
  offline,
  message,
  onRetry,
}: {
  offline: boolean;
  message: string;
  onRetry: () => void;
}) {
  return (
    <View className="gap-4 px-4 pt-8">
      <View
        className="gap-2 overflow-hidden rounded-card border border-edge bg-surface p-5"
        style={{ borderCurve: "continuous" }}
      >
        <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />
        <Text className="text-[17px] font-semibold text-label" maxFontSizeMultiplier={1.6}>
          {offline ? "You are offline" : "Cannot load your meetings"}
        </Text>
        <Text
          className="text-[15px] leading-[21px] text-label-secondary"
          maxFontSizeMultiplier={1.8}
          selectable
        >
          {offline ? "Your meetings appear again once you are back online." : message}
        </Text>
      </View>

      <PrimaryButton label="Try again" onPress={onRetry} />
    </View>
  );
}
