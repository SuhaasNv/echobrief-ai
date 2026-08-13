import { useEffect } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { router, usePathname } from "expo-router";
import { File, Paths } from "expo-file-system";

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

/**
 * Tab roots take `navigate`; everything below them takes `push`.
 *
 * This is the whole reason Workspaces never appeared in a capture set. On a tab
 * root, `push` stacks a second copy of the screen onto its own stack — which is
 * why the walk moved to `navigate` in the first place. But inside the account
 * stack `navigate` does NOT push: it resolves to an route already mounted and
 * pops back to it, so profile -> plan -> password -> workspaces quietly
 * collapsed and every screenshot after it carried the name of a screen one step
 * ahead of the one in the image.
 *
 * Five tab roots, everything else is a stack screen. Kept as a set rather than a
 * segment count so adding a nested tab cannot silently pick the wrong verb.
 */
const TAB_ROOTS = new Set([
  "/(app)/meetings",
  "/(app)/record",
  "/(app)/ask",
  "/(app)/actions",
  "/(app)/account",
]);

/** Every route the walk has actually reached, oldest first. */
const ROUTE_TRAIL: string[] = [];

export function ShotDriver() {
  const queryClient = useQueryClient();
  const pathname = usePathname();

  /**
   * Ground truth for the capture set.
   *
   * The harness names files from SHOT_ROUTES by index, which silently assumes
   * every navigation landed. It does not: one route that fails to open shifts
   * every subsequent screenshot one step out of step with its own filename, and
   * the result is a review that grades the wrong screen and reports confident
   * scores for it. That has now happened twice.
   *
   * So the app states where it actually is, with a wall-clock stamp the harness
   * can match its own capture times against. Nothing is inferred afterwards:
   * a screenshot taken at T shows whichever route was last logged before T.
   *
   * Written to a file rather than drawn on screen, because a badge in the corner
   * would land in the very pixels the review is meant to judge. And to a file
   * rather than console.log, because RN's console output does not reach Metro's
   * stdout in this SDK — the first attempt at this produced zero lines.
   *
   * Paths.document resolves inside the simulator's app container, which is an
   * ordinary directory on the host, so the harness reads it directly with no
   * bridge and no polling.
   */
  useEffect(() => {
    if (!SHOT_MODE) return;
    ROUTE_TRAIL.push(`${Date.now()} ${pathname}`);
    try {
      const file = new File(Paths.document, "shot-routes.txt");
      // Rewritten whole each time: the trail is a dozen short lines, and an
      // append API that has to create-then-open is more failure surface than
      // this is worth.
      file.write(ROUTE_TRAIL.join("\n"));
    } catch {
      // Never let instrumentation take the walk down with it.
    }
  }, [pathname]);

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
          // Guarded, because the step before this one is FIRST_MEETING, which
          // skips when no meeting is cached. Popping a stack that was never
          // pushed logs "The action 'GO_BACK' was not handled by any navigator"
          // and, on a walk the user happens to be watching, looks like the app
          // arguing with itself.
          if (router.canGoBack()) router.back();
          else console.warn("[shot-driver] nothing to go back to; staying put");
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
        } else if (TAB_ROOTS.has(route)) {
          // navigate, not push. push on a tab root stacks a SECOND copy of that
          // screen onto its own stack, which put a back chevron on a tab root
          // and meant the push/pop being captured happened on a duplicate
          // rather than on the real screen.
          router.navigate(route as Parameters<typeof router.navigate>[0]);
        } else {
          // push, not navigate — see TAB_ROOTS. A stack screen reached with
          // navigate resolves to an already-mounted route instead of opening
          // the requested one.
          router.push(route as Parameters<typeof router.push>[0]);
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
