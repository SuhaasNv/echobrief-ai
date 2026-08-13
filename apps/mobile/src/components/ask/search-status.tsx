import { useEffect, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { pluralize } from "@/lib/format";

/**
 * Indeterminate retrieval sweep.
 *
 * A 2pt track with a travelling segment, animated on translateX only — a width
 * animation here would relayout the row on every frame for a purely decorative
 * effect.
 *
 * Neutral, not violet. Violet in this palette means "the model produced this",
 * and retrieval has not produced anything yet; spending the colour on a
 * progress bar would devalue it by the time the answer arrives.
 *
 * The track measures itself rather than using percentage transforms so the
 * travel distance is exact at any width.
 */
function ScanTrack() {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);

  const segment = Math.max(56, width * 0.3);

  useEffect(() => {
    if (width === 0 || reduceMotion) return;

    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
  }, [width, reduceMotion, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -segment + progress.value * (width + segment) }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  return (
    <View
      onLayout={onLayout}
      className="h-0.5 w-full overflow-hidden rounded-full bg-fill"
      // Decorative; the label above it carries the state for VoiceOver.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {reduceMotion ? (
        <View className="h-full w-1/3 rounded-full bg-label-tertiary" />
      ) : width > 0 ? (
        <Animated.View
          className="h-full rounded-full bg-label-tertiary"
          style={[{ width: segment }, style]}
        />
      ) : null}
    </View>
  );
}

/**
 * The retrieval phase, made visible.
 *
 * Citations arrive in a response header, so the app knows which meetings
 * matched a second or more before the first answer token. Saying so — with the
 * real library size, not a spinner — is the cheapest perceived-latency win on
 * this screen: the wait stops being dead time and becomes visible work.
 */
export function SearchStatus({ meetingCount }: { meetingCount: number | null }) {
  const label =
    meetingCount !== null && meetingCount > 0
      ? `Searching ${pluralize(meetingCount, "meeting")}`
      : "Searching your meetings";

  return (
    <View className="gap-3 py-1" accessibilityLiveRegion="polite">
      <Text className="text-[15px] text-label-secondary" style={{ fontVariant: ["tabular-nums"] }}>
        {label}
      </Text>
      <ScanTrack />
    </View>
  );
}
