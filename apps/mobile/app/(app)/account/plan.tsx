import { useCallback } from "react";
import { ActivityIndicator, View } from "react-native";

import { describeError, useOnline } from "@/lib/api/errors";
import { useSubscription } from "@/lib/api/subscription";
import { ErrorState, StaleNotice } from "@/components/error-state";
import { UsageMeter } from "@/components/settings/meter";
import { Section, ValueRow } from "@/components/settings/rows";
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
 * There is no upgrade button, and there will not be one. Selling a digital
 * subscription inside the app pulls in Apple's In-App Purchase obligations and
 * its cut, so plan changes stay on the web — stated as a fact, without a link
 * or a row that would read as steering around the rule.
 */
export default function PlanScreen() {
  const online = useOnline();
  const query = useSubscription();

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
        <ValueRow icon="creditcard" label="Plan" value={tier} />
        {subscription.status ? (
          <ValueRow label="Status" value={titleCase(subscription.status)} />
        ) : null}
        {price ? <ValueRow label="Price" value={price} mono /> : null}
        {renews ? <ValueRow label="Renews" value={renews} mono /> : null}
      </Section>

      <Section
        title="Usage this period"
        footer="Usage resets at the start of each calendar month."
      >
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

      <Footnote>
        Plan changes, payment details, and invoices are handled in your account on the web.
        EchoBrief does not sell subscriptions inside the app.
      </Footnote>
    </SettingsScroll>
  );
}
