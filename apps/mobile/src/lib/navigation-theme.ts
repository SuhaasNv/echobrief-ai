import { DarkTheme, type Theme } from "expo-router";

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
 * it. Keep `background` in sync with `--color-background` in global.css.
 */
export const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#4C99F8",
    background: "#06070A",
    card: "#06070A",
    text: "#F4F5F7",
    border: "#3A3E46",
    notification: "#FF5F62",
  },
};
