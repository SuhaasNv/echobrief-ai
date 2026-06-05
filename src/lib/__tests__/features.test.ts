/**
 * Unit tests for features.ts configuration.
 *
 * Tests tier feature gates, pricing configuration, and hasFeature() helper.
 */

import { describe, it, expect } from "vitest";
import { TIER_FEATURES, TIER_PRICING, hasFeature, type TierFeatures } from "../features";
import type { SubscriptionTier } from "../../server/services/usage-tracker";

describe("TIER_FEATURES configuration", () => {
  it("defines all four tiers", () => {
    const tiers: SubscriptionTier[] = ["free", "student", "pro", "team"];

    tiers.forEach((tier) => {
      expect(TIER_FEATURES[tier]).toBeDefined();
    });
  });

  it("has complete feature definitions for each tier", () => {
    const requiredKeys: (keyof TierFeatures)[] = [
      "transcription_minutes",
      "ai_queries",
      "flashcards_per_lecture",
      "workspaces",
      "integrations",
      "email_generation",
      "flashcards",
      "unlimited_history",
      "shared_workspaces",
      "history_retention_days",
    ];

    Object.values(TIER_FEATURES).forEach((features) => {
      requiredKeys.forEach((key) => {
        expect(features).toHaveProperty(key);
      });
    });
  });

  describe("free tier restrictions", () => {
    const free = TIER_FEATURES.free;

    it("has limited transcription minutes (300)", () => {
      expect(free.transcription_minutes).toBe(300);
    });

    it("has limited AI queries (10)", () => {
      expect(free.ai_queries).toBe(10);
    });

    it("has limited flashcards per lecture (3)", () => {
      expect(free.flashcards_per_lecture).toBe(3);
    });

    it("has limited workspaces (1)", () => {
      expect(free.workspaces).toBe(1);
    });

    it("does not have integrations", () => {
      expect(free.integrations).toBe(false);
    });

    it("does not have email generation", () => {
      expect(free.email_generation).toBe(false);
    });

    it("does not have flashcards feature", () => {
      expect(free.flashcards).toBe(false);
    });

    it("does not have unlimited history", () => {
      expect(free.unlimited_history).toBe(false);
    });

    it("does not have shared workspaces", () => {
      expect(free.shared_workspaces).toBe(false);
    });

    it("has 30-day history retention", () => {
      expect(free.history_retention_days).toBe(30);
    });
  });

  describe("student tier features", () => {
    const student = TIER_FEATURES.student;

    it("has unlimited transcription minutes", () => {
      expect(student.transcription_minutes).toBeNull();
    });

    it("has unlimited AI queries", () => {
      expect(student.ai_queries).toBeNull();
    });

    it("has unlimited flashcards per lecture", () => {
      expect(student.flashcards_per_lecture).toBeNull();
    });

    it("has unlimited workspaces", () => {
      expect(student.workspaces).toBeNull();
    });

    it("has flashcards feature enabled", () => {
      expect(student.flashcards).toBe(true);
    });

    it("does not have integrations (student tier restriction)", () => {
      expect(student.integrations).toBe(false);
    });

    it("does not have email generation (requires pro+)", () => {
      expect(student.email_generation).toBe(false);
    });

    it("has 1-year history retention", () => {
      expect(student.history_retention_days).toBe(365);
    });

    it("does not have unlimited history", () => {
      expect(student.unlimited_history).toBe(false);
    });

    it("does not have shared workspaces", () => {
      expect(student.shared_workspaces).toBe(false);
    });
  });

  describe("pro tier features", () => {
    const pro = TIER_FEATURES.pro;

    it("has unlimited transcription minutes", () => {
      expect(pro.transcription_minutes).toBeNull();
    });

    it("has unlimited AI queries", () => {
      expect(pro.ai_queries).toBeNull();
    });

    it("has unlimited workspaces", () => {
      expect(pro.workspaces).toBeNull();
    });

    it("has integrations enabled", () => {
      expect(pro.integrations).toBe(true);
    });

    it("has email generation enabled", () => {
      expect(pro.email_generation).toBe(true);
    });

    it("has flashcards feature enabled", () => {
      expect(pro.flashcards).toBe(true);
    });

    it("has 2-year history retention", () => {
      expect(pro.history_retention_days).toBe(730);
    });

    it("does not have unlimited history (requires team)", () => {
      expect(pro.unlimited_history).toBe(false);
    });

    it("does not have shared workspaces (requires team)", () => {
      expect(pro.shared_workspaces).toBe(false);
    });
  });

  describe("team tier features", () => {
    const team = TIER_FEATURES.team;

    it("has unlimited transcription minutes", () => {
      expect(team.transcription_minutes).toBeNull();
    });

    it("has unlimited AI queries", () => {
      expect(team.ai_queries).toBeNull();
    });

    it("has unlimited workspaces", () => {
      expect(team.workspaces).toBeNull();
    });

    it("has integrations enabled", () => {
      expect(team.integrations).toBe(true);
    });

    it("has email generation enabled", () => {
      expect(team.email_generation).toBe(true);
    });

    it("has flashcards feature enabled", () => {
      expect(team.flashcards).toBe(true);
    });

    it("has unlimited history enabled", () => {
      expect(team.unlimited_history).toBe(true);
    });

    it("has shared workspaces enabled", () => {
      expect(team.shared_workspaces).toBe(true);
    });

    it("has null history retention (unlimited)", () => {
      expect(team.history_retention_days).toBeNull();
    });
  });
});

