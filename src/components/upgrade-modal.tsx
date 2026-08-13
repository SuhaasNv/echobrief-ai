import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TIER_FEATURES } from "@/lib/features";
import type { SubscriptionTier } from "@/server/services/usage-tracker";

/**
 * The web upgrade dialog — a pointer, not a checkout.
 *
 * What this used to be: a three-column tier picker (Student / Pro / Team) with
 * a monthly/annual toggle, 21 identical checkmarks, and a submit button that
 * POSTed `/subscription/upgrade` and then called `alert("Stripe integration
 * pending. Contact support to upgrade.")`.
 *
 * Three things were wrong with it and one became urgent:
 *
 *   The endpoint now answers **410 by design** — subscriptions moved to Apple
 *   IAP — so every click took the catch branch and alerted "Upgrade failed.
 *   Please try again." It had not failed; there was never an upgrade to try.
 *
 *   Two of the three tiers are no longer sold. Student and team still resolve
 *   for accounts already on them, but offering them here would sell a plan the
 *   product cannot deliver — `team` in particular has no team, because every
 *   query in the app is scoped by `user_id`.
 *
 *   `alert()` on the revenue path exposes internal build status in a native
 *   browser dialog to the one person who had decided to give you money.
 *
 * Apple requires IAP for digital content consumed in an iOS app, and steering
 * users to a web checkout is what gets an app rejected. So the web cannot sell
 * this even in principle — which makes an honest pointer the *correct* design
 * here, not a placeholder for a real one.
 */

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  /** Why the user landed here — e.g. the quota they just hit. */
  reason?: string;
  currentTier?: SubscriptionTier;
}

export function UpgradeModal({ open, onClose, reason, currentTier = "free" }: UpgradeModalProps) {
  const free = TIER_FEATURES.free;
  const pro = TIER_FEATURES.pro;

  /**
   * Read from TIER_FEATURES rather than written out.
   *
   * The old copy said "unlimited transcription, AI queries, and advanced
   * features". Pro is not unlimited — it carries a 900-minute and 500-question
   * fair-use ceiling — and "advanced features" names nothing. Generating the
   * lines from the same table the server enforces means this text cannot drift
   * away from what the user actually gets.
   */
  const lines = [
    pro.transcription_minutes && free.transcription_minutes
      ? `${Math.round(pro.transcription_minutes / 60)} hours of recording a month, up from ${Math.round(free.transcription_minutes / 60)}.`
      : null,
    pro.ai_queries && free.ai_queries
      ? `${pro.ai_queries} questions a month, up from ${free.ai_queries}.`
      : null,
    "Summary style, length and tone you set once and every meeting follows.",
  ].filter((l): l is string => l !== null);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pro is sold in the iOS app</DialogTitle>
          <DialogDescription>
            {reason ??
              "Subscriptions are billed by Apple, so the upgrade happens on your iPhone rather than here."}
          </DialogDescription>
        </DialogHeader>

        <ul className="mt-2 space-y-2.5">
          {lines.map((line) => (
            <li key={line} className="flex gap-2.5 text-sm leading-relaxed">
              {/* One bullet, not a checkmark per line. The old version drew 21
                  identical checks across three columns — when every row has a
                  check, the check has stopped meaning anything. */}
              <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-sm text-muted-foreground">
          Open <span className="text-foreground">Account &rsaquo; Plan</span> in the app on your
          iPhone. Your recordings and settings are the same account, so anything you upgrade there
          applies here immediately.
        </p>

        {currentTier !== "free" && (
          <p className="mt-2 text-sm text-muted-foreground">
            You are already on {currentTier}. Manage or cancel it in Settings &rsaquo; your name
            &rsaquo; Subscriptions on your iPhone.
          </p>
        )}

        <div className="mt-5 flex justify-end">
          {/* One action, and it is honest about what it does. There is no
              second "Upgrade" button, because pressing it here cannot work. */}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
