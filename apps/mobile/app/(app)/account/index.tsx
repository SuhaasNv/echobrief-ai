import { useCallback, useState } from "react";
import { Alert, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { accountKeys, initialsFor, useAccount, useWorkspaces } from "@/lib/api/account";
import { describeError, useOnline } from "@/lib/api/errors";
import { subscriptionKeys, useSubscription } from "@/lib/api/subscription";
import { clearSession, tokenStore } from "@/lib/api/token-store";
import { haptics } from "@/lib/haptics";
import { ErrorState, StaleNotice } from "@/components/error-state";
import { Avatar } from "@/components/settings/avatar";
import { usePreferences } from "@/components/settings/preferences";
import { Chevron, Row, Section } from "@/components/settings/rows";
import { PressableTile, SettingsScroll } from "@/components/settings/screen";
import { IdentityCardSkeleton } from "@/components/settings/skeleton";

/**
 * The identity card.
 *
 * Modelled on the Apple Account row at the top of iOS Settings, and for the
 * same reason: a settings screen opens with WHO you are signed in as, not with
 * a decorative circle. Left-aligned with the name, the address, and the plan on
 * one card, tappable straight into Profile — which is why there is no separate
 * "Profile" row below. Two routes to the same screen on one page is clutter,
 * and the chevron here already says this card leads somewhere.
 */
function IdentityCard() {
  const online = useOnline();
  const query = useAccount();
  const { data: subscription } = useSubscription();
  const preferences = usePreferences();

  const account = query.data;

  /**
   * No account, three reasons, three renderings.
   *
   * This card used to render `account?.email ?? " "` — a literal single space —
   * whichever of the three it was, so a failed fetch produced a card headed
   * "Your account" with a blank address under it and no way to tell it from a
   * real session. `isPaused` is checked alongside `isError` because an offline
   * first load is NEITHER: React Query holds the fetch, so isLoading is false,
   * isError is false, and data is undefined.
   */
  if (!account) {
    if (query.isError || query.isPaused) {
      const copy = describeError(query.error, { online, subject: "your account" });
      return (
        <ErrorState
          title={copy.title}
          body={copy.body}
          detail={query.error?.message}
          onRetry={copy.retryable ? () => void query.refetch() : undefined}
          busy={query.isFetching}
        />
      );
    }

    return <IdentityCardSkeleton />;
  }

  const tier = subscription?.subscription.tier;
  const name = account.name?.trim() || "Your account";
  const role = preferences.role.trim();

  return (
    <PressableTile
      onPress={() => router.push("/(app)/account/profile")}
      accessibilityLabel={`${name}, ${account.email}`}
      accessibilityHint="Opens your profile"
      className="mx-4 overflow-hidden rounded-card border border-edge bg-surface active:bg-elevated"
    >
      <>
        <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

        <View className="flex-row items-center gap-4 p-4">
          <Avatar initials={initialsFor(account)} uri={preferences.avatarUri} size={60} />

          <View className="flex-1 gap-0.5">
            <Text
              className="font-display text-[20px] text-label"
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
            >
              {name}
            </Text>
            <Text
              className="text-[14px] text-label-secondary"
              numberOfLines={1}
              maxFontSizeMultiplier={1.6}
            >
              {account.email}
            </Text>

            <View className="mt-1.5 flex-row items-center gap-1.5">
              {tier ? (
                <View className="rounded-chip bg-fill px-2 py-0.5">
                  <Text
                    className="text-[11px] font-semibold uppercase text-label-secondary"
                    style={{ letterSpacing: 0.8 }}
                    maxFontSizeMultiplier={1.4}
                  >
                    {tier}
                  </Text>
                </View>
              ) : null}
              {role ? (
                <Text
                  className="flex-1 text-[13px] text-label-tertiary"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.6}
                >
                  {role}
                </Text>
              ) : null}
            </View>
          </View>

          <Chevron />
        </View>
      </>
    </PressableTile>
  );
}

