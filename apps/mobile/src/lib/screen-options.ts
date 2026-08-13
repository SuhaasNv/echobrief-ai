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
  headerTransparent: false,
  // No blur. A material needs content behind it to blur; ours sits below the
  // header at rest, so the effect resolved to a flat grey panel with a hard
  // bottom edge — the "grey slab" across the top of every screen. Painting the
  // canvas colour makes the header disappear into the background instead.
  headerStyle: { backgroundColor: "#06070A" },
  // Belt and braces over the navigation theme: this is the same colour the
  // theme already gives every screen container, stated per-stack so a screen
  // that opts out of the theme still paints on the canvas.
  //
  // It is NOT what fixed the white band under the search field or the back
  // button that flashed white — those came from the navigator's own container
  // view, which no per-screen style can reach. See src/lib/navigation-theme.ts.
  contentStyle: { backgroundColor: "#06070A" },
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
  // Back chevron and header buttons.
  headerTintColor: "#4C99F8",
  // Space Grotesk on the large title only. The collapsed inline title stays on
  // the system face — it sits at 17pt beside system chrome, where a display
  // face reads as inconsistent rather than characterful.
  headerLargeTitleStyle: { color: "#F4F5F7", fontFamily: "SpaceGrotesk_700Bold" },
  headerTitleStyle: { color: "#F4F5F7" },
  headerBackButtonDisplayMode: "minimal",
} satisfies StackScreenOptions;
