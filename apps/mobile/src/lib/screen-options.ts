import type { ComponentProps } from "react";
import type { Stack } from "expo-router";

type StackScreenOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/**
 * Shared header options for every tab's stack.
 *
 * Note `headerLargeTitleEnabled`, not `headerLargeTitle` — the latter is
 * deprecated in this version and would be a silent no-op.
 *
 * `headerTransparent` is what lets iOS 26's scroll edge effect do the blur.
 * Do NOT add headerStyle.backgroundColor alongside it: Apple's guidance is to
 * avoid custom backgrounds on navigation elements, because they interfere with
 * the scroll edge effect — the mechanism that keeps the title legible over
 * scrolling content.
 *
 * Colours are the dark palette because app.json pins userInterfaceStyle to
 * "dark". If that ever becomes "automatic", these must move to useCSSVariable.
 *
 * `satisfies` rather than a type annotation so the string literals survive
 * (headerBlurEffect is a union, and widening to `string` would not assign).
 */
export const stackScreenOptions = {
  headerLargeTitleEnabled: true,
  headerTransparent: true,
  headerBlurEffect: "systemChromeMaterial",
  headerLargeTitleShadowVisible: false,
  // Back chevron and header buttons.
  headerTintColor: "#4C99F8",
  headerLargeTitleStyle: { color: "#F4F5F7" },
  headerTitleStyle: { color: "#F4F5F7" },
  headerBackButtonDisplayMode: "minimal",
} satisfies StackScreenOptions;
