import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOut, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { acceptRecovery, dismissRecovery, useRecovery } from "@/lib/audio/recovery";
import { haptics } from "@/lib/haptics";
import { useColorToken } from "@/lib/tokens";

/**
 * The recovery prompt, as a banner rather than a launch-time alert.
 *
 * It appears only when an interrupted recording that never reached the server is
 * waiting on a decision (see lib/audio/recovery). A modal alert on foreground
 * stole the first tap and blocked the whole library over an optional question;
 * this sits at the top of that library, in the same slot the offline notice
 * uses, and lets the user answer when they are ready. Amber, not red — the audio
 * is safe on the device, so this is a nudge, not a failure.
 */

function WaveGlyph({ color }: { color?: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <Path
        d="M3 9v0M6 6v6M9 3.5v11M12 6v6M15 9v0"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function RecoveryBanner() {
  const recovery = useRecovery();
  const reduceMotion = useReducedMotion();
  const amber = useColorToken("--warning");

  if (!recovery) return null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(240)}
      exiting={reduceMotion ? undefined : FadeOut.duration(160)}
      className="px-4 pb-1 pt-1"
      accessibilityLiveRegion="polite"
    >
      <View
        className="gap-3 overflow-hidden rounded-card border border-edge bg-surface p-4"
        style={{ borderCurve: "continuous" }}
      >
        {/* The same top bevel every card carries. */}
        <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

        <View className="flex-row items-start gap-3">
          <View className="mt-px">
            <WaveGlyph color={amber} />
          </View>
          <View className="flex-1 gap-1">
            <Text className="text-[15px] font-semibold text-label" maxFontSizeMultiplier={1.6}>
              Interrupted recording
            </Text>
            <Text
              className="text-[13px] leading-[18px] text-label-secondary"
              maxFontSizeMultiplier={1.8}
            >
              {`“${recovery.title}” stopped before uploading, but ${recovery.audio} of audio is still saved on this iPhone.`}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center justify-end gap-2">
          <Pressable
            onPress={() => {
              haptics.tap();
              void dismissRecovery();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Delete the interrupted recording ${recovery.title}`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="min-h-[38px] justify-center rounded-full px-4 active:opacity-60"
          >
            <Text className="text-[14px] font-semibold text-danger" maxFontSizeMultiplier={1.4}>
              Delete
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              haptics.medium();
              void acceptRecovery();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Upload the interrupted recording ${recovery.title}`}
            className="min-h-[38px] justify-center rounded-full bg-label px-5 active:opacity-80"
          >
            {/* Near-white pill with dark text: the one commit action. Blue is navigation. */}
            <Text className="text-[14px] font-semibold text-background" maxFontSizeMultiplier={1.4}>
              Upload
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}