export default function AccountScreen() {
  const queryClient = useQueryClient();
  const online = useOnline();
  const { data: account } = useAccount();
  const { data: workspaces } = useWorkspaces();

  /**
   * Pull to refresh, which the Plan screen has been telling people to do since
   * before any settings screen had it. Refetching by key rather than
   * `refetchQueries()` with no filter, so pulling here does not also kick off
   * every query belonging to the other four tabs.
   */
  const onRefresh = useCallback(
    () =>
      Promise.all([
        queryClient.refetchQueries({ queryKey: accountKeys.me }),
        queryClient.refetchQueries({ queryKey: accountKeys.workspaces }),
        queryClient.refetchQueries({ queryKey: subscriptionKeys.all }),
      ]),
    [queryClient],
  );

  // The active workspace lives in the Keychain-backed token store, which is not
  // reactive, so it is re-read whenever this screen comes back into view.
  const [workspaceId, setWorkspaceId] = useState<string | null>(() =>
    tokenStore.getWorkspaceId(),
  );

  useFocusEffect(
    useCallback(() => {
      setWorkspaceId(tokenStore.getWorkspaceId());
    }, []),
  );

  const activeWorkspace =
    workspaces?.find((workspace) => workspace.id === workspaceId) ?? workspaces?.[0];

  const confirmSignOut = () => {
    haptics.medium();
    Alert.alert(
      "Sign out of EchoBrief?",
      "Recordings that haven't finished uploading will be removed from this iPhone.",
      [
        // Cancel first: iOS renders the leading button on the left, and every
        // system alert puts the safe choice there.
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            // Keychain entries survive app uninstall on iOS, so an explicit
            // clear is the only thing that actually ends the session.
            clearSession();
            queryClient.clear();
            router.replace("/(auth)/sign-in");
          },
        },
      ],
    );
  };

  return (
    <SettingsScroll topPadding={8} onRefresh={onRefresh}>
      {/* Said in words, because pulling to refresh while offline cannot do
          anything and the user is owed the reason rather than a spinner that
          returns with nothing changed. Suppressed when there is no cached
          account, because the card below then leads with the same fact. */}
      {!online && account ? (
        <StaleNotice>Offline. Showing your last synced details.</StaleNotice>
      ) : null}

      <IdentityCard />

      {/*
        Exactly one coloured chip in this group, and it is violet on Summaries,
        because a model writes them. Everything else is a grey chip on
        --surface-3 with a --label-secondary glyph.

        This grid was seven saturated blue squares plus a green one and a violet
        one — the iOS Settings rainbow, reproduced on a list of eleven rows that
        are all about one product. It made the app's one semantic colour rule
        unreadable: violet is supposed to mean "a model produced this", and it
        cannot mean anything when it is sitting in a row of nine chips that are
        each a different colour for no reason. Grey by default is what lets the
        violet register.
      */}
      <Section title="Capture">
        <Row
          icon="waveform"
          label="Recording"
          onPress={() => router.push("/(app)/account/recording")}
        />
        <Row
          icon="text.bubble"
          label="Transcription"
          onPress={() => router.push("/(app)/account/transcription")}
        />
        <Row
          icon="doc.plaintext"
          iconTone="violet"
          label="Summaries"
          onPress={() => router.push("/(app)/account/summaries")}
        />
        <Row
          icon="bell"
          label="Notifications"
          onPress={() => router.push("/(app)/account/notifications")}
        />
      </Section>

      <Section title="Account">
        <Row
          icon="rectangle.stack"
          label="Workspace"
          value={activeWorkspace?.name}
          onPress={() => router.push("/(app)/account/workspaces")}
          hint="Switch workspace"
        />
        <Row
          icon="lock"
          label="Password"
          onPress={() => router.push("/(app)/account/password")}
        />
        <Row
          icon="creditcard"
          label="Plan"
          onPress={() => router.push("/(app)/account/plan")}
        />
      </Section>

      {/* Untitled: "Privacy" and "About" have nothing in common except that
          neither belongs above, and a heading invented to cover both would be
          less informative than the two labels already are. */}
      <Section>
        <Row
          icon="hand.raised"
          label="Privacy"
          onPress={() => router.push("/(app)/account/privacy")}
        />
        <Row
          icon="info.circle"
          iconTone="neutral"
          label="About"
          onPress={() => router.push("/(app)/account/about")}
        />
      </Section>

      <Section>
        <Row
          icon="rectangle.portrait.and.arrow.right"
          label="Sign out"
          destructive
          onPress={confirmSignOut}
        />
        {/* Guideline 5.1.1(v): deletion has to be reachable from inside the app. */}
        <Row
          icon="trash"
          label="Delete account"
          destructive
          onPress={() => router.push("/(app)/account/delete")}
        />
      </Section>
    </SettingsScroll>
  );
}
