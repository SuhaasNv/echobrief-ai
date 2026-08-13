import { useEffect, type ComponentProps } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { SPRING, TIMING } from "@/lib/motion";
import { useColorToken } from "@/lib/tokens";
import { AUTH_ERROR_IN, AUTH_ERROR_OUT } from "./motion";

/**
 * The primary CTA.
 *
 * Neutral near-white with dark text, never blue. On a near-black ground it is
 * the highest-contrast element available, and it is the brand's signature —
 * the same button the web app ships.
 *
 * Pressable gives no feedback of its own, so the press is carried by scale.
 * 0.98 rather than the shared 0.97: this control is nearly the full width of
 * the screen, and the wider the surface the smaller the scale has to be before
 * it stops reading as "pressed" and starts reading as "the layout moved".
 * Press-in resolves faster than press-out — the finger-down response has to
 * beat perceived latency, the release can afford to settle.
 */
export function AuthSubmitButton({
  label,
  onPress,
  enabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  enabled: boolean;
  busy: boolean;
}) {
  const pressed = useSharedValue(0);
  const pending = useSharedValue(0);
  // ActivityIndicator takes its colour as a prop. Same pairing as the label
  // above it: canvas on the near-white pill.
  const onPrimary = useColorToken("--background");

  // The button stays near-white while the request is in flight even though it
  // is no longer pressable. Dropping to the disabled fill would put a #06070A
  // spinner on a #1C1F25 ground — 1.2:1, invisible — so the one moment the
  // control most needs to show life is the one moment it would look dead.
  const filled = enabled || busy;

  useEffect(() => {
    // The spinner fades in and snaps out: waiting is worth easing into, but the
    // result is not worth waiting another beat for.
    pending.value = withTiming(busy ? 1 : 0, busy ? TIMING.crossfade : TIMING.instant);
  }, [busy, pending]);

  const wrapper = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.02 }],
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: 1 - pending.value }));
  const spinnerStyle = useAnimatedStyle(() => ({ opacity: pending.value }));

  return (
    <Animated.View style={wrapper}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          pressed.value = withSpring(1, SPRING.pressIn);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, SPRING.pressOut);
        }}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled, busy }}
        className={`min-h-[52px] items-center justify-center rounded-full px-6 ${
          filled ? "bg-label" : "bg-fill"
        }`}
      >
        {/* Both states stay mounted and crossfade. Swapping them would resize
            the button by a point or two on every request. */}
        <Animated.View style={labelStyle}>
          <Text
            // label-secondary on the unfilled variant, not tertiary. This button
            // sits on `bg-fill`, where --label-tertiary measures 3.95:1, and
            // 17px/600 is not WCAG "large" (that needs 18.66px bold), so 4.5:1
            // applies. Every sibling button in the app was corrected; this one
            // was missed, and it ships on sign-in and sign-up.
            className={`text-[17px] font-semibold ${
              filled ? "text-background" : "text-label-secondary"
            }`}
            maxFontSizeMultiplier={1.6}
          >
            {label}
          </Text>
        </Animated.View>

        <Animated.View
          className="absolute inset-0 items-center justify-center"
          style={spinnerStyle}
          pointerEvents="none"
        >
          <ActivityIndicator color={onPrimary} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A failed submit.
 *
 * The announcement is not belt-and-braces. VoiceOver focus stays on the button
 * after a failed submit, so an error rendered below the fields is never read —
 * accessibilityLiveRegion alone does not move focus, and announceForAccessibility
 * alone leaves nothing for the rotor. Both are required, and keeping them in
 * one component is the only way they cannot be forgotten separately.
 *
 * The message itself is deliberately identical for an unknown email and a wrong
 * password. That sameness is a security property, not a copy oversight.
 */
export function AuthFormError({ message }: { message: string }) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return (
    // The margin lives here, not on a wrapper in the screen. A plain View
    // around this would be the node React removes, and Reanimated cannot run
    // an exiting animation on a subtree whose unmanaged parent is already gone.
    <Animated.View className="mt-3" entering={AUTH_ERROR_IN} exiting={AUTH_ERROR_OUT}>
      <Text
        className="px-1 text-[15px] leading-[20px] text-danger"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        {message}
      </Text>
    </Animated.View>
  );
}

/**
 * "New to Puffin? Create an account" — prompt in body colour, action in tint.
 *
 * `onPress` exists because the two directions are not symmetrical. Sign-in
 * pushes sign-up, so it wants a Link. Sign-up going back to sign-in must POP:
 * a Link there would push a second copy of the stack root, leaving a back
 * button that returns to the screen you just left.
 */
type AuthFooterLinkProps = {
  prompt: string;
  action: string;
} & (
  | { href: ComponentProps<typeof Link>["href"]; onPress?: never }
  | { href?: never; onPress: () => void }
);

export function AuthFooterLink({ prompt, action, href, onPress }: AuthFooterLinkProps) {
  const trigger = (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={action}
      hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
      className="active:opacity-40"
    >
      <Text className="text-[15px] font-medium text-tint-label">{action}</Text>
    </Pressable>
  );

  return (
    <View className="flex-row flex-wrap items-center justify-center gap-1">
      <Text className="text-[15px] text-label-secondary">{prompt}</Text>
      {href ? (
        <Link href={href} asChild>
          {trigger}
        </Link>
      ) : (
        trigger
      )}
    </View>
  );
}
