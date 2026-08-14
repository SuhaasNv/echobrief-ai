import { useEffect, useMemo } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useOnline } from "@/lib/api/errors";
import { SettingIcon } from "@/components/settings/rows";
import { openWeb } from "@/components/settings/links";
import { PaywallHero } from "./hero";
import { getPurchaseAvailability, usePurchase, type Offering } from "@/lib/api/purchases";
import { haptics } from "@/lib/haptics";

/**
 * The paywall — a full screen, built around the app's signature graphic.
 *
 * Written against one belief: people pay to stop losing something they already
 * have, far more readily than to gain something they have never had. So it
 * opens with the user's OWN numbers — hours recorded, meetings captured,
 * recordings about to expire — and only then says what Pro does about it. A
 * paywall that opens with a feature grid is asking a stranger to imagine a
 * benefit; this one reminds someone of work they have already done.
 *
 * FULL SCREEN, and the earlier note here argued against that. The argument was
 * that a sheet is less coercive, which is true of an INTERRUPTIVE paywall — one
 * that appears because you hit a wall. It is not true of this one. Every route
 * in is a tap the user chose, and for a screen someone opened on purpose, a
 * half-height sheet is a worse deal: the hero has nowhere to live, the benefits
 * scroll under the fold, and the whole thing reads as a nag rather than an
 * offer. The safety property that actually matters is preserved below.
 *
 * Three rules it does not break:
 *
 *   Never at launch, and NEVER mid-recording. That is the real constraint — a
 *   subscription prompt over an in-progress meeting loses the meeting and the
 *   customer. "Not now" dismisses instantly with no delay and no guilt copy.
 *
 *   Prices come from the STORE. `offering.price` is already localised by
 *   StoreKit. Nothing here formats a currency, because the same product is a
 *   different number in every storefront and a hardcoded "$9" is both a lie and
 *   a review rejection.
 *
 *   The commit button is the app's near-white pill, the same treatment as the
 *   recorder's primary action. No new accent is invented — `--tint` means
 *   navigation in this app, and borrowing it for commit would blur both.
 *
 *   If it cannot take money, it says so. No priced button that does nothing.
 */

export type PaywallTrigger = "retention" | "ask_limit" | "minutes_limit" | "settings";

export interface PaywallUsage {
  minutesThisMonth: number;
  /**
   * Optional, because not every caller has it. GET /subscription reports usage
   * minutes but no meeting count, and the Plan screen has no meetings query —
   * so rather than invent the number, the copy below drops the clause. A
   * slightly shorter true sentence beats a fuller invented one on the screen
   * where trust decides whether someone pays.
   */
  meetingCount?: number;
  /** Recordings whose audio is about to be deleted on Free. */
  expiringSoon?: { count: number; onDate: string } | null;
  /** For the Ask trigger — when the allowance comes back. */
  resetsOn?: string | null;
  /** For the minutes trigger. */
  minutesLimit?: number | null;
}

