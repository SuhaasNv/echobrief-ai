/**
 * Upgrade modal — prompts users to upgrade when they hit quota limits.
 *
 * Usage:
 *   <UpgradeModal
 *     open={showUpgrade}
 *     onClose={() => setShowUpgrade(false)}
 *     reason="You've reached your monthly transcription limit"
 *     tier="free"
 *   />
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { TIER_PRICING, TIER_FEATURES } from "@/lib/features";
import { useUpgrade } from "@/lib/api/use-subscription";
import { useState } from "react";
import type { SubscriptionTier } from "@/server/services/usage-tracker";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  reason?: string;
  currentTier?: SubscriptionTier;
}

export function UpgradeModal({ open, onClose, reason, currentTier = "free" }: UpgradeModalProps) {
  const [selectedTier, setSelectedTier] = useState<"student" | "pro" | "team">("pro");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  const upgrade = useUpgrade();

  const handleUpgrade = async () => {
    try {
      await upgrade.mutateAsync({ tier: selectedTier, billing_interval: billingInterval });
      // TODO: Once Stripe is integrated, redirect to checkout
      alert("Stripe integration pending. Contact support to upgrade.");
      onClose();
    } catch (err) {
      console.error("Upgrade failed:", err);
      alert("Upgrade failed. Please try again.");
    }
  };

  const tiers: Array<"student" | "pro" | "team"> = ["student", "pro", "team"];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upgrade Your Plan</DialogTitle>
          {reason && <DialogDescription className="text-destructive">{reason}</DialogDescription>}
          {!reason && (
            <DialogDescription>
              Unlock unlimited transcription, AI queries, and advanced features.
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Billing interval toggle */}
        <div className="flex gap-2 justify-center my-4">
          <Button
            variant={billingInterval === "monthly" ? "default" : "outline"}
            size="sm"
            onClick={() => setBillingInterval("monthly")}
          >
            Monthly
          </Button>
          <Button
            variant={billingInterval === "annual" ? "default" : "outline"}
            size="sm"
            onClick={() => setBillingInterval("annual")}
          >
            Annual (save 20%)
          </Button>
        </div>

        {/* Tier cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tiers.map((tier) => {
            const pricing = TIER_PRICING[tier];
            const features = TIER_FEATURES[tier];
            const price =
              billingInterval === "annual" ? pricing.annual_price_usd : pricing.price_usd * 12;
            const monthlyPrice =
              billingInterval === "annual" ? pricing.annual_price_usd / 12 : pricing.price_usd;
            const isSelected = selectedTier === tier;
            const isCurrent = currentTier === tier;

            return (
              <div
                key={tier}
                className={`border rounded-lg p-4 cursor-pointer transition ${
                  isSelected ? "border-primary shadow-md" : "border-border hover:border-primary/50"
                } ${isCurrent ? "opacity-60" : ""}`}
                onClick={() => !isCurrent && setSelectedTier(tier)}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-semibold">{pricing.name}</h3>
                  {isCurrent && <Badge variant="outline">Current</Badge>}
                </div>
                <div className="mb-4">
                  <span className="text-3xl font-bold">${monthlyPrice.toFixed(0)}</span>
                  <span className="text-muted-foreground">/month</span>
                  {billingInterval === "annual" && (
                    <div className="text-sm text-muted-foreground">
                      ${price}/year (save ${pricing.price_usd * 12 - pricing.annual_price_usd})
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-4">{pricing.description}</p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>
                      {features.transcription_minutes
                        ? `${features.transcription_minutes} minutes/month`
                        : "Unlimited transcription"}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>
                      {features.ai_queries
                        ? `${features.ai_queries} AI queries/month`
                        : "Unlimited AI queries"}
                    </span>
                  </li>
                  {features.flashcards && (
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>Flashcards & study mode</span>
                    </li>
                  )}
                  {features.integrations && (
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>Zapier & Slack integrations</span>
                    </li>
                  )}
                  {features.email_generation && (
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>Email generation</span>
                    </li>
                  )}
                  {features.shared_workspaces && (
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>Shared workspaces</span>
                    </li>
                  )}
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>
                      {features.history_retention_days
                        ? `${features.history_retention_days}-day history`
                        : "Unlimited history"}
                    </span>
                  </li>
                </ul>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 justify-end mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleUpgrade}
            disabled={upgrade.isPending || currentTier === selectedTier}
          >
            {upgrade.isPending ? "Processing..." : `Upgrade to ${TIER_PRICING[selectedTier].name}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
