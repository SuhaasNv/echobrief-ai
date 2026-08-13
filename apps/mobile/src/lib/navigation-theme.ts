import { useMemo } from "react";
import { DarkTheme, type Theme } from "expo-router";

import { useColorTokens } from "@/lib/tokens";

/**
 * The one colour on this theme with no token behind it.
 *
 * It sits between --separator (#2A2D3A) and --separator-opaque (#383B4B) and
 * equals neither, so there is nothing to read it from without changing what
 * ships. Stated here rather than promoted into global.css: a token has to be
 * usable on a surface, and this is one slot in one third-party theme object.
 */
const BORDER = "#3A3E46";

/**
 * Navigation theme for the whole app.
 *
 * expo-router's NavigationContainer defaults `theme` to the LIGHT `DefaultTheme`
 * (`colors.background` is `rgb(242, 242, 242)`), and nothing in this app was
 * supplying one. That colour is not decorative — three separate native views
 * are painted with it on every navigator:
 *
 *   - `ScreenStack`'s `nativeContainerStyle`, i.e. the `UILayoutContainerView`
 *     that a `UINavigationController` lays its bar and its screens out inside;
 *   - the default `contentStyle` of every screen that does not set its own;
 *   - the native tab view's scene container.
 *
 * At rest those are covered by the screens themselves, so the app looks right.
 * Mid-transition they are not: while a push animates, the bar's background and
 * the outgoing screen's frame are momentarily out of step, and the light
 * container shows through the seam as a pale band across the bottom of the
 * navigation bar — under the search field on Meetings. The iOS 26 glass platter
 * behind the back chevron and the overflow button adapts to that same light
 * content, which is why those buttons resolve white and then settle dark.
 *
 * Painting the container the canvas colour removes the seam rather than hiding
 * it.
 *
 * A hook, not a constant, because `Theme` is consumed once — by the
 * `ThemeProvider` in app/_layout.tsx — and that is a component, so the tokens
 * can be read where they are used instead of copied into this file.
 *
 * Memoised because this object was a module constant with a stable identity,
 * and `ThemeProvider` puts it straight into a React context: rebuilding it per
 * render would re-render every navigator that reads the theme for a value that
 * only moves when the theme does.
 *
 * Each colour falls back to the DarkTheme entry it is overriding rather than to
 * nothing, because these five fields are typed `string` — a missing token has
 * to land on the platform's own dark palette, not on a hole.
 */
const TOKENS = ["--tint", "--background", "--label", "--danger"] as const;

export function useNavigationTheme(): Theme {
  const [tint, background, label, danger] = useColorTokens(TOKENS);

  return useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: tint ?? DarkTheme.colors.primary,
        background: background ?? DarkTheme.colors.background,
        card: background ?? DarkTheme.colors.card,
        text: label ?? DarkTheme.colors.text,
        border: BORDER,
        notification: danger ?? DarkTheme.colors.notification,
      },
    }),
    [tint, background, label, danger],
  );
}
