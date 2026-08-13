/**
 * Orb palette.
 *
 * The record screen is always presented on the canvas token regardless of the
 * system theme, so the orb resolves its own colours rather than going through
 * Tailwind. Every value here is a brand hue — the orb is allowed to be generous
 * with light, but it is not allowed to invent a colour.
 *
 * Blue and violet carry the form. Green is an accent that only becomes legible
 * where it crosses one of the others, which is what keeps this reading as
 * EchoBrief rather than as the generic "AI product" rainbow.
 */
export const ORB_COLOR = {
  /** tint — the dominant hue. */
  blue: "#4C99F8",
  /** The second mass. Warms the composite where it overlaps blue. */
  violet: "#A27DFA",
  /** Accent only. Never large, never at full strength. */
  green: "#2FC183",
  /** danger. The one place red appears, and only while capturing. */
  red: "#E5484D",
  /**
   * The hot centre. A blue-leaning white rather than #FFF: a pure-white core on
   * a cool field reads as a blown-out highlight instead of as a light source.
   */
  core: "#DCE9FF",
} as const;

/**
 * Gradient element ids have to be unique. react-native-svg keeps its definition
 * registry per `Svg` root on iOS, but that has not always been true across
 * versions and it is not true on every platform, so ids are suffixed from a
 * module counter rather than trusting the scoping.
 *
 * Deliberately not `useId()`: React 19 produces ids containing `«` or `:`, and
 * those cannot be safely interpolated into a `url(#…)` reference.
 */
let sequence = 0;

export function nextGradientId(prefix: string): string {
  sequence += 1;
  return `${prefix}${sequence}`;
}
