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
 * This is for surfaces that get NO inset from UIKit: absolutely positioned
 * chrome, and scroll views running contentInsetAdjustmentBehavior="never".
 * A scroll view running "automatic" is already inset by UIKit at BOTH ends and
 * must use SCROLL_TAB_BAR_AIR instead — see the note there.
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

/**
 * Bottom padding for the contentContainer of a scroll surface that runs
 * `contentInsetAdjustmentBehavior="automatic"`.
 *
 * Air only — no bar height — and that is the whole point.
 *
 * `automatic` asks UIKit to inset the content by the scroll view's SAFE AREA,
 * and it does that at BOTH ends, not only the top. Every screen here relies on
 * that already: the top inset is what parks content below the large title, and
 * the bottom inset is 83pt of tab-bar clearance the screen never asked for in
 * a style prop. Paying `useTabBarInset()` on top of it counted the 83 twice.
 *
 * That is the second half of the same arithmetic bug documented above, and it
 * failed in the opposite, quieter direction. Where the old `+ 49` lifted
 * ANCHORED chrome off the bar and left a visible sliver, this doubled the
 * padding at the END of scrolling content, where the only symptom is that
 * every screen keeps scrolling for one tab bar past its own last line.
 * Nothing looks wrong in a screenshot — the extra is empty canvas — which is
 * why it survived on four surfaces at once: settings, Actions, the meetings
 * list, and the transcript.
 *
 * The Ask screen was the one that had it right, and its contentContainer note
 * says why in the same terms: under `automatic`, Yoga measures against the
 * FRAME while UIKit's inset defines the visible window, so anything the
 * container adds at the bottom lands on top of the inset rather than inside it.
 *
 * Screens whose content owes clearance to something MORE than the tab bar — the
 * transcript, which also sits under the floating player — add that extra height
 * to this, never the bar again. See FollowScroll.contentPadding.
 */
export const SCROLL_TAB_BAR_AIR = 16;
