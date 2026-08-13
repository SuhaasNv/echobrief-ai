import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { qk } from "./meetings";

/**
 * The public share link for a meeting.
 *
 * POST /meetings/:id/share is a TOGGLE that mints, not a getter: every call
 * with `enabled: true` writes a fresh 128-bit token over whatever was there, so
 * a link already sent to somebody stops working. That single fact shapes this
 * whole module — the enable call is made once, when there is no token, and
 * every later share of the same meeting rebuilds the URL from the token the
 * detail query already carries.
 */

export interface ShareLinkResponse {
  share_token: string | null;
  /** Absolute URL of the public viewer. Null when sharing was turned off. */
  share_url: string | null;
}

/**
 * Turn public sharing on or off.
 *
 * Offline this FAILS rather than parking, because createQueryClient sets
 * `networkMode: "always"` for every mutation. That default is load-bearing
 * here: a parked share would leave the user watching a share sheet that never
 * opens, against a request that dies with the process.
 */
export function useShareLink(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.apiRequest<ShareLinkResponse>(`/meetings/${id}/share`, {
        method: "POST",
        body: { enabled },
      }),

    onSuccess: (data) => {
      // Written into the cache rather than refetched. The menu reads
      // share_token to decide whether it offers "Share link" or "Stop
      // sharing", and waiting on a round-trip would leave the sheet one tap
      // behind the server it just changed.
      //
      // Typed structurally on the one field being written, matching
      // useRenameMeeting: the spread preserves every other field of the real
      // cached MeetingDetail.
      queryClient.setQueryData<{ share_token: string | null }>(qk.meeting(id), (old) =>
        old ? { ...old, share_token: data.share_token } : old,
      );
    },
  });
}
