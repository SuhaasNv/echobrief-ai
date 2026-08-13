import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { SPRING, TIMING } from "@/lib/motion";

/**
 * Google's identity, reproduced rather than tokenised.
 *
 * These six values are the ONLY hardcoded colours in this file, and they are
 * hardcoded on purpose: Google's Sign-In branding guidelines specify the dark
 * button as #131314 on a #8E918F hairline with #E3E3E3 text, and the "G" as its
 * four brand colours. A token cannot stand in for any of them — they are not
 * ours to re-theme, and a themed variant would be an unapproved rendition of
 * someone else's mark. Everything else on this button (the spinner colour, the
 * metrics, the press behaviour) comes from the app's own tokens and motion.
 *
 * The app is dark-only today (app.json pins userInterfaceStyle), so only the
 * dark rendition is here. A light appearance would need Google's light values —
 * #FFFFFF / #747775 / #1F1F1F — not a tint of these.
 */
const GOOGLE = {
  surface: "#131314",
  stroke: "#8E918F",
  label: "#E3E3E3",
  blue: "#4285F4",
  green: "#34A853",
  yellow: "#FBBC05",
  red: "#EA4335",
} as const;

/** The official four-colour "G", at Google's published 48×48 geometry. */
function GoogleMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill={GOOGLE.blue}
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill={GOOGLE.green}
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill={GOOGLE.yellow}
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill={GOOGLE.red}
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

interface GoogleAuthButtonProps {
  /** "Sign in with Google" on sign-in, "Sign up with Google" on sign-up. */
  label: string;
  onPress: () => void;
  enabled: boolean;
  busy: boolean;
}

/**
 * The Google sign-in button.
 *
 * Sits under the primary CTA, not beside it. The near-white pill above is the
 * brand's own signature and has to stay the loudest thing on the screen; a
 * second full-width light button would split that emphasis in two, which is
 * also why the dark Google rendition is the right one here rather than the
 * white one.
 *
 * Metrics are the app's, not Google's. The guidelines ask for Roboto Medium at
 * 14sp, which is an Android specification: at 52pt tall next to a 17pt CTA, a
 * 14pt label reads as a different button from a different app, and 14pt is
 * below what this codebase ships anywhere. The parts of the guidance that are
 * actually about identity — the mark, the palette, the wording, the mark
 * sitting to the left of the text — are followed exactly.
 *
 * Press behaviour is copied deliberately from AuthSubmitButton: the same 0.98
 * scale, the same asymmetric springs, the same stay-mounted crossfade to a
 * spinner. Two stacked buttons that respond differently to the same finger is
 * the kind of detail that reads as "one of these is not really a button".
 */
export function GoogleAuthButton({ label, onPress, enabled, busy }: GoogleAuthButtonProps) {
  const pressed = useSharedValue(0);
  const pending = useSharedValue(0);

  useEffect(() => {
    pending.value = withTiming(busy ? 1 : 0, busy ? TIMING.crossfade : TIMING.instant);
  }, [busy, pending]);

  const wrapper = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.02 }],
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: 1 - pending.value }));
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
        className="min-h-[52px] flex-row items-center justify-center gap-3 rounded-full px-6"
        style={{
          backgroundColor: GOOGLE.surface,
          borderWidth: 1,
          borderColor: GOOGLE.stroke,
          // Dimmed rather than recoloured while the password form is busy: the
          // mark must not appear in a shade Google did not publish.
          opacity: enabled || busy ? 1 : 0.5,
        }}
      >
        <Animated.View style={contentStyle} className="flex-row items-center gap-3">
          <GoogleMark size={20} />
          <Text
            className="text-[17px] font-semibold"
            style={{ color: GOOGLE.label }}
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
          {/* Google's label colour, not a token: this spinner sits on Google's
              surface, so it has to pair with what is painted under it. */}
          <ActivityIndicator color={GOOGLE.label} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * "or" between the two ways in.
 *
 * A label rather than bare spacing. Without it the two pills stack into what
 * looks like a primary and a secondary action on the same form — press one,
 * then the other — instead of two alternatives, only one of which you need.
 */
export function AuthOrDivider() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-px flex-1 bg-separator" />
      <Text
        className="text-[13px] text-label-tertiary"
        maxFontSizeMultiplier={1.4}
        numberOfLines={1}
      >
        or
      </Text>
      <View className="h-px flex-1 bg-separator" />
    </View>
  );
}
