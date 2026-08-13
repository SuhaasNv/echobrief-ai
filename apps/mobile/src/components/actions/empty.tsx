import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { router } from "expo-router";

import { haptics } from "@/lib/haptics";
import { CheckSeal } from "./check-ring";

/**
 * Three genuinely different empty states, because they mean different things.
 *
 * "You're all clear." is a REWARD — the user has finished everything, and the
 * screen should say so and then get out of the way. It carries no call to
 * action on purpose: offering a next task to someone who just cleared their
 * list turns an achievement back into a chore.
 *
 * "No action items yet" is a different situation entirely: nothing has ever
 * been captured, so there is nothing to feel good about and the user genuinely
 * does need a way forward. That state, and only that state, gets a button.
 */
export type EmptyKind = "all-clear" | "never-any" | "none-done";

const COPY: Record<EmptyKind, { title: string; body: string }> = {
  "all-clear": {
    title: "You're all clear.",
    body: "Every commitment EchoBrief heard has been checked off.",
  },
  "never-any": {
    title: "No action items yet.",
    body: "When someone commits to something in a meeting, EchoBrief pulls it out with the owner, the deadline, and the moment it was said.",
  },
  "none-done": {
    title: "Nothing checked off yet.",
    body: "Items you complete land here, so you can look back at what actually got done.",
  },
};

export function ActionsEmptyState({ kind }: { kind: EmptyKind }) {
  const reduceMotion = useReducedMotion();
  const copy = COPY[kind];

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(260)}
      className="items-center px-8 pt-14"
    >
      {kind === "all-clear" ? (
        <View className="mb-5">
          <CheckSeal />
        </View>
      ) : null}

      <Text
        className="text-center font-display text-[22px] leading-[28px] text-label"
        maxFontSizeMultiplier={1.6}
      >
        {copy.title}
      </Text>

      <Text
        className="mt-2 text-center text-[15px] leading-[21px] text-label-secondary"
        maxFontSizeMultiplier={1.8}
      >
        {copy.body}
      </Text>

      {kind === "never-any" ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            router.push("/(app)/record");
          }}
          accessibilityRole="button"
          className="mt-7 min-h-[52px] justify-center rounded-full bg-label px-7 active:opacity-80"
        >
          {/* Primary actions are near-white with dark text. Blue is navigation. */}
          <Text className="text-[17px] font-semibold text-background">Record a meeting</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}
