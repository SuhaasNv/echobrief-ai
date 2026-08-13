import { useEffect } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { router } from "expo-router";

import { qk, type MeetingListResponse } from "@/lib/api/meetings";

/**
 * Screenshot driver for the design-review loop. Inert unless explicitly enabled.
 *
 * Why this exists: iOS 26 puts a confirmation dialog in front of every custom
 * scheme URL, so `simctl openurl` can no longer drive navigation, and idb's HID
 * tap injection silently no-ops against this simulator runtime. Neither remote
 * control path works, so the app walks itself instead.
 *
 * It advances through a fixed route list on a fixed dwell, which makes capture
 * deterministic: the harness sleeps the same interval and shoots at a known
 * offset into each window, so screenshot N is always route N.
 *
 * EXPO_PUBLIC_* is inlined by Metro at build time, so in any build that does not
 * set EXPO_PUBLIC_SHOT_MODE this compiles down to a dead branch and the hook
 * body never ships.
 */

export const SHOT_MODE = process.env.EXPO_PUBLIC_SHOT_MODE === "1";

/**
 * Dwell per route, milliseconds. Kept in sync with capture-shots.sh.
 *
 * 8s, not 5s. The harness is a clock, not a listener, so its only defence
 * against variable app boot time is a window wider than the drift. At 5s a ~10s
 * boot change put every capture two screens out, in both directions on
 * consecutive runs.
 */
export const SHOT_DWELL_MS = 8000;

/**
 * Ordered route list. The harness names files from this array by index, so
 * appending is safe and reordering renames every screenshot after the change.
 */
/**
 * Sentinel for "open the first meeting in the list". The id is only known at
 * runtime, and the push into a meeting detail — then the pop back out — is the
 * transition users actually report problems with, so the walk has to cover it.
 */
export const FIRST_MEETING = "@first-meeting";

/** Sentinel for a back navigation, which is a pop rather than a push. */
export const GO_BACK = "@back";

export const SHOT_ROUTES: readonly string[] = [
  "/(app)/meetings",
  FIRST_MEETING,
  GO_BACK,
  "/(app)/record",
  "/(app)/ask",
  "/(app)/actions",
  "/(app)/account",
  "/(app)/account/profile",
  "/(app)/account/plan",
  "/(app)/account/password",
  "/(app)/account/workspaces",
  "/(app)/account/legal",
  "/(app)/account/delete",
];

export function ShotDriver() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!SHOT_MODE) return;

    let index = 0;
    // Let the first screen mount and its entrance animations settle before the
    // walk starts, otherwise route 0 is captured mid-stagger.
    const timers: ReturnType<typeof setTimeout>[] = [];

    const step = () => {
      const route = SHOT_ROUTES[index];
      if (!route) return;
      try {
        if (route === GO_BACK) {
          router.back();
        } else if (route === FIRST_MEETING) {
          // Scan the cache rather than demanding an exact key match. Asking for
          // qk.meetings("") silently returned undefined whenever the list had
          // been fetched under any other search variant, and a sentinel that
          // fails silently just captures the previous screen under the next
          // screen's filename — which is worse than an obvious gap.
          const id = queryClient
            .getQueryCache()
            .findAll({ queryKey: qk.allMeetings })
            .map((q) => q.state.data as InfiniteData<MeetingListResponse> | undefined)
            .flatMap((data) => data?.pages ?? [])
            // Optional chaining on BOTH hops. A throw in here is caught by the
            // enclosing try/catch, which then looks identical to "no meetings
            // cached" and silently captures the previous screen under the next
            // screen's name. That is exactly how this sentinel failed twice.
            .flatMap((page) => page?.items ?? [])
            .find((m) => m?.id)?.id;

          if (id) router.push(`/(app)/meetings/${id}`);
          else console.warn("[shot-driver] no cached meeting to open");
        } else {
          // navigate, not push. push on a tab root stacks a SECOND copy of that
          // screen onto its own stack, which put a back chevron on a tab root
          // and meant the push/pop being captured happened on a duplicate
          // rather than on the real screen.
          router.navigate(route as Parameters<typeof router.navigate>[0]);
        }
      } catch {
        // A route that fails to resolve must not halt the walk: the remaining
        // screens are still worth capturing, and a gap in the output is a much
        // clearer signal than a harness that hangs.
      }
      index += 1;
      if (index < SHOT_ROUTES.length) {
        timers.push(setTimeout(step, SHOT_DWELL_MS));
      }
    };

    timers.push(setTimeout(step, SHOT_DWELL_MS));

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [queryClient]);

  return null;
}
