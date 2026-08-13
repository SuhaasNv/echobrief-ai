import { useEffect, useMemo } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion } from "react-native-reanimated";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useOnline } from "@/lib/api/errors";
import { SettingIcon } from "@/components/settings/rows";
import { getPurchaseAvailability, usePurchase, type Offering } from "@/lib/api/purchases";
import { haptics } from "@/lib/haptics";
import { TIMING } from "@/lib/motion";

/**
 * The paywall.
 *
 * Written against one belief: people pay to stop losing something they already
 * have, far more readily than to gain something they have never had. So the
 * sheet opens with the user's OWN numbers — hours recorded, meetings captured,
 * recordings about to expire — and only then says what Pro does about it. A
 * paywall that opens with a feature grid is asking a stranger to imagine a
 * benefit; this one reminds someone of work they have already done.
 *
 * Four rules it does not break:
 *
 *   Never at launch, never full-screen, never mid-recording. It is a sheet that
 *   arrives at a moment the user created, and "Not now" dismisses instantly with
 *   no delay and no guilt copy. A subscription prompt that traps someone is a
 *   one-star review that mentions the trap by name.
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
  meetingCount: number;
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

  if (trigger === "retention" && usage.expiringSoon && usage.expiringSoon.count > 0) {
    const { count, onDate } = usage.expiringSoon;
    return `You've recorded ${recorded} across ${usage.meetingCount} meetings this month. On Free, audio is deleted after 7 days — ${count} ${count === 1 ? "recording expires" : "recordings expire"} on ${formatDate(onDate)}.`;
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

  return usage.meetingCount > 0
    ? `You've recorded ${recorded} across ${usage.meetingCount} meetings this month.`
    : "Pro lifts every limit on recording, questions, and how long your audio is kept.";
}

const HEADLINES: Record<PaywallTrigger, string> = {
  retention: "Keep your recordings",
  ask_limit: "Ask more questions",
  minutes_limit: "More recording time",
  settings: "EchoBrief Pro",
};

/** What Pro actually changes. Concrete, and in the order people care. */
const BENEFITS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: "clock.arrow.circlepath",
    title: "Audio kept as long as you want",
    body: "Free deletes recordings after 7 days. Pro keeps them until you delete them.",
  },
  {
    icon: "waveform",
    title: "15 hours of recording a month",
    body: "Up from 2 hours — roughly a meeting a day, with room for the long ones.",
  },
  {
    icon: "bubble.left.and.text.bubble.right",
    title: "500 questions a month",
    body: "Ask across every meeting you've ever recorded, not just the last few.",
  },
];

