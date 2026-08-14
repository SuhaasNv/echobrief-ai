import { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { describeError, useOnline } from "@/lib/api/errors";
import { useSubscription } from "@/lib/api/subscription";
import { ErrorState, StaleNotice } from "@/components/error-state";
import { UsageMeter } from "@/components/settings/meter";
import { Row, Section, ValueRow } from "@/components/settings/rows";
import { PaywallSheet } from "@/components/paywall/sheet";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

function titleCase(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1).toLowerCase() : value;
}

/** "1 Jul 2026" style, matching the rest of the app's date handling. */
function formatBillingDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function priceLabel(price: number | string | null, interval: string | null): string | null {
  const amount = typeof price === "string" ? Number(price) : price;
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const suffix = interval === "yearly" ? "/yr" : interval === "monthly" ? "/mo" : "";
  return `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}${suffix}`;
}

/**
 * Plan.
 *
 * Everything on this screen is live, straight from GET /subscription: tier,
 * status, price, period, and the usage meters. A row whose value the app does
 * not actually have is not rendered.
 *
 * This screen used to carry a "Billing" group with a Visa •••• 4242 row and a
 * link to five invented invoices, under a "SAMPLE DATA" badge explaining that
 * none of it was real. That is not a design state. It is an unshipped screen
 * presented as shipped, it is an App Store review finding, and the badge made
 * it worse rather than better by admitting it on the record. There is no
 * payment or invoice endpoint, so there are no payment or invoice rows. The
 * screen is shorter and every line on it is true.
 *
 * There IS an upgrade button now, and the reasoning that used to say there never
 * would be has been inverted deliberately. The old note argued plan changes
 * belonged on the web because in-app selling pulls in Apple's IAP obligations
 * and its cut. That is true and it is also not optional: for digital content
 * consumed in an iOS app, Apple requires IAP, and steering users to a web
 * checkout is the thing that gets an app rejected — not the thing that avoids
 * it. So the subscription is sold here, through StoreKit, and the 15% Small
 * Business Program rate is the cost of being on the platform.
 */
