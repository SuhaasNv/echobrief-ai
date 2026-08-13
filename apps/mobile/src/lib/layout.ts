import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The custom tab bar's geometry, in ONE place.
 *
 * The bar is now a JS overlay (components/tab-bar/custom-tab-bar.tsx), not a
 * UITabBar, so UIKit no longer reports it in `insets.bottom` — that value is
 * back down to just the home indicator (~34). Every clearance below is measured
 * against these constants instead of a magic number, so re-tuning the bar's
 * height is one edit here and nothing hides behind it.
 *
 *   HEIGHT      the pill's own height
 *   BOTTOM_GAP  the float above the home indicator
 *   SIDE_INSET  the float in from each screen edge
 *   RESERVE     HEIGHT + BOTTOM_GAP — the total the bar occupies above the
 *               bottom safe-area edge, which is what content must clear.
 */
export const TAB_BAR_HEIGHT = 60;
export const TAB_BAR_BOTTOM_GAP = 10;
export const TAB_BAR_SIDE_INSET = 16;
export const TAB_BAR_RESERVE = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP;

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

  // Home indicator only now (~34 with one, 0 without). The bar's own height is
  // added explicitly rather than read out of `insets.bottom`, because a custom
  // overlay is not part of the safe area the way a UITabBar was.
  //
  // Floor guards the not-yet-resolved frame where insets read 0 on a device
  // that does have a home indicator: a slightly large gap for one frame beats
  // controls under the bar.
  const bottom = insets.bottom > 0 ? insets.bottom : 34;

  return bottom + TAB_BAR_RESERVE + extra;
}

/**
 * Bottom padding for the contentContainer of a scroll surface that runs
 * `contentInsetAdjustmentBehavior="automatic"`.
 *
 * `automatic` asks UIKit to inset the content by the scroll view's SAFE AREA at
 * BOTH ends. The top inset parks content below the large title; the bottom
 * inset is now just the HOME INDICATOR (~34), because the UITabBar that used to
 * live in the safe area is gone — the bar is a JS overlay.
 *
 * So this adds the bar itself on top: TAB_BAR_RESERVE (its height + float) plus
 * 16pt of air. Total bottom clearance = automatic's home-indicator inset +
 * TAB_BAR_RESERVE + 16, which lands content exactly 16pt above the floating
 * bar's top edge.
 *
 * History worth keeping, because it is the trap to avoid: under the native
 * UITabBar this value was 16, because `automatic` already supplied the 83pt bar
 * inset and adding the bar again double-counted it — every screen scrolled one
 * bar-height past its own last line. That failure was silent (extra empty
 * canvas, invisible in a screenshot) and shipped on four surfaces at once. The
 * custom bar inverts it: automatic no longer supplies the bar, so the bar must
 * be added back here — but exactly once, and only here.
 *
 * Screens whose content owes clearance to something MORE than the tab bar — the
 * transcript, which also sits under the floating player — add that extra height
 * to this, never the bar again. See FollowScroll.contentPadding.
 */
export const SCROLL_TAB_BAR_AIR = TAB_BAR_RESERVE + 16;
