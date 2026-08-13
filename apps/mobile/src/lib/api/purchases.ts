import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { subscriptionKeys, type SubscriptionResponse } from "./subscription";

/**
 * The purchase layer, and the seam where the store SDK will plug in.
 *
 * Nothing here talks to RevenueCat yet, and that is deliberate rather than
 * unfinished. `react-native-purchases` is an autolinked NATIVE module: importing
 * it before `expo run:ios` has rebuilt the dev client is an immediate red screen
 * on launch, for every screen, not just this one. So the SDK call sites are
 * isolated behind this file and the rest of the app is written against the
 * interface — the sheet, the triggers and the Plan screen are all finished and
 * testable, and wiring the SDK is a change to one module.
 *
 * The important consequence, which the UI honours: when purchases are
 * unavailable the app says so plainly. It does NOT render a priced button that
 * does nothing. A paywall that cannot take money and does not admit it is worse
 * than no paywall, because the user concludes the app is broken at the exact
 * moment they had decided to pay.
 */

/** A purchasable plan, priced by the STORE — never by us. See `price`. */
export interface Offering {
  identifier: string;
  /**
   * Already localised and currency-formatted by StoreKit ("S$12.98", "₹299").
   * Never assembled from a number and a hardcoded "$": the same product is a
   * different price in every storefront, and a wrong price on a paywall is an
   * App Store rejection as well as a lie.
   */
  price: string;
  /** Monthly-equivalent for the annual plan, e.g. "$6.00". Null for monthly. */
  monthlyEquivalent: string | null;
  period: "monthly" | "annual";
}

export interface PurchaseAvailability {
  /** False until the native SDK is installed and configured. */
  available: boolean;
  offerings: Offering[];
  /** Why purchases are off, for the honest empty state. */
  reason: "not_configured" | null;
}

/**
 * Whether this build can take money.
 *
 * A single flag, checked in one place, so there is no path where half the UI
 * believes purchasing works. Flips to true when the SDK lands and
 * EXPO_PUBLIC_REVENUECAT_IOS_KEY is set — `EXPO_PUBLIC_*` is inlined by Metro at
 * BUILD time, so this must stay a static member expression; destructuring or
 * bracket access silently yields undefined.
 */
const REVENUECAT_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;

export function getPurchaseAvailability(): PurchaseAvailability {
  if (!REVENUECAT_KEY) {
    return { available: false, offerings: [], reason: "not_configured" };
  }

  // The SDK is configured but not yet linked in this build. Reported as
  // unavailable rather than throwing: a missing native module must degrade to an
  // honest message, not a crash on the Plan screen.
  return { available: false, offerings: [], reason: "not_configured" };
}

/**
 * Identity, called on the two session boundaries.
 *
 * The RevenueCat App User ID is the app's own `users.id`. That is what makes
 * restore-on-a-new-device work without a lookup table, and it is what lets the
 * webhook resolve a purchase to a row directly — a lookup table is exactly the
 * thing you do not want to be stale at the moment money changes hands.
 *
 * No-ops until the SDK is present, so the session code can call them
 * unconditionally today and gain the behaviour later without another edit.
 */
export async function identifyForPurchases(_userId: string): Promise<void> {
  if (!REVENUECAT_KEY) return;
}

export async function clearPurchaseIdentity(): Promise<void> {
  if (!REVENUECAT_KEY) return;
}

export type ActivationState =
  | { phase: "idle" }
  | { phase: "purchasing" }
  /** Store said yes; the server has not confirmed yet. */
  | { phase: "activating" }
  | { phase: "active" }
  /** Paid, but entitlement has not landed within the window. NOT an error. */
  | { phase: "slow" }
  | { phase: "cancelled" }
  | { phase: "failed"; message: string };

/** How long to wait for the webhook before switching to the reassuring copy. */
const ACTIVATION_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 1_200;

/**
 * Buy, then wait for the SERVER to agree.
 *
 * This is the single most important rule in the payment flow, and it is not
 * obvious: the SDK returning success is not entitlement. `subscriptions.tier` is
 * what the quota middleware enforces, and it is written by the webhook, which
 * lands a moment later. A client that trusts the SDK shows "You're Pro" while
 * the API is still returning 429 — the worst possible state, because the user
 * has paid and the app is refusing them.
 *
 * So: purchase, then show "activating", then poll GET /subscription until the
 * tier actually changes. On timeout the copy says the purchase went through and
 * to pull to refresh. It is never an error. The money left their account;
 * implying failure at that moment is how you generate a refund request and a
 * one-star review from a customer who successfully paid you.
 */
export function usePurchase() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ActivationState>({ phase: "idle" });
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const waitForEntitlement = useCallback(async () => {
    const deadline = Date.now() + ACTIVATION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (cancelled.current) return;
      try {
        const fresh = await api.apiRequest<SubscriptionResponse>("/subscription");
        if (fresh.subscription.tier !== "free") {
          queryClient.setQueryData(subscriptionKeys.all, fresh);
          if (!cancelled.current) setState({ phase: "active" });
          return;
        }
      } catch {
        // A failed poll is not a failed purchase. Keep trying until the
        // deadline; the timeout copy covers the case where it never lands.
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!cancelled.current) setState({ phase: "slow" });
    void queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
  }, [queryClient]);

  const purchase = useCallback(
    async (_offering: Offering) => {
      const availability = getPurchaseAvailability();
      if (!availability.available) {
        setState({
          phase: "failed",
          message: "Subscriptions aren't available in this build yet.",
        });
        return;
      }

      setState({ phase: "purchasing" });
      // SDK call goes here. On user cancellation set { phase: "cancelled" } —
      // cancelling is a normal outcome and must never surface as an error.
      setState({ phase: "activating" });
      await waitForEntitlement();
    },
    [waitForEntitlement],
  );

  /**
   * Restore. Required by Apple, and the first thing a returning user looks for.
   *
   * Goes through the same server-confirmation path as a purchase, for the same
   * reason: the SDK knowing about an old receipt is not the same as this
   * server having a row that says `pro`.
   */
  const restore = useCallback(async () => {
    const availability = getPurchaseAvailability();
    if (!availability.available) {
      setState({
        phase: "failed",
        message: "Subscriptions aren't available in this build yet.",
      });
      return;
    }
    setState({ phase: "activating" });
    await waitForEntitlement();
  }, [waitForEntitlement]);

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  return { state, purchase, restore, reset };
}
