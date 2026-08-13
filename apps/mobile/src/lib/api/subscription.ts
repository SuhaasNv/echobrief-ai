import { useQuery } from "@tanstack/react-query";

import { api } from "./client";

/**
 * Mirrors GET /subscription exactly, verified against the live response.
 *
 * The shape is nested and the field names do not match between blocks: usage
 * reports `ai_queries_count` while limits reports `ai_queries`. Typing this
 * from the endpoint rather than from assumption, because guessing a response
 * shape is what crashed the app on the Actions tab.
 */
export interface SubscriptionResponse {
  subscription: {
    tier: string;
    status: string;
    billing_interval: string | null;
    current_period_end: string | null;
    price_usd: number | string | null;
  };
  usage: {
    period: string;
    transcription_minutes: number;
    ai_queries_count: number;
    flashcards_generated: number;
    workspace_count: number;
  };
  limits: {
    transcription_minutes: number | null;
    ai_queries: number | null;
    flashcards_per_lecture: number | null;
    workspaces: number | null;
  };
  features: Record<string, boolean | number>;
}

export const subscriptionKeys = {
  all: ["subscription"] as const,
};

export function useSubscription() {
  return useQuery({
    queryKey: subscriptionKeys.all,
    queryFn: () => api.apiRequest<SubscriptionResponse>("/subscription"),
  });
}
