/**
 * Quota banner — shows usage progress and warns when approaching limits.
 *
 * Displays on dashboard and other key pages when user is on free tier.
 */

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, Zap } from "lucide-react";
import { useSubscription, useQuotaStatus } from "@/lib/api/use-subscription";
import { useState } from "react";
import { UpgradeModal } from "./upgrade-modal";

export function QuotaBanner() {
  const { data: subscription } = useSubscription();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const transcriptionQuota = useQuotaStatus("transcription_minutes");
  const aiQueryQuota = useQuotaStatus("ai_queries");

  // Only show for free tier
  if (!subscription || subscription.subscription.tier !== "free") {
    return null;
  }

  // Show warning if any quota is above 80%
  const showWarning = transcriptionQuota.percentage >= 80 || aiQueryQuota.percentage >= 80;

  const showCritical = transcriptionQuota.exceeded || aiQueryQuota.exceeded;

  if (!showWarning && !showCritical) {
    return null;
  }

  return (
    <>
      <Alert variant={showCritical ? "destructive" : "default"} className="mb-6">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="font-semibold mb-2">
              {showCritical
                ? "You've reached your monthly quota limit"
                : "You're approaching your monthly quota limits"}
            </div>
            <div className="space-y-2 text-sm">
              {/* Transcription progress */}
              {transcriptionQuota.limit !== null && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span>
                      Transcription: {transcriptionQuota.current} / {transcriptionQuota.limit}{" "}
                      minutes
                    </span>
                    <span>{transcriptionQuota.percentage.toFixed(0)}%</span>
                  </div>
                  <Progress value={transcriptionQuota.percentage} className="h-2" />
                </div>
              )}

              {/* AI queries progress */}
              {aiQueryQuota.limit !== null && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span>
                      AI Queries: {aiQueryQuota.current} / {aiQueryQuota.limit}
                    </span>
                    <span>{aiQueryQuota.percentage.toFixed(0)}%</span>
                  </div>
                  <Progress value={aiQueryQuota.percentage} className="h-2" />
                </div>
              )}
            </div>
          </div>
          <Button size="sm" onClick={() => setShowUpgrade(true)} className="flex-shrink-0">
            <Zap className="h-4 w-4 mr-1" />
            Upgrade
          </Button>
        </AlertDescription>
      </Alert>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        reason={
          showCritical
            ? "Upgrade to continue using EchoBrief without limits"
            : "Upgrade now to avoid interruptions"
        }
        currentTier={subscription.subscription.tier}
      />
    </>
  );
}
