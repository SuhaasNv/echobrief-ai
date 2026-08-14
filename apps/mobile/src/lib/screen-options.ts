import { useMemo, type ComponentProps } from "react";
import type { Stack } from "expo-router";

import { useColorTokens } from "@/lib/tokens";

type StackScreenOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

const TOKENS = ["--background", "--tint", "--label"] as const;

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
 * A hook rather than a constant, because none of these props takes a className:
 * they are handed to UIKit, so the colours have to arrive already resolved. All
 * four consumers are stack layout components, so there is somewhere to read
 * them from.
 *
 * Memoised on the resolved values, not rebuilt per render. This object is a
 * `screenOptions` prop, and react-native-screens re-applies options when it
 * changes identity — a fresh object every render would push a native update on
 * every parent render for a set of values that changes only with the theme.
 *
 * `satisfies` rather than a type annotation so the string literals survive
 * (headerBlurEffect is a union, and widening to `string` would not assign).
 */
export function useStackScreenOptions(): StackScreenOptions {
  const [background, tint, label] = useColorTokens(TOKENS);

  return useMemo(
    () =>
      ({
        // headerLargeTitle, NOT headerLargeTitleEnabled — the latter is not a
        // native-stack option, so it silently did nothing and the iOS search bar
        // (which docks under the large title) had no large title to attach to,
        // which read as "search is gone".
        headerLargeTitle: true,
        headerTransparent: false,
        // No blur. A material needs content behind it to blur; ours sits below
        // the header at rest, so the effect resolved to a flat grey panel with a
        // hard bottom edge — the "grey slab" across the top of every screen.
        // Painting the canvas colour makes the header disappear into the
        // background instead.
        headerStyle: { backgroundColor: background },
        // Belt and braces over the navigation theme: this is the same colour the
        // theme already gives every screen container, stated per-stack so a
        // screen that opts out of the theme still paints on the canvas.
        //
        // It is NOT what fixed the white band under the search field or the back
        // button that flashed white — those came from the navigator's own
        // container view, which no per-screen style can reach. See
        // src/lib/navigation-theme.ts.
        contentStyle: { backgroundColor: background },
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        // Back chevron and header buttons.
        headerTintColor: tint,
        // Space Grotesk on the large title only. The collapsed inline title
        // stays on the system face — it sits at 17pt beside system chrome, where
        // a display face reads as inconsistent rather than characterful.
        headerLargeTitleStyle: { color: label, fontFamily: "SpaceGrotesk_700Bold" },
        headerTitleStyle: { color: label },
        headerBackButtonDisplayMode: "minimal",
      }) satisfies StackScreenOptions,
    [background, tint, label],
  );
}
