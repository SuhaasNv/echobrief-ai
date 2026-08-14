import { Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";
import Svg, { Path } from "react-native-svg";

import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { useColorToken } from "@/lib/tokens";

/**
 * The one collapsible group in the library.
 *
 * Notion's treatment, not a card: a disclosure chevron, the word, and a count,
 * on the same baseline as every other section heading so Favorites reads as one
 * of the list's own groups rather than a widget bolted above it. The chevron is
 * the affordance and the amber the identity — the same amber the favorite swipe
 * flashes — so the section and the gesture that fills it are visibly the same
 * feature.
 */

function Chevron({ color }: { color?: string }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
      <Path
        d="M3 4.5L6 7.5L9 4.5"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A small filled star, the section's mark. Amber, like the swipe action. */
function StarMark({ color }: { color?: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 18 18">
      <Path
        d="M9 1.7l2.12 4.29 4.73.69-3.42 3.33.81 4.71L9 12.7l-4.24 2.22.81-4.71L2.15 6.68l4.73-.69z"
        fill={color}
      />
    </Svg>
  );
}

export function FavoritesSectionHeader({
  count,
  collapsed,
  onToggle,
}: {
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const amber = useColorToken("--warning");
  const tertiary = useColorToken("--label-tertiary");

  // The chevron points down when open, right when closed; it turns rather than
  // swaps so the direction of the fold reads as a motion, not a state change.
  const turn = useSharedValue(collapsed ? -90 : 0);
  useEffect(() => {
    turn.value = reduceMotion
      ? collapsed
        ? -90
        : 0
      : withTiming(collapsed ? -90 : 0, { duration: 180 });
  }, [collapsed, reduceMotion, turn]);

  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

  const pressed = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({ opacity: 1 - pressed.value * 0.4 }));

  return (
    <View className="bg-background px-4 pb-2.5 pt-1">
      <Pressable
        onPressIn={() => {
          pressed.value = withTiming(1, { duration: 90 });
        }}
        onPressOut={() => {
          pressed.value = withTiming(0, { duration: 140 });
        }}
        onPress={() => {
          haptics.tap();
          onToggle();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`Favorites, ${count}`}
        accessibilityHint={collapsed ? "Expands the favorites" : "Collapses the favorites"}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
      >
        <Animated.View className="flex-row items-center gap-2" style={pressStyle}>
          <Animated.View style={chevronStyle}>
            <Chevron color={tertiary} />
          </Animated.View>

          <StarMark color={amber} />

          <Text className="text-[15px] font-semibold text-label" maxFontSizeMultiplier={1.5}>
            Favorites
          </Text>
          <Text
            className="text-[13px] text-label-tertiary"
            style={{ fontVariant: ["tabular-nums"] }}
            maxFontSizeMultiplier={1.4}
          >
            {count}
          </Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}
