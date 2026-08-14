import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { ApiError } from "@echobrief/shared/api";

/**
 * Turning a failure into something a person can act on.
 *
 * Three rules, and they are the reason this is one module rather than a string
 * written inline on each screen.
 *
 * 1. Offline is not a crash. React Query PAUSES a query when the device drops
 *    off the network, so a "Try again" button in that state cannot succeed: the
 *    refetch is queued, not run. Offline therefore gets `retryable: false` and a
 *    plain statement of what is happening, never a button that does nothing.
 *
 * 2. A 4xx is deterministic. The query client already refuses to retry those
 *    (see lib/query.ts), so the UI must not offer to either.
 *
 * 3. Nothing here blames the user. A failed request is the app's problem to
 *    report, and copy that implies otherwise is both rude and usually wrong.
 */

/**
 * Whether React Query currently believes the device is online.
 *
 * `onlineManager` is already wired to expo-network in lib/query.ts, so this
 * reads the same signal that decides whether a refetch will run or pause.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (callback) => onlineManager.subscribe(callback),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export interface ErrorCopy {
  /** Short statement of the situation. Never a question, never an apology. */
  title: string;
  body: string;
  /** False when trying again cannot succeed yet, so no button is offered. */
  retryable: boolean;
}

/**
 * Copy for a FETCH that failed.
 *
 * @param subject Noun phrase for the thing that did not load, lower case, in
 *                the possessive the rest of the app uses: "your plan",
 *                "your action items".
 */
export function describeError(
  error: unknown,
  { online, subject }: { online: boolean; subject: string },
): ErrorCopy {
  if (!online) {
    return {
      title: "You are offline",
      body: `EchoBrief loads ${subject} again as soon as you are back on a network.`,
      retryable: false,
    };
  }

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        title: "Your session has ended",
        body: `Sign in again to see ${subject}.`,
        retryable: false,
      };
    }

    if (error.status === 403) {
      return {
        title: "No access to this workspace",
        body: `This account cannot open ${subject} in the workspace that is selected. You can switch workspace from Account settings.`,
        retryable: false,
      };
    }

    if (error.status === 404) {
      return {
        title: `Cannot load ${subject}`,
        body: "The server has no record of it. It may have been removed from another device.",
        retryable: false,
      };
    }

    if (error.status === 429) {
      return {
        title: "Too many requests",
        body: "The server is rate limiting this account. Waiting a moment and trying again usually clears it.",
        retryable: true,
      };
    }

    if (error.status >= 500) {
      return {
        title: "EchoBrief is having trouble",
        body: `The server could not return ${subject}. This is a fault on our side, not with your account.`,
        retryable: true,
      };
    }

    return {
      title: `Cannot load ${subject}`,
      body: error.message,
      retryable: false,
    };
  }

  // No status at all: DNS, TLS, a dropped socket, or a body that was not JSON.
  // The network state says we are online, so this is worth retrying.
  return {
    title: "Cannot reach EchoBrief",
    body: `The request for ${subject} did not complete. The connection may have dropped part way through.`,
    retryable: true,
  };
}

/**
 * One sentence for a WRITE that failed: a save, a toggle, a delete.
 *
 * Separate from `describeError` because the two situations read differently.
 * "EchoBrief loads your name again once you are online" is nonsense on a save
 * that has just been rolled back.
 */
export function describeActionFailure(error: unknown, { online }: { online: boolean }): string {
  if (!online) {
    return "You are offline, so the change never reached the server.";
  }

  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Your session has ended. Sign in again and the change will stick.";
    if (error.status === 403) return "This account does not have permission to make that change.";
    if (error.status === 429) return "The server is rate limiting this account right now.";
    if (error.status >= 500) {
      return "The server could not complete the change. This is a fault on our side.";
    }
    return error.message;
  }

  return "EchoBrief could not reach the server.";
}