function Benefit({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View className="flex-row gap-3">
      {/* The settings chip, imported rather than restyled. A second icon
          treatment on the one screen asking for money is exactly where a
          product starts to look assembled from parts. */}
      <View className="mt-0.5">
        <SettingIcon symbol={icon} />
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
  // reopening shows the previous attempt's error over a fresh sheet.
  useEffect(() => {
    if (visible) reset();
  }, [visible, reset]);

  // Success closes the sheet on its own. Making someone tap "Done" after paying
  // is one more step between them and the thing they just bought.
  useEffect(() => {
    if (state.phase === "active") {
      void haptics.success();
      onDismiss();
    }
  }, [state.phase, onDismiss]);

  const monthly = availability.offerings.find((o) => o.period === "monthly") ?? null;
  const annual = availability.offerings.find((o) => o.period === "annual") ?? null;
  const busy = state.phase === "purchasing" || state.phase === "activating";

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "slide"}
      presentationStyle="overFullScreen"
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

  return (
    <View className="flex-1 justify-end">
      {/* Scrim. Tapping it dismisses, like every other sheet in the app —
          a paywall that ignores the standard gesture reads as a trap. */}
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(TIMING.crossfade.duration)}
        exiting={reduceMotion ? undefined : FadeOut.duration(120)}
        className="absolute inset-0 bg-black/60"
      >
        <Pressable className="flex-1" onPress={onDismiss} accessibilityLabel="Dismiss" />
      </Animated.View>

      <View
        className="max-h-[88%] overflow-hidden rounded-t-sheet bg-sheet"
        style={{ borderCurve: "continuous" }}
      >
        {/* Grabber, so the sheet reads as a sheet before anything is read. */}
        <View className="items-center pb-1 pt-2.5">
          <View className="h-1 w-9 rounded-full bg-fill-tertiary" />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          // The sheet is capped at 88% of the screen, so on a small device with
          // large text the content scrolls rather than pushing the commit button
          // off the bottom — which would leave a paywall nobody can act on.
          bounces={false}
        >
          <View className="gap-5 px-5 pt-3">
            <View className="gap-2">
              <Text
                className="font-display text-[24px] leading-[28px] text-label"
                maxFontSizeMultiplier={1.3}
              >
                {HEADLINES[trigger]}
              </Text>
              <Text
                className="text-[15px] leading-[21px] text-label-secondary"
                maxFontSizeMultiplier={1.5}
              >
                {openingLine(trigger, usage)}
              </Text>
            </View>

            <View className="gap-4">
              {BENEFITS.map((b, i) => (
                <Animated.View
                  key={b.title}
                  entering={reduceMotion ? undefined : FadeInDown.duration(260).delay(60 + i * 50)}
                >
                  <Benefit {...b} />
                </Animated.View>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Commit region, pinned below the scroll so it is always reachable. */}
        <View
          className="gap-3 border-t border-edge px-5 pt-4"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          {!available ? (
            /* The honest state. No priced button that cannot charge anyone —
               a dead commit button at the moment someone decided to pay is
               worse than telling them plainly that it is not ready. */
            <View
              className="gap-1.5 rounded-card bg-surface p-4"
              style={{ borderCurve: "continuous" }}
            >
              <Text className="text-[15px] font-semibold text-label" maxFontSizeMultiplier={1.4}>
                Subscriptions aren't live yet
              </Text>
              <Text
                className="text-[13px] leading-[18px] text-label-secondary"
                maxFontSizeMultiplier={1.5}
              >
                Pro is finished on our side and waiting on App Store review. Nothing you record now
                will be lost when it opens.
              </Text>
            </View>
          ) : !online ? (
            /* Said BEFORE the tap, not after. A purchase that fails at the tap
               because the network was already down wastes the one moment of
               intent you get. */
            <View className="rounded-card bg-surface p-4" style={{ borderCurve: "continuous" }}>
              <Text className="text-[14px] text-label-secondary" maxFontSizeMultiplier={1.5}>
                You're offline. Reconnect to subscribe.
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
                className="h-[50px] flex-row items-center justify-center gap-2 rounded-control bg-label active:opacity-90"
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
                      plan charged once a year, is the exact framing regulators
                      and app reviewers treat as deceptive. */}
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

          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            className="items-center py-2"
            // No delay before this enables, and no "are you sure". Dismissal is
            // instant, every time.
            hitSlop={{ top: 8, bottom: 8, left: 24, right: 24 }}
          >
            <Text className="text-[15px] text-label-secondary" maxFontSizeMultiplier={1.4}>
              Not now
            </Text>
          </Pressable>

          <View className="flex-row items-center justify-center gap-3">
            {/* Restore is required by Apple and is the first thing a returning
                user looks for after reinstalling. */}
            <Pressable onPress={onRestore} disabled={busy || !available} accessibilityRole="button">
              <Text className="text-[12px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
                Restore purchases
              </Text>
            </Pressable>
            <Text className="text-[12px] text-label-quaternary">·</Text>
            <Text className="text-[12px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
              Terms
            </Text>
            <Text className="text-[12px] text-label-quaternary">·</Text>
            <Text className="text-[12px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
              Privacy
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
