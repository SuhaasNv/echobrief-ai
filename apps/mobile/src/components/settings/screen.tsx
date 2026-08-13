import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text } from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useOnline } from "@/lib/api/errors";
import { useTabBarInset } from "@/lib/layout";
import { SPRING } from "@/lib/motion";

/**
 * The scroll surface every settings screen sits on.
 *
 * It exists for two reasons.
 *
 * First, the tab bar. Content sits BEHIND the native UITabBar — that is how the
 * Liquid Glass material reads through to what is under it — so every scroll
 * surface owes itself bottom clearance. Forgetting it has shipped four times
 * here, and it is invisible in any screenshot that is not scrolled to the
 * bottom. Centralising it means a new settings screen cannot get it wrong.
 *
 * Second, entrance. Groups arrive staggered rather than all at once, which
 * gives a long list a reading order instead of a single flat pop. The stagger
 * is capped so a screen with eight groups does not crawl in, and it is skipped
 * entirely under Reduce Motion.
 *
 * Third, refresh. Any settings screen backed by a request passes `onRefresh`
 * and gets the standard pull gesture, spinner state included. It lives here
 * rather than on each screen because the Plan screen shipped copy telling
 * people to pull down on a surface that had no refresh control at all, and the
 * only way that class of lie stops recurring is if the gesture is one prop away.
 * Screens with nothing to refetch pass nothing and get no control, because a
 * gesture that runs no request is the same lie in the other direction.
 */
export function SettingsScroll({
  children,
  topPadding = 16,
  gap = 26,
  onRefresh,
}: {
  children: ReactNode;
  topPadding?: number;
  gap?: number;
  /** Awaited, with the spinner held for its duration. Omit on local-only screens. */
  onRefresh?: () => Promise<unknown>;
}) {
  const tabBarInset = useTabBarInset();
  const reduceMotion = useReducedMotion();
  const online = useOnline();
  const [refreshing, setRefreshing] = useState(false);

  // A pull can outlive the screen: the user refreshes, then swipes back before
  // the request settles.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleRefresh = useCallback(() => {
    if (!onRefresh) return;

    // React Query PAUSES a fetch while the device is offline, and a paused
    // fetch never settles — awaiting one would leave the spinner turning until
    // the network came back. Screens that show remote values say they are
    // offline in words instead; see the notice on Account and Plan.
    if (!online) return;

    setRefreshing(true);
    void Promise.resolve(onRefresh()).finally(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, [onRefresh, online]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: tabBarInset, gap }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      refreshControl={
        onRefresh ? (
          // The default spinner grey is near-invisible on #06070A.
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#9CA1A9" />
        ) : undefined
      }
    >
      {Children.map(children, (child, index) =>
        child == null || child === false ? null : (
          <Animated.View
            entering={
              reduceMotion
                ? undefined
                : FadeInDown.duration(300).delay(Math.min(index * 45, 270))
            }
          >
            {child}
          </Animated.View>
        ),
      )}
    </ScrollView>
  );
}

/** Standing explanatory text between groups. */
export function Footnote({ children }: { children: string }) {
  return (
    <Text
      className="px-5 text-[13px] leading-[19px] text-label-tertiary"
      maxFontSizeMultiplier={1.8}
    >
      {children}
    </Text>
  );
}

/**
 * Press feedback for a CARD — an object sitting on the canvas.
 *
 * Never applied to full-width list rows: a row that shrinks away from its own
 * separators reads as a rendering fault. Rows use the pressed fill instead.
 */
export function PressableTile({
  children,
  onPress,
  className,
  accessibilityLabel,
  accessibilityHint,
}: {
  children: ReactNode;
  onPress: () => void;
  /** Goes on the Pressable itself, so `active:` variants actually fire. */
  className?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const pressed = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.02 }],
  }));

  return (
    // The scale sits on a wrapper so the press target keeps its own layout.
    <Animated.View style={style}>
      <Pressable
        onPressIn={() => {
          pressed.value = withSpring(1, SPRING.pressIn);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, SPRING.pressOut);
        }}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        className={className}
        style={{ borderCurve: "continuous" }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
