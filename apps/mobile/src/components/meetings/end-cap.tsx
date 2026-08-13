import { Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { pluralize } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { useColorToken } from "@/lib/tokens";

/**
 * The end of the library.
 *
 * A short list used to stop dead and hand the rest of the screen to nothing.
 * The fix is not to pad it: it is to give the list a terminal edge, the way
 * Photos ends its grid with a count and Wallet ends its stack with the one
 * thing you would want to do next. Two elements, both load-bearing — the
 * primary action of the whole screen, and a statement of what you are looking
 * at — and the space below them now reads as margin rather than as a list that
 * failed to load.
 *
 * Only rendered once every page is in, so a long library never sees it and
 * pays nothing for it.
 */

function PlusGlyph() {
  // SVG stroke is outside className resolution, so the token is read here.
  const tertiary = useColorToken("--label-tertiary");

  return (
    <Svg width={15} height={15} viewBox="0 0 16 16">
      <Path d="M8 3.2v9.6M3.2 8h9.6" stroke={tertiary} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

export function ListEndCap({ total, onRecord }: { total: number; onRecord: () => void }) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : 1 - pressed.value * 0.022 }],
  }));
  const veilStyle = useAnimatedStyle(() => ({ opacity: pressed.value * 0.05 }));

  return (
    <View className="gap-4 px-4 pt-3">
      <Animated.View style={pressStyle}>
        <Pressable
          onPressIn={() => {
            pressed.value = withSpring(1, SPRING.pressIn);
          }}
          onPressOut={() => {
            pressed.value = withSpring(0, SPRING.pressOut);
          }}
          onPress={() => {
            haptics.tap();
            onRecord();
          }}
          accessibilityRole="button"
          accessibilityLabel="Record a meeting"
          accessibilityHint="Opens the recorder"
          className="flex-row items-center gap-3 overflow-hidden rounded-card border border-edge bg-surface px-4 py-3.5"
          style={{ borderCurve: "continuous" }}
        >
          <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

          <View className="h-9 w-9 items-center justify-center rounded-full bg-fill">
            <PlusGlyph />
          </View>

          <View className="flex-1 gap-0.5">
            <Text className="text-[15px] font-semibold text-label" maxFontSizeMultiplier={1.6}>
              Record a meeting
            </Text>
            <Text
              className="text-[13px] leading-[18px] text-label-tertiary"
              maxFontSizeMultiplier={1.6}
            >
              It lands here as soon as it finishes processing
            </Text>
          </View>

          <Text className="text-[17px] text-label-tertiary" maxFontSizeMultiplier={1.2}>
            ›
          </Text>

          <Animated.View
            className="absolute inset-0 bg-label"
            style={veilStyle}
            pointerEvents="none"
          />
        </Pressable>
      </Animated.View>

      <Text
        className="text-center text-[13px] text-label-tertiary"
        style={{ fontVariant: ["tabular-nums"] }}
        maxFontSizeMultiplier={1.6}
      >
        {pluralize(total, "meeting")}
      </Text>
    </View>
  );
}