export interface PaywallSheetProps {
  visible: boolean;
  trigger: PaywallTrigger;
  usage: PaywallUsage;
  onDismiss: () => void;
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/**
 * The opening line, built from what actually happened.
 *
 * Every branch names a real number. There is no generic fallback that says
 * "Unlock more" — if the app cannot say something true and specific about this
 * user, the honest move is the plainest sentence, not a marketing one.
 */
function openingLine(trigger: PaywallTrigger, usage: PaywallUsage): string {
  const recorded = formatHours(usage.minutesThisMonth);

  // "across N meetings" only when N is actually known.
  const across = usage.meetingCount ? ` across ${usage.meetingCount} meetings` : "";

  if (trigger === "retention" && usage.expiringSoon && usage.expiringSoon.count > 0) {
    const { count, onDate } = usage.expiringSoon;
    return `You've recorded ${recorded}${across} this month. On Free, audio is deleted after 7 days — ${count} ${count === 1 ? "recording expires" : "recordings expire"} on ${formatDate(onDate)}.`;
  }

  if (trigger === "ask_limit") {
    const reset = formatDate(usage.resetsOn);
    return reset
      ? `You've used every question in this month's allowance. It resets on ${reset}.`
      : "You've used every question in this month's allowance.";
  }

  if (trigger === "minutes_limit" && usage.minutesLimit) {
    return `You've recorded ${recorded} of your ${formatHours(usage.minutesLimit)} this month.`;
  }

  // Only claims a figure when there is one. A brand-new account has recorded
  // nothing, and telling them they recorded 0 min is a worse opening than
  // saying plainly what the plan does.
  return usage.minutesThisMonth > 0
    ? `You've recorded ${recorded}${across} this month.`
    : "Pro lifts recording to 15 hours a month and Ask to 500 questions.";
}

const HEADLINES: Record<PaywallTrigger, string> = {
  retention: "Keep your recordings",
  ask_limit: "Ask more questions",
  minutes_limit: "More recording time",
  settings: "EchoBrief Pro",
};

/**
 * Only things Pro ACTUALLY gates.
 *
 * The retention claim that used to lead this list — "Audio kept as long as you
 * want. Free deletes recordings after 7 days." — was false, and it was the
 * headline benefit. `audio_retention_days` is a plain preference with no tier
 * check anywhere: `settings/preferences.ts` offers "Until I delete it" to
 * everyone, `account.ts` writes it without consulting a tier, and
 * `cleanup-r2.ts` filters out `0` entirely. A free user four screens away
 * already keeps audio forever. Charging for it is the worst version of the
 * dishonest-control problem this app has spent real effort removing, and on a
 * paywall it is also an App Store 3.1.2 finding.
 *
 * Both remaining claims are enforced in TIER_LIMITS and provable in the code:
 * 900 minutes and 500 questions against free's 120 and 25.
 *
 * If retention is meant to be a Pro feature — and MONETIZATION.md assumes it is
 * — the fix is to gate it server-side, not to describe it as gated here. That
 * is a real change with a data consequence (clamping an existing free account
 * to 7 days makes audio they already have eligible for deletion), so it is a
 * decision, not a copy edit.
 */
const BENEFITS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: "waveform",
    title: "15 hours of recording a month",
    body: "Up from 2 hours — roughly a meeting a day, with room for the long ones.",
  },
  {
    icon: "bubble.left.and.text.bubble.right",
    title: "500 questions a month",
    body: "Up from 25. Ask across every meeting you've recorded, not just the last few.",
  },
  {
    icon: "chart.bar.doc.horizontal",
    title: "Summaries written your way",
    body: "Pick the style, length and tone once and every meeting after it follows.",
  },
];

function Benefit({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View className="flex-row gap-3">
      {/* The settings chip, imported rather than restyled. A second icon
          treatment on the one screen asking for money is exactly where a
          product starts to look assembled from parts. */}
      {/* Violet, not neutral. At neutral these were a grey glyph on --fill and
          read as three smudges on screen — carrying no information at the size
          they render. Violet also continues the chip on the "Upgrade to Pro"
          row that opened this sheet, so the accent means "the Pro thing" in
          both places rather than being decoration in one. */}
      <View className="mt-0.5">
        <SettingIcon symbol={icon} tone="violet" />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-[15px] font-semibold text-label" maxFontSizeMultiplier={1.4}>
          {title}
        </Text>
        <Text
          className="text-[13px] leading-[18px] text-label-secondary"
          maxFontSizeMultiplier={1.5}
        >
          {body}
        </Text>
      </View>
    </View>
  );
}

export function PaywallSheet({ visible, trigger, usage, onDismiss }: PaywallSheetProps) {
  const reduceMotion = useReducedMotion();
  const online = useOnline();
  const { state, purchase, restore, reset } = usePurchase();
  const availability = useMemo(() => getPurchaseAvailability(), []);

  // Every presentation starts clean. Without this, dismissing mid-purchase and
  // reopening shows the previous attempt's error over a fresh screen.
  useEffect(() => {
    if (visible) reset();
  }, [visible, reset]);

  // Success closes on its own. Making someone tap "Done" after paying is one
  // more step between them and the thing they just bought.
  useEffect(() => {
    if (state.phase === "active") {
      void haptics.success();
      onDismiss();
    } else if (state.phase === "failed") {
      // The failure twin of the success above. "cancelled" (the user backed out)
      // and "slow" (paid, entitlement just late) are NOT failures, so only a real
      // failure earns the error notification — a purchase is a terminal outcome.
      void haptics.error();
    }
  }, [state.phase, onDismiss]);

  const monthly = availability.offerings.find((o) => o.period === "monthly") ?? null;
  const annual = availability.offerings.find((o) => o.period === "annual") ?? null;
  const busy = state.phase === "purchasing" || state.phase === "activating";

  return (
    <Modal
      visible={visible}
      // fullScreen, not overFullScreen: this is a destination, and the card
      // behind it showing through would undercut that.
      presentationStyle="fullScreen"
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={onDismiss}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <PaywallBody
          trigger={trigger}
          usage={usage}
          onDismiss={onDismiss}
          monthly={monthly}
          annual={annual}
          available={availability.available}
          online={online}
          busy={busy}
          state={state}
          onPurchase={purchase}
          onRestore={restore}
          reduceMotion={reduceMotion}
        />
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * A figure the user earned, in the bento seam language the library header uses.
 *
 * Their own numbers, not ours. "4h 20m recorded" is a fact about their month;
 * "Unlimited recording" is a claim about our product, and the first is what
 * makes the second feel like it is worth something.
 */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 gap-1 bg-surface p-3.5">
      <Text
        className="font-display text-[22px] leading-[24px] text-label"
        style={{ letterSpacing: 0.4 }}
        maxFontSizeMultiplier={1.3}
      >
        {value}
      </Text>
      <Text
        className="text-[11px] font-semibold uppercase text-label-tertiary"
        style={{ letterSpacing: 0.8 }}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </View>
  );
}

