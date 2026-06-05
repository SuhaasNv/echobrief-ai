/**
 * Frontend hooks for subscription and usage data.
 *
 * Uses TanStack Query to fetch and cache subscription info from
 * /api/v1/subscription endpoint.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type { SubscriptionTier } from "../../server/services/usage-tracker";

export interface SubscriptionData {
  subscription: {
    tier: SubscriptionTier;
    status: string;
    billing_interval: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    price_usd: number | null;
    edu_email_verified: boolean;
  };
  usage: {
    period: string;
    transcription_minutes: number;
    ai_queries_count: number;
    flashcards_generated: number;
    total_cost_usd: number;
    workspace_count: number;
  };
  workspace_usage: {
    transcription_minutes: number;
    ai_queries_count: number;
    flashcards_generated: number;
  };
  limits: {
    transcription_minutes: number | null;
    ai_queries: number | null;
    flashcards_per_lecture: number | null;
    workspaces: number | null;
  };
  features: {
    integrations: boolean;
    email_generation: boolean;
    flashcards: boolean;
    unlimited_history: boolean;
    shared_workspaces: boolean;
    history_retention_days: number | null;
  };
}

/**
 * Fetch current subscription and usage data.
 */
export function useSubscription() {
  return useQuery<SubscriptionData>({
    queryKey: ["subscription"],
    queryFn: async () => {
      return apiRequest<SubscriptionData>("/subscription");
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnMount: true,
  });
}

/**
 * Check if user has a specific feature based on their tier.
 */
export function useHasFeature(feature: keyof SubscriptionData["features"]): boolean {
  const { data } = useSubscription();
  return data?.features[feature] ?? false;
}

/**
 * Check if user has reached their quota for a specific usage type.
 */
export function useQuotaStatus(usageType: "transcription_minutes" | "ai_queries" | "flashcards"): {
  current: number;
  limit: number | null;
  percentage: number;
  exceeded: boolean;
} {
  const { data } = useSubscription();

  if (!data) {
    return { current: 0, limit: null, percentage: 0, exceeded: false };
  }

  let current = 0;
  let limit: number | null = null;

  switch (usageType) {
    case "transcription_minutes":
      current = data.usage.transcription_minutes;
      limit = data.limits.transcription_minutes;
      break;
    case "ai_queries":
      current = data.usage.ai_queries_count;
      limit = data.limits.ai_queries;
      break;
    case "flashcards":
      current = data.usage.flashcards_generated;
      limit = data.limits.flashcards_per_lecture;
      break;
  }

  const percentage = limit === null ? 0 : Math.min(100, (current / limit) * 100);
  const exceeded = limit !== null && current >= limit;

  return { current, limit, percentage, exceeded };
}

/**
 * Upgrade to a paid tier.
 */
export function useUpgrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      tier: "student" | "pro" | "team";
      billing_interval: "monthly" | "annual";
    }) => {
      return apiRequest<{
        message: string;
        tier: string;
        billing_interval: string;
        user_id: string;
      }>("/subscription/upgrade", {
        method: "POST",
        body: params,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
  });
}

/**
 * Cancel active subscription.
 */
export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return apiRequest<{ message: string }>("/subscription/cancel", {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
  });
}
