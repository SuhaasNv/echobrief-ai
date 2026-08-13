import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_RESERVE } from "@/lib/layout";

/**
 * Shared player geometry.
 *
 * Its own module because the bar and the scroll follower both need it and
 * neither should import the other: the follower is used by the transcript,
 * which the bar knows nothing about.
 */

/**
 * Height of the resting player card, excluding the gap above the tab bar.
 *
 * One row, and the row is sized by its tallest child rather than by adding up
 * the things inside it: the play button is 44 (Apple's minimum) and the ribbon's
 * touch target is also 44, so 44 plus 6pt of air top and bottom is 56. Every
 * number here is a control's real size, not an estimate of one.
 *
 * The previous 128 stacked a 44pt scrub target, a time row, and a 58pt transport
 * row into three bands. Together with the tab bar beneath it that put a quarter
 * of the screen under permanent chrome, and it cut summary lines in half.
 */
export const PLAYER_BAR_HEIGHT = 56;

/**
 * Air between the player card and the tab bar.
 *
 * Six points, not the sixteen a content margin would use, and that is the whole
 * fix for the sliver. The two are both bottom chrome and they have to read as
 * ONE block: at 6pt the seam is narrower than the x-height of any type on the
 * screen, so nothing legible can pass through it. The previous 8pt over a
 * DOUBLE-COUNTED inset (see useTabBarTopEdge) put the card 60pt clear of the
 * bar, and 60pt is a reading window — the summary's header and its first line
 * were living in it, framed top and bottom by opaque chrome.
 */
export const PLAYER_TAB_BAR_GAP = 6;

/**
 * Distance from the bottom of the screen to the TOP EDGE of the native tab bar.
 *
 * Measured, not derived. On a screen inside react-native-screens' native tabs,
 * UIKit already reports the bar in `insets.bottom` — on a 402x874 device it is
 * 83, which is the 49pt bar plus the 34pt home indicator. `useTabBarInset()`
 * adds a further TAB_BAR_HEIGHT on top of that, so everything that used it was
 * parked 49pt higher than it asked to be:
 *
 *   player card    141pt of clearance for a requested 8   -> 60pt sliver
 *   ask composer   148pt for a requested 16               -> 65pt of nothing
 *   record CTA     148pt for a requested 16               -> 65pt of nothing
 *
 * All three were confirmed against device pixels in the same screenshot set.
 * This returns the real edge, so `insets.bottom + n` is n points of air above
 * the bar and nothing more.
 *
 * Reading the inset directly is also what makes this survive the fix landing in
 * lib/layout: this hook does not change meaning when that constant does.
 */
export function useTabBarTopEdge(): number {
  // The custom bar is a JS overlay, so its top edge is the home indicator plus
  // the bar's own reserved height — not `insets.bottom` alone, which since the
  // UITabBar was removed reports only the home indicator. The player card
  // floats above THIS, so reading the raw inset would park it under the bar.
  return useSafeAreaInsets().bottom + TAB_BAR_RESERVE;
}

/**
 * Height the skip band adds while it is revealed.
 *
 * Deliberately NOT part of the scroll inset. The band is opened by a tap and
 * grows upward from a bottom-anchored card, so it covers content for exactly as
 * long as the user asked it to. Reserving it permanently would give back most of
 * what collapsing the bar just won.
 */
export const PLAYER_SKIP_ROW_HEIGHT = 44;