export default function PlanScreen() {
  const online = useOnline();
  const query = useSubscription();
  const [paywallOpen, setPaywallOpen] = useState(false);

  const onRefresh = useCallback(() => query.refetch(), [query]);

  const data = query.data;

  /**
   * No figures rather than invented ones.
   *
   * Every meter here used to fall back to `?? 0`, so a failed request rendered
   * a complete, plausible screen: a Free plan sitting at "0 of 0" transcription
   * minutes. That is not a degraded state, it is a wrong one, and a footnote
   * above it saying the figures "may be out of date" did not make the zeros any
   * less convincing. Nothing is drawn unless it came from the server.
   */
  if (!data) {
    if (query.isError || query.isPaused) {
      const copy = describeError(query.error, { online, subject: "your plan" });
      return (
        <SettingsScroll onRefresh={onRefresh}>
          <ErrorState
            title={copy.title}
            body={copy.body}
            detail={query.error?.message}
            onRetry={copy.retryable ? () => void query.refetch() : undefined}
            busy={query.isFetching}
          />
        </SettingsScroll>
      );
    }

    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel="Loading your plan" />
      </View>
    );
  }

  const subscription = data.subscription;
  const tier = titleCase(subscription.tier);
  const price = priceLabel(subscription.price_usd, subscription.billing_interval);
  const renews = subscription.current_period_end
    ? formatBillingDate(subscription.current_period_end)
    : null;

  /**
   * Which paywall this account should actually see.
   *
   * The sheet has four trigger variants and only the generic one was ever
   * passed, so its headline was always the brand name and the three
   * benefit-led headlines were dead code. Someone sitting at their limit
   * should be told that, not sold to in the abstract.
   */
  const minutesLimit = data.limits.transcription_minutes;
  const atMinutesLimit = minutesLimit !== null && data.usage.transcription_minutes >= minutesLimit;

  return (
    <SettingsScroll onRefresh={onRefresh}>
      {/* Reached this far, so these figures are real. They can still be stale:
          a background refresh that failed leaves the last good response on
          screen, which is worth keeping and worth labelling. The instruction is
          for THIS screen and the gesture now exists on it; the copy used to
          point at the Account screen, which had no refresh control either. */}
      {query.isError ? (
        <StaleNotice>
          {online
            ? "Could not refresh. These are the last figures the server sent. Pull down to try again."
            : "Offline. These are the last figures the server sent."}
        </StaleNotice>
      ) : null}

      <Section title="Current plan">
        {/* No icon, deliberately. The three rows below it have none, so the tile
            pushed this label 40pt right of theirs — a step in the left margin
            INSIDE one card, which is the most visible misalignment on any
            settings screen. Adding tiles to the others was the alternative and
            is worse: everywhere else in this app an icon marks a row you can tap
            INTO, and all four of these are facts about the plan, not
            destinations. */}
        <ValueRow label="Plan" value={tier} />
        {subscription.status ? (
          <ValueRow label="Status" value={titleCase(subscription.status)} />
        ) : null}
        {price ? <ValueRow label="Price" value={price} mono /> : null}
        {renews ? <ValueRow label="Renews" value={renews} mono /> : null}
      </Section>

      {/* The user-initiated entry point — trigger #4, the only one that is
          always available. Shown only on Free: an upgrade button on a screen
          that already says "Plan: Pro" is asking someone to buy what they have.

          A row rather than a filled button. The commit treatment belongs on the
          paywall itself, where the price and the terms are; putting it here
          would be a second commit affordance for a purchase this screen cannot
          complete. */}
      {subscription.tier === "free" ? (
        <Section footer="Billed through the App Store. Cancel any time in your Apple ID settings.">
          <Row
            label="Upgrade to Pro"
            detail="15 hours of recording and 500 questions a month"
            icon="sparkles"
            iconTone="violet"
            onPress={() => setPaywallOpen(true)}
          />
        </Section>
      ) : null}

      <Section title="Usage this period" footer="Usage resets at the start of each calendar month.">
        <UsageMeter
          label="Transcription"
          used={data.usage.transcription_minutes}
          limit={data.limits.transcription_minutes}
          unit="min"
        />
        {/* The endpoint names these differently in the two blocks: usage reports
            ai_queries_count, limits reports ai_queries. */}
        <UsageMeter
          label="AI questions"
          used={data.usage.ai_queries_count}
          limit={data.limits.ai_queries}
        />
        <UsageMeter
          label="Workspaces"
          used={data.usage.workspace_count}
          limit={data.limits.workspaces}
        />
      </Section>

      {/* Was: "EchoBrief does not sell subscriptions inside the app." That is
          now false — it does, through StoreKit — and a footnote contradicting
          the button 40pt above it is worse than no footnote. What replaces it is
          the part a subscriber actually needs, which is where to cancel. */}
      <Footnote>
        Subscriptions are billed by Apple. Manage or cancel yours in Settings › your name ›
        Subscriptions on this device.
      </Footnote>

      {/* Mounted only while open, so each presentation gets fresh purchase state
          rather than reopening onto the previous attempt's error — the same
          reason the speaker-naming sheet mounts rather than toggling a prop. */}
      {paywallOpen ? (
        <PaywallSheet
          visible
          trigger={atMinutesLimit ? "minutes_limit" : "settings"}
          usage={{
            // Minutes only. GET /subscription does not report a meeting count
            // and this screen has no meetings query, so the sheet omits that
            // clause rather than being handed a number nobody measured.
            minutesThisMonth: data.usage.transcription_minutes,
            // The limit was already in scope and simply not passed, which left
            // the sheet with nothing specific to say and falling back to the
            // brand name as its headline.
            minutesLimit: data.limits.transcription_minutes,
          }}
          onDismiss={() => setPaywallOpen(false)}
        />
      ) : null}
    </SettingsScroll>
  );
}
