import type { ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthBackdrop, useAuthPanelStart, type AuthHeroVariant } from "@/components/auth-backdrop";

/**
 * The shell both auth screens are built on.
 *
 * Three things it guarantees, each of which was previously per-screen and
 * therefore drifted:
 *
 *   The panel starts at a fixed share of screen height, and the backdrop reads
 *   the same number. That is what makes the hero and the form one composition:
 *   the orb's lower edge is positioned relative to this line, so the distance
 *   between the light and the first word is identical on a 5.4" and a 6.9"
 *   phone. A flexible spacer here instead would let that distance drift with
 *   the device and re-open the dead band this was built to close.
 *
 *   Slack goes BELOW the form, never above it. On a tall phone the extra room
 *   lands under the footer link, where it reads as margin.
 *
 *   The scroll view is deliberately NOT
 *   contentInsetAdjustmentBehavior="automatic". That asks UIKit to inject
 *   header and safe-area insets, which is right for a list under a large title
 *   and wrong for this: it adds phantom height, pushes content down, and makes
 *   a screen that fits become scrollable.
 */
export function AuthScreen({
  variant,
  children,
}: {
  variant: AuthHeroVariant;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelStart = useAuthPanelStart(variant);

  return (
    <View className="flex-1 bg-background">
      <AuthBackdrop variant={variant} />

      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          alwaysBounceVertical={false}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {/* Reserves the hero. The video is absolutely positioned behind this,
              so it is a spacer rather than a container. */}
          <View style={{ height: height * panelStart }} pointerEvents="none" />

          <View className="px-5">{children}</View>

          {/* Absorbs everything left over, so the panel never floats. */}
          <View style={{ flexGrow: 1, minHeight: insets.bottom + 24 }} pointerEvents="none" />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * The line where the hero hands off to the form.
 *
 * A micro-label with a hairline running out to the right margin. It is doing
 * real work rather than decorating: the dissolve ends within a few points of
 * it, so it reads as the caption on the image above AND the header of the form
 * below, which is what stops the screen looking like two unrelated halves. It
 * is also the one element both auth screens share verbatim, which is most of
 * what makes them look like the same product.
 *
 * Capped at 1.4x Dynamic Type — past that it stops fitting on one line beside
 * the rule and wraps, which looks broken.
 */
export function HorizonLabel({ children }: { children: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <Text
        className="text-[11px] font-semibold uppercase text-label-tertiary"
        style={{ letterSpacing: 0.8 }}
        maxFontSizeMultiplier={1.4}
        numberOfLines={1}
      >
        {children}
      </Text>
      <View className="h-px flex-1 bg-separator" />
    </View>
  );
}