function PaywallBody({
  trigger,
  usage,
  onDismiss,
  monthly,
  annual,
  available,
  online,
  busy,
  state,
  onPurchase,
  onRestore,
  reduceMotion,
}: {
  trigger: PaywallTrigger;
  usage: PaywallUsage;
  onDismiss: () => void;
  monthly: Offering | null;
  annual: Offering | null;
  available: boolean;
  online: boolean;
  busy: boolean;
  state: ReturnType<typeof usePurchase>["state"];
  onPurchase: (o: Offering) => void;
  onRestore: () => void;
  reduceMotion: boolean;
}) {
  const insets = useSafeAreaInsets();

  // Only rendered when there is something true to put in it. A strip of zeroes
  // on a new account is worse than no strip: it advertises that they have not
  // used the product on the screen asking them to pay for it.
  const hasStats = usage.minutesThisMonth > 0;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Close sits top-LEFT, where a full-screen modal's dismiss lives on
            iOS, and is the first thing reachable rather than something to hunt
            for under the offer. */}
        <View className="px-4">
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            className="h-9 w-9 items-center justify-center rounded-full bg-fill active:opacity-70"
          >
            <Text className="text-[17px] leading-[20px] text-label-secondary">×</Text>
          </Pressable>
        </View>

        {/* The signature graphic, doing the work an icon grid cannot.
            Three rows, not four: at four the last card below was sliced
            mid-sentence by the pinned commit bar on a 6.3" screen, which reads
            as a rendering fault rather than as more content. Three still reads
            as a stack — a library accumulating — and the whole offer fits
            without scrolling, which is what a screen someone opened on purpose
            should do. */}
        <View className="px-5 pb-5 pt-5">
          <PaywallHero rows={3} />
        </View>

        <View className="gap-5 px-5">
          <View className="gap-2.5">
            <Text
              className="font-display text-[32px] leading-[36px] text-label"
              maxFontSizeMultiplier={1.25}
            >
              {HEADLINES[trigger]}
            </Text>
            <Text
              className="text-[16px] leading-[23px] text-label-secondary"
              maxFontSizeMultiplier={1.5}
            >
              {openingLine(trigger, usage)}
            </Text>
          </View>

          {hasStats ? (
            <View
              className="flex-row overflow-hidden rounded-card border border-edge bg-edge"
              style={{ borderCurve: "continuous", gap: 1 }}
            >
              <View
                className="absolute inset-x-0 top-0 z-10 h-px bg-highlight"
                pointerEvents="none"
              />
              <Stat value={formatHours(usage.minutesThisMonth)} label="Recorded" />
              {usage.meetingCount ? (
                <Stat value={String(usage.meetingCount)} label="Meetings" />
              ) : null}
              {usage.expiringSoon?.count ? (
                <Stat value={String(usage.expiringSoon.count)} label="Expiring" />
              ) : null}
            </View>
          ) : null}

          {/* Fills what was dead space between the benefits and the commit
              button — and fills it with the two things a buyer is actually
              anxious about rather than with padding. Both are true: downgrading
              reverts retention going forward and deletes nothing, and Apple
              handles cancellation. Answering the objection next to the button
              beats answering it in a support email later. */}
          <View className="gap-4">
            {BENEFITS.map((b, i) => (
              <Animated.View
                key={b.title}
                entering={reduceMotion ? undefined : FadeInDown.duration(280).delay(320 + i * 70)}
              >
                <Benefit {...b} />
              </Animated.View>
            ))}
          </View>

          <View
            className="gap-1.5 rounded-card border border-edge bg-surface p-4"
            style={{ borderCurve: "continuous" }}
          >
            <Text className="text-[14px] font-semibold text-label" maxFontSizeMultiplier={1.4}>
              Cancel whenever you like
            </Text>
            <Text
              className="text-[13px] leading-[18px] text-label-secondary"
              maxFontSizeMultiplier={1.5}
            >
              Managed by Apple, so cancelling takes two taps and never goes through us. Going back
              to Free never deletes a recording — only how long new audio is kept changes.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Commit region, pinned outside the scroll so it is reachable without
          scrolling on any device and at any Dynamic Type size. */}
      <View
        className="gap-3 border-t border-edge bg-background px-5 pt-4"
        style={{ paddingBottom: insets.bottom + 10 }}
      >
        {!available ? (
          /* The honest state. No priced button that cannot charge anyone — a
             dead commit button at the moment someone decided to pay is worse
             than telling them plainly that it is not ready. */
          <View
            className="gap-1.5 rounded-card bg-surface p-4"
            style={{ borderCurve: "continuous" }}
          >
            <Text className="text-[15px] font-semibold text-label" maxFontSizeMultiplier={1.4}>
              Not open for subscriptions yet
            </Text>
            {/* Was: "Pro is finished on our side and waiting on App Store
                review." Neither half was true — the store products do not
                exist and nothing is in review — and the sentence continued
                "nothing you record now will be lost", which contradicted the
                7-day retention line 300pt above it on the same screen. Saying
                less is the only honest option while the answer is "not yet". */}
            <Text
              className="text-[13px] leading-[18px] text-label-secondary"
              maxFontSizeMultiplier={1.5}
            >
              Pro isn&apos;t on sale yet. Everything you record in the meantime stays on your
              account.
            </Text>
          </View>
        ) : !online ? (
          /* Said BEFORE the tap. A purchase that fails at the tap because the
             network was already down wastes the one moment of intent you get. */
          <View className="rounded-card bg-surface p-4" style={{ borderCurve: "continuous" }}>
            <Text className="text-[14px] text-label-secondary" maxFontSizeMultiplier={1.5}>
              You&apos;re offline. Reconnect to subscribe.
            </Text>
          </View>
        ) : (
          <>
            <Pressable
              disabled={busy || !monthly}
              onPress={() => {
                if (!monthly) return;
                void haptics.tap();
                onPurchase(monthly);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Subscribe for ${monthly?.price ?? ""} a month`}
              className="h-[52px] flex-row items-center justify-center gap-2 rounded-control bg-label active:opacity-90"
              style={{ borderCurve: "continuous", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? (
                <>
                  <ActivityIndicator color="#000" />
                  <Text className="text-[16px] font-semibold text-background">
                    {state.phase === "activating" ? "Activating…" : "One moment…"}
                  </Text>
                </>
              ) : (
                <Text
                  className="text-[16px] font-semibold text-background"
                  maxFontSizeMultiplier={1.3}
                >
                  {monthly ? `Subscribe — ${monthly.price}/month` : "Subscribe"}
                </Text>
              )}
            </Pressable>

            {annual ? (
              <Pressable
                disabled={busy}
                onPress={() => {
                  void haptics.tap();
                  onPurchase(annual);
                }}
                accessibilityRole="button"
                className="items-center py-1"
              >
                {/* "billed annually" is never omitted. "$6/month" alone, for a
                    plan charged once a year, is the framing reviewers and
                    regulators treat as deceptive. */}
                <Text className="text-[13px] text-label-tertiary" maxFontSizeMultiplier={1.4}>
                  or {annual.monthlyEquivalent ?? annual.price}/month billed annually
                </Text>
              </Pressable>
            ) : null}
          </>
        )}

        {/* Paid, but the webhook has not landed. Deliberately reassuring and
            deliberately NOT an error — the money has left their account. */}
        {state.phase === "slow" ? (
          <Text
            className="text-center text-[13px] leading-[18px] text-label-secondary"
            maxFontSizeMultiplier={1.5}
          >
            Your purchase went through. It can take a moment to activate — pull down to refresh on
            the Plan screen.
          </Text>
        ) : null}

        {state.phase === "failed" ? (
          <Text className="text-center text-[13px] text-danger" maxFontSizeMultiplier={1.5}>
            {state.message}
          </Text>
        ) : null}

        <View className="flex-row items-center justify-center gap-3 pt-0.5">
          {/* Restore is required by Apple and is the first thing a returning
              user looks for after reinstalling. */}
          <Pressable onPress={onRestore} disabled={busy || !available} accessibilityRole="button">
            <Text className="text-[12px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
              Restore purchases
            </Text>
          </Pressable>
          <Text className="text-[12px] text-label-quaternary">·</Text>
          {/* Real links. These were plain Text — they LOOKED like links and did
              nothing, which is an App Store rejection on a paywall, not a polish
              item: Apple requires functional Terms and Privacy links wherever a
              subscription is offered. */}
          <Pressable
            onPress={() => openWeb("/terms")}
            accessibilityRole="link"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text className="text-[12px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
              Terms
            </Text>
          </Pressable>
          <Text className="text-[12px] text-label-quaternary">·</Text>
          <Pressable
            onPress={() => openWeb("/privacy")}
            accessibilityRole="link"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text className="text-[12px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
              Privacy
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
