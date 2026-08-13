import { useCSSVariable } from "uniwind";

/**
 * Design tokens, read from JavaScript.
 *
 * Nearly all colour in this app is set through a className and never reaches
 * JS. What is left is what cannot: react-native-svg is not styled by className,
 * and neither are the native controls — Switch, RefreshControl,
 * ActivityIndicator, UISearchBar, UINavigationBar. Every one of those sites
 * carried the dark-ramp hex copied out of global.css by hand, and the cost of
 * that is on record in half a dozen comments across this codebase:
 * --label-tertiary was raised from #6E727A to #787C85 to fix roughly twenty
 * text roles measuring below AA, and the copies had to be found and moved one
 * file at a time because a hex cannot follow a CSS variable.
 *
 * The values here DO follow it. Today they still resolve to the dark ramp on
 * every read — app.json pins userInterfaceStyle, and global.css declares its
 * dark values inside `@media (prefers-color-scheme: dark)`, which uniwind
 * flattens into a single global var table rather than a per-theme one. Moving
 * those declarations onto a theme-scoped selector is what makes the switch
 * live; reading through the token is the half that has to land first.
 */

/**
 * Every colour token in global.css, spelled exactly as declared there.
 *
 * A union rather than `string`, so a typo is a compile error instead of an
 * `undefined` that renders as the platform default and is easy to miss against
 * a near-black canvas. It is the whole palette, not only the names in use — the
 * type is the vocabulary, and a caller reaching for a token that exists should
 * not have to edit this file to use it.
 */
export type ColorToken =
  | "--background"
  | "--surface"
  | "--elevated"
  | "--sheet"
  | "--label"
  | "--label-secondary"
  | "--label-tertiary"
  | "--label-quaternary"
  | "--separator"
  | "--separator-opaque"
  | "--edge"
  | "--edge-strong"
  | "--highlight"
  | "--inset"
  | "--surface-2"
  | "--surface-3"
  | "--tint"
  | "--tint-label"
  | "--tint-pressed"
  | "--violet"
  | "--success"
  | "--warning"
  | "--danger"
  | "--fill"
  | "--fill-secondary"
  | "--fill-tertiary"
  | "--speaker-a"
  | "--speaker-b"
  | "--speaker-c"
  | "--speaker-d"
  | "--speaker-e";

/**
 * `useCSSVariable` widens to `string | number | undefined`: the same call also
 * reads lengths (--radius-card resolves to a number on native), and a name
 * absent from the compiled var table resolves to nothing.
 *
 * Neither arm can be reached from `ColorToken` — every one of those names is
 * declared as a colour in global.css, and the union makes a misspelling
 * impossible — but the undefined is passed through rather than defaulted. A
 * fallback here would be a hardcoded colour, which is the thing this module
 * exists to remove, and it would silently hide a token that had been deleted
 * out from under a caller. uniwind already warns about that in dev, and every
 * colour prop these feed is optional, so the failure mode is one control
 * falling back to its platform default rather than a wrong colour shipping.
 */
function asColor(value: string | number | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** One token. Re-reads when the active theme changes. */
export function useColorToken(name: ColorToken): string | undefined {
  return asColor(useCSSVariable(name));
}

/**
 * Several tokens in one subscription, in the order given.
 *
 * Returns a plain array rather than a tuple mapped off the argument:
 * destructuring gives each element the same `string | undefined` either way,
 * and the tuple version cannot be written without a cast.
 *
 * Pass a module-level array so the argument keeps its identity across renders.
 */
export function useColorTokens(names: readonly ColorToken[]): Array<string | undefined> {
  return useCSSVariable([...names]).map(asColor);
}
