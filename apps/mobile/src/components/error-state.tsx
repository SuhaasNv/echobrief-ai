import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";

import { haptics } from "@/lib/haptics";

/**
 * The app's one failure surface.
 *
 * An error has to be tellable apart from an empty state and from a loading
 * state at a glance, because they mean three different things and the user's
 * next move is different in each. Empty states in this app are a heading plus a
 * body plus, sometimes, an invitation to record. This is deliberately built to
 * the same measurements but inside a CARD: the raised surface with its top
 * highlight is what marks the difference between "there is nothing here" and
 * "something did not work", and it matches the load failure the meetings list
 * already ships.
 *
 * The retry is optional on purpose. Offline, or on a 403, pressing a button
 * cannot change the outcome, and a control that cannot succeed is worse than no
 * control at all. `describeError` in lib/api/errors decides which case it is.
 */
export function ErrorState({
  title,
  body,
  detail,
  onRetry,
  retryLabel = "Try again",
  busy = false,
}: {
  title: string;
  body: string;
  /** Raw server text, when it says more than the body does. Selectable so it can be reported. */
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  busy?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(220)}
      // Horizontal inset only. Vertical placement belongs to whatever is
      // hosting this, which already knows whether it is filling a screen or
      // standing in for one card in a list.
      className="gap-4 px-4"
      accessibilityLiveRegion="polite"
    >
      <View
        className="gap-2 overflow-hidden rounded-card border border-edge bg-surface p-5"
        style={{ borderCurve: "continuous" }}
      >
        {/* Light from above, the same bevel every card in the app carries. */}
        <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

        <Text className="text-[17px] font-semibold text-label" maxFontSizeMultiplier={1.6}>
          {title}
        </Text>
        <Text
          className="text-[15px] leading-[21px] text-label-secondary"
          maxFontSizeMultiplier={1.8}
        >
          {body}
        </Text>

        {detail && detail !== body ? (
          <Text
            className="text-[13px] leading-[18px] text-label-tertiary"
            maxFontSizeMultiplier={1.8}
            selectable
          >
            {detail}
          </Text>
        ) : null}
      </View>

      {onRetry ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            onRetry();
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          className={`min-h-[50px] flex-row items-center justify-center self-stretch rounded-full px-6 ${
            busy ? "bg-fill" : "bg-label active:opacity-80"
          }`}
        >
          {busy ? (
            <ActivityIndicator color="#9CA1A9" />
          ) : (
            // Primary commit action: near-white with dark text. Blue is navigation.
            <Text className="text-[17px] font-semibold text-background" maxFontSizeMultiplier={1.6}>
              {retryLabel}
            </Text>
          )}
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/**
 * One line across the top of a list that still has content to show.
 *
 * Used where a refresh failed but the previously loaded rows are still valid:
 * replacing a working list with a full error screen would throw away data the
 * user can still read. --label-tertiary is NOT usable here; it measures 3.95:1
 * on --fill and only --label-secondary clears AA on that surface.
 */
export function StaleNotice({ children }: { children: string }) {
  return (
    <View className="bg-fill px-4 py-2" accessibilityLiveRegion="polite">
      <Text
        className="text-center text-[13px] text-label-secondary"
        maxFontSizeMultiplier={1.6}
      >
        {children}
      </Text>
    </View>
  );
}