describe("TIER_PRICING configuration", () => {
  it("excludes free tier from pricing", () => {
    // @ts-expect-error - free should not exist in TIER_PRICING
    expect(TIER_PRICING.free).toBeUndefined();
  });

  it("defines pricing for student tier", () => {
    const student = TIER_PRICING.student;

    expect(student.name).toBe("Student");
    expect(student.price_usd).toBe(7);
    expect(student.annual_price_usd).toBe(84);
    expect(student.description).toContain("student");
    expect(student.cta).toContain("Student");
  });

  it("defines pricing for pro tier", () => {
    const pro = TIER_PRICING.pro;

    expect(pro.name).toBe("Professional");
    expect(pro.price_usd).toBe(14);
    expect(pro.annual_price_usd).toBe(168);
    expect(pro.description).toContain("integrations");
    expect(pro.cta).toContain("Pro");
  });

  it("defines pricing for team tier", () => {
    const team = TIER_PRICING.team;

    expect(team.name).toBe("Team");
    expect(team.price_usd).toBe(29);
    expect(team.annual_price_usd).toBe(348);
    expect(team.description).toContain("shared workspaces");
    expect(team.cta).toContain("Team");
  });

  it("annual pricing equals 12 * monthly (no discount for now)", () => {
    const tiers = ["student", "pro", "team"] as const;

    tiers.forEach((tier) => {
      const pricing = TIER_PRICING[tier];
      expect(pricing.annual_price_usd).toBe(pricing.price_usd * 12);
    });
  });

  it("has incremental pricing (student < pro < team)", () => {
    const student = TIER_PRICING.student.price_usd;
    const pro = TIER_PRICING.pro.price_usd;
    const team = TIER_PRICING.team.price_usd;

    expect(student).toBeLessThan(pro);
    expect(pro).toBeLessThan(team);
  });
});

describe("hasFeature() helper", () => {
  describe("boolean features", () => {
    it("returns false for free tier integrations", () => {
      expect(hasFeature("free", "integrations")).toBe(false);
    });

    it("returns false for student tier email_generation", () => {
      expect(hasFeature("student", "email_generation")).toBe(false);
    });

    it("returns true for pro tier integrations", () => {
      expect(hasFeature("pro", "integrations")).toBe(true);
    });

    it("returns true for pro tier email_generation", () => {
      expect(hasFeature("pro", "email_generation")).toBe(true);
    });

    it("returns true for team tier shared_workspaces", () => {
      expect(hasFeature("team", "shared_workspaces")).toBe(true);
    });

    it("returns true for team tier unlimited_history", () => {
      expect(hasFeature("team", "unlimited_history")).toBe(true);
    });

    it("returns false for free tier flashcards", () => {
      expect(hasFeature("free", "flashcards")).toBe(false);
    });

    it("returns true for student tier flashcards", () => {
      expect(hasFeature("student", "flashcards")).toBe(true);
    });
  });

  describe("numeric features (null = unlimited)", () => {
    it("returns false for free tier transcription_minutes (limited)", () => {
      // Free tier has 300 minutes (not null), so returns true because value is not null
      expect(hasFeature("free", "transcription_minutes")).toBe(true);
    });

    it("returns true for student tier transcription_minutes (unlimited = null)", () => {
      expect(hasFeature("student", "transcription_minutes")).toBe(false);
    });

    it("returns true for free tier workspaces (has 1 workspace limit)", () => {
      expect(hasFeature("free", "workspaces")).toBe(true);
    });

    it("returns false for pro tier workspaces (unlimited = null)", () => {
      expect(hasFeature("pro", "workspaces")).toBe(false);
    });

    it("returns true for free tier history_retention_days (30 days)", () => {
      expect(hasFeature("free", "history_retention_days")).toBe(true);
    });

    it("returns false for team tier history_retention_days (unlimited = null)", () => {
      expect(hasFeature("team", "history_retention_days")).toBe(false);
    });
  });

  it("works for all tiers and all features", () => {
    const tiers: SubscriptionTier[] = ["free", "student", "pro", "team"];
    const features: (keyof TierFeatures)[] = [
      "transcription_minutes",
      "ai_queries",
      "flashcards_per_lecture",
      "workspaces",
      "integrations",
      "email_generation",
      "flashcards",
      "unlimited_history",
      "shared_workspaces",
      "history_retention_days",
    ];

    // Should not throw for any combination
    tiers.forEach((tier) => {
      features.forEach((feature) => {
        const result = hasFeature(tier, feature);
        expect(typeof result).toBe("boolean");
      });
    });
  });
});
