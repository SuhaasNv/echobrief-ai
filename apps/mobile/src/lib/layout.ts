import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Bottom padding a tab screen needs so its content clears the tab bar.
 *
 * Exists because this was got wrong on four separate screens: the pattern is
 * easy to forget per-screen and impossible to see in a simulator screenshot
 * that is not scrolled to the bottom.
 *
 * ---
 *
 * This used to return `insets.bottom + 49 + extra`, on the belief that
 * react-native-screens' native tabs float above content without reporting
 * themselves to the safe area. That is wrong. UIKit already includes the bar in
 * the bottom safe-area inset: measured `insets.bottom` is 83 on this device,
 * which is the 49pt bar plus the 34pt home indicator. Adding 49 again put every
 * screen's content a full bar-height too high.
 *
 * It was invisible for a long time because over-padding never breaks anything —
 * it just leaves a gap — so it read as three unrelated layout voids rather than
 * one arithmetic bug: a 60pt sliver under the audio player, 65pt under the Ask
 * composer, and 65pt under the record button. All the same 49pt.
 *
 * Verified three ways from rendered pixels before changing it: the player card
 * sat at 141pt of clearance for a requested 8, the Ask composer at 148 for a
 * requested 16, and the record CTA at 148 for a requested 16. Each is exactly
 * 49 more than asked for.
 *
 * A ScrollView with contentInsetAdjustmentBehavior="automatic" handles the TOP
 * inset via UIKit; the bottom is always ours.
 *
 * If content ever appears UNDER the tab bar again, this is the first place to
 * look — but check `insets.bottom` on the device before adding a constant back,
 * because a hardcoded bar height is what caused this in the first place.
 *
 * @param extra Additional breathing room above the bar. Defaults to 16.
 */
export function useTabBarInset(extra = 16): number {
  const insets = useSafeAreaInsets();

  // Floor guards the case where the safe area has not resolved yet and reports
  // 0: better a slightly large gap for one frame than controls under the bar.
  const bottom = insets.bottom > 0 ? insets.bottom : 83;

  return bottom + extra;
}
