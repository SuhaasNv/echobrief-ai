/**
 * Feature gate configuration for subscription tiers.
 *
 * Defines which features are available for each tier (free, student, pro, team).
 * Used for both backend authorization and frontend UI gating.
 */

import type { SubscriptionTier } from "../server/services/usage-tracker";

export interface TierFeatures {
  // Usage limits (null = unlimited)
  transcription_minutes: number | null;
  ai_queries: number | null;
  flashcards_per_lecture: number | null;
  workspaces: number | null;

  // Feature flags
  integrations: boolean; // Zapier, Slack, etc.
  email_generation: boolean;
  flashcards: boolean;
  unlimited_history: boolean; // vs 30-day retention

  // Collaboration
  shared_workspaces: boolean;

  // Data retention (days, null = unlimited)
  history_retention_days: number | null;
}

export const TIER_FEATURES: Record<SubscriptionTier, TierFeatures> = {
  free: {
    transcription_minutes: 300, // 5 hours/month
    ai_queries: 10,
    flashcards_per_lecture: 3,
    workspaces: 1,
    integrations: false,
    email_generation: false,
    flashcards: false, // flashcards require student+
    unlimited_history: false,
    shared_workspaces: false,
    history_retention_days: 30,
  },
  student: {
    transcription_minutes: null, // unlimited
    ai_queries: null,
    flashcards_per_lecture: null,
    workspaces: null,
    integrations: false,
    email_generation: false,
    flashcards: true,
    unlimited_history: false,
    shared_workspaces: false,
    history_retention_days: 365, // 1 year
  },
  pro: {
    transcription_minutes: null,
    ai_queries: null,
    flashcards_per_lecture: null,
    workspaces: null,
    integrations: true,
    email_generation: true,
    flashcards: true,
    unlimited_history: false,
    shared_workspaces: false,
    history_retention_days: 730, // 2 years
  },
  team: {
    transcription_minutes: null,
    ai_queries: null,
    flashcards_per_lecture: null,
    workspaces: null,
    integrations: true,
    email_generation: true,
    flashcards: true,
    unlimited_history: true,
    shared_workspaces: true,
    history_retention_days: null, // unlimited
  },
};

/**
 * Check if a tier has access to a specific feature.
 */
export function hasFeature(tier: SubscriptionTier, feature: keyof TierFeatures): boolean {
  const features = TIER_FEATURES[tier];
  const value = features[feature];
  return typeof value === "boolean" ? value : value !== null;
}

/**
 * Get tier pricing information (used by frontend pricing page).
 */
export interface TierPricing {
  name: string;
  price_usd: number;
  annual_price_usd: number;
  description: string;
  cta: string;
}

export const TIER_PRICING: Record<Exclude<SubscriptionTier, "free">, TierPricing> = {
  student: {
    name: "Student",
    price_usd: 7,
    annual_price_usd: 84,
    description: "Unlimited transcription, AI queries, and flashcards for students.",
    cta: "Upgrade to Student",
  },
  pro: {
    name: "Professional",
    price_usd: 14,
    annual_price_usd: 168,
    description: "Everything in Student, plus integrations and email generation.",
    cta: "Upgrade to Pro",
  },
  team: {
    name: "Team",
    price_usd: 29,
    annual_price_usd: 348,
    description: "Everything in Pro, plus shared workspaces and unlimited history.",
    cta: "Upgrade to Team",
  },
};
